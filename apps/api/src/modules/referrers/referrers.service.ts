import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import {
  computeReferralSuggestion,
  resolveReferralTerm,
  type DealTermLike,
  type SessionPrincipal,
} from "@business-os/shared";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { BalanceService } from "../billing/balance.service.js";
import type {
  AttachReferralDto,
  SetClientReferrerDto,
  SetReferrerTermsDto,
  SuggestReferralDto,
} from "./dto.js";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A referral side-leg sits outside the client→writer chain; a stable sentinel seq. */
const REFERRAL_LEG_SEQ = 90;

/**
 * Referrers (DESIGN_SPEC §4, §8). A referral is "another claimant leg, scoped
 * like any other": an admin attaches a leg from the business (from=null) TO a
 * referrer, and the existing leg_visibility RLS scopes it so the referrer sees
 * ONLY their own slice. The agreement (a referral_pct deal_term with a basis)
 * yields a SUGGESTION; the admin may override. Beneficiary is the DIRECT, one-hop
 * referrer — never a cascade up the referred-by graph (admin may reassign).
 */
@Injectable()
export class ReferrersService {
  constructor(
    private readonly audit: AuditService,
    private readonly balance: BalanceService,
  ) {}

  private canSeeAll(principal: SessionPrincipal, perms: EffectivePermissions): boolean {
    return principal.isSystemSuperadmin || perms.perms.has("referrers:approve");
  }

  // ── referrer directory ──────────────────────────────────────────────────────
  listReferrers(tx: Db) {
    return tx
      .select({
        id: schema.party.id,
        displayName: schema.party.displayName,
        partyType: schema.party.partyType,
        externalRef: schema.party.externalRef,
      })
      .from(schema.party)
      .where(
        and(
          isNull(schema.party.archivedAt),
          sql`${schema.party.partyType} @> array['referrer']::text[]`,
        ),
      )
      .orderBy(asc(schema.party.displayName));
  }

  // ── agreements (referral_pct deal_terms; append-only supersede) ──────────────
  private async assertReferrerParty(tx: Db, partyId: string) {
    const [p] = await tx
      .select({ id: schema.party.id, partyType: schema.party.partyType })
      .from(schema.party)
      .where(and(eq(schema.party.id, partyId), isNull(schema.party.archivedAt)));
    if (!p) throw new NotFoundException("Referrer not found");
    if (!(p.partyType ?? []).includes("referrer")) {
      throw new BadRequestException("That party is not a referrer (mark party_type 'referrer' first)");
    }
    return p;
  }

  listReferrerTerms(tx: Db, referrerId: string) {
    return tx
      .select({
        id: schema.dealTerm.id,
        basis: schema.dealTerm.basis,
        value: schema.dealTerm.value,
        appliesTo: schema.dealTerm.appliesTo,
        effectiveFrom: schema.dealTerm.effectiveFrom,
        effectiveTo: schema.dealTerm.effectiveTo,
        createdAt: schema.dealTerm.createdAt,
      })
      .from(schema.dealTerm)
      .where(
        and(
          eq(schema.dealTerm.fromPartyId, referrerId),
          eq(schema.dealTerm.termType, "referral_pct"),
        ),
      )
      .orderBy(desc(schema.dealTerm.effectiveFrom), desc(schema.dealTerm.createdAt));
  }

  async setReferrerTerms(
    tx: Db,
    principal: SessionPrincipal,
    referrerId: string,
    dto: SetReferrerTermsDto,
  ) {
    await this.assertReferrerParty(tx, referrerId);
    const appliesTo = dto.clientPartyId ? `client:${dto.clientPartyId}` : "default";
    const [row] = await tx
      .insert(schema.dealTerm)
      .values({
        orgId: principal.orgId,
        fromPartyId: referrerId,
        toPartyId: null, // the business side
        appliesTo,
        termType: "referral_pct",
        basis: dto.basis,
        value: String(dto.value),
        effectiveFrom: dto.effectiveFrom.slice(0, 10),
        createdBy: principal.userId,
      })
      .returning({ id: schema.dealTerm.id });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "referral.terms_set",
      entity: "deal_term",
      entityId: row!.id,
      detail: { referrerId, basis: dto.basis, value: dto.value, appliesTo },
    });
    return { id: row!.id, referrerId, basis: dto.basis, value: dto.value, appliesTo };
  }

  // ── per-client default referrer (one-hop) ────────────────────────────────────
  async setClientReferrer(
    tx: Db,
    principal: SessionPrincipal,
    clientId: string,
    dto: SetClientReferrerDto,
  ) {
    const [client] = await tx
      .select({ id: schema.party.id })
      .from(schema.party)
      .where(and(eq(schema.party.id, clientId), isNull(schema.party.archivedAt)));
    if (!client) throw new NotFoundException("Client not found");

    const referrerId = dto.referrerId ?? null;
    if (referrerId) {
      if (referrerId === clientId) {
        throw new BadRequestException("A party cannot refer themselves");
      }
      await this.assertReferrerParty(tx, referrerId);
    }
    await tx
      .update(schema.party)
      .set({ referredByPartyId: referrerId, updatedBy: principal.userId, updatedAt: new Date() })
      .where(eq(schema.party.id, clientId));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "referral.client_referrer_set",
      entity: "party",
      entityId: clientId,
      detail: { referrerId },
    });
    return { clientId, referrerId };
  }

  // ── job context + resolution ─────────────────────────────────────────────────
  private async loadWorkItem(tx: Db, id: string) {
    const [item] = await tx
      .select({
        id: schema.workItem.id,
        title: schema.workItem.title,
        sourcePartyId: schema.workItem.sourcePartyId,
        doerPartyId: schema.workItem.doerPartyId,
        createdAt: schema.workItem.createdAt,
      })
      .from(schema.workItem)
      .where(eq(schema.workItem.id, id));
    if (!item) throw new NotFoundException("Work item not found");
    return item;
  }

  /** The DIRECT (one-hop) referrer for a job: explicit, else the client's
   *  referred_by. NEVER walks the referred-by graph upward (no cascade). */
  private async resolveBeneficiary(
    tx: Db,
    item: { sourcePartyId: string | null },
    explicitReferrerId: string | undefined,
  ): Promise<string | null> {
    if (explicitReferrerId) return explicitReferrerId;
    if (!item.sourcePartyId) return null;
    const [client] = await tx
      .select({ referredByPartyId: schema.party.referredByPartyId })
      .from(schema.party)
      .where(eq(schema.party.id, item.sourcePartyId));
    return client?.referredByPartyId ?? null; // one hop only
  }

  /** Job revenue + post-writer margin via the admin-only SECURITY DEFINER (the
   *  admin isn't a party to the chain legs but is entitled to see money). */
  private async jobBases(tx: Db, workItemId: string): Promise<{ revenue: number; margin: number }> {
    const r = await tx.execute(
      sql`select revenue, writer_cost as "writerCost" from job_money(${workItemId})`,
    );
    const row = r.rows[0] as { revenue: string; writerCost: string } | undefined;
    const revenue = Number(row?.revenue ?? 0);
    const writerCost = Number(row?.writerCost ?? 0);
    return { revenue: round2(revenue), margin: round2(revenue - writerCost) };
  }

  private async referrerTerms(tx: Db, referrerId: string): Promise<DealTermLike[]> {
    const rows = await tx
      .select()
      .from(schema.dealTerm)
      .where(
        and(
          eq(schema.dealTerm.fromPartyId, referrerId),
          eq(schema.dealTerm.termType, "referral_pct"),
        ),
      );
    return rows as unknown as DealTermLike[];
  }

  // ── suggest (read-only; never throws on "no agreement") ──────────────────────
  async suggestReferral(
    tx: Db,
    _principal: SessionPrincipal,
    _perms: EffectivePermissions,
    dto: SuggestReferralDto,
  ) {
    const item = await this.loadWorkItem(tx, dto.workItemId);
    const referrerId = await this.resolveBeneficiary(tx, item, dto.referrerId);
    const bases = await this.jobBases(tx, dto.workItemId);

    if (!referrerId) {
      return {
        workItemId: dto.workItemId,
        referrerId: null,
        referrerName: null,
        ...bases,
        term: null,
        suggestedAmount: null,
        source: "no_referrer" as const,
      };
    }

    const [referrer] = await tx
      .select({ id: schema.party.id, displayName: schema.party.displayName, partyType: schema.party.partyType })
      .from(schema.party)
      .where(eq(schema.party.id, referrerId));
    const asOf = item.createdAt.toISOString().slice(0, 10);
    const term = resolveReferralTerm(await this.referrerTerms(tx, referrerId), {
      referrerId,
      clientPartyId: item.sourcePartyId,
      asOf,
    });
    const suggestion = term
      ? computeReferralSuggestion({
          basis: term.basis,
          value: term.value,
          revenue: bases.revenue,
          margin: bases.margin,
        })
      : null;

    return {
      workItemId: dto.workItemId,
      referrerId,
      referrerName: referrer?.displayName ?? null,
      ...bases,
      term: term ? { basis: term.basis, value: term.value, appliesTo: term.appliesTo, effectiveFrom: term.effectiveFrom } : null,
      suggestedAmount: suggestion?.amount ?? null,
      source: suggestion ? ("derived" as const) : ("unpriced" as const),
    };
  }

  // ── attach (admin direct-attach; writes the referral leg) ────────────────────
  async attachReferral(
    tx: Db,
    principal: SessionPrincipal,
    _perms: EffectivePermissions,
    dto: AttachReferralDto,
  ) {
    const item = await this.loadWorkItem(tx, dto.workItemId);
    const referrerId = await this.resolveBeneficiary(tx, item, dto.referrerId);
    if (!referrerId) {
      throw new BadRequestException(
        "No referrer to attach — set the client's referrer or pass a referrerId",
      );
    }
    await this.assertReferrerParty(tx, referrerId);
    // A party can't be their own referrer on their own job (Siam is client + referrer).
    if (item.sourcePartyId && referrerId === item.sourcePartyId) {
      throw new BadRequestException("A client cannot be their own referrer on their own job");
    }

    // One live referral per (job, referrer); a fully-reversed one (net 0) may re-attach.
    const existing = await tx.execute(
      sql`select referral_exists(${dto.workItemId}, ${referrerId}) as exists`,
    );
    if ((existing.rows[0] as { exists: boolean }).exists) {
      throw new ConflictException("A referral for this referrer already exists on this job");
    }

    const asOf = item.createdAt.toISOString().slice(0, 10);
    const term = resolveReferralTerm(await this.referrerTerms(tx, referrerId), {
      referrerId,
      clientPartyId: item.sourcePartyId,
      asOf,
    });

    // Amount: an explicit override, else the agreement's suggestion.
    let amount: number | null = dto.amount ?? null;
    if (amount == null && term) {
      const bases = await this.jobBases(tx, dto.workItemId);
      const suggestion = computeReferralSuggestion({
        basis: term.basis,
        value: term.value,
        revenue: bases.revenue,
        margin: bases.margin,
      });
      amount = suggestion?.amount ?? null;
    }
    if (amount == null || amount <= 0) {
      throw new BadRequestException(
        "Provide an amount — no referral agreement to derive a suggestion from",
      );
    }
    amount = round2(amount);

    // Every referral leg references a referral_pct deal_term (the marker + provenance):
    // the standing agreement if one resolved, else a one-off fixed term for this attach.
    let dealTermId = term?.id ?? null;
    if (!dealTermId) {
      const [oneOff] = await tx
        .insert(schema.dealTerm)
        .values({
          orgId: principal.orgId,
          fromPartyId: referrerId,
          toPartyId: null,
          appliesTo: item.sourcePartyId ? `client:${item.sourcePartyId}` : "default",
          termType: "referral_pct",
          basis: "fixed",
          value: String(amount),
          effectiveFrom: asOf,
          createdBy: principal.userId,
        })
        .returning({ id: schema.dealTerm.id });
      dealTermId = oneOff!.id;
    }

    // Append-only leg, business (from=null) → referrer. No RETURNING: the admin
    // isn't a party to this leg, so the leg RLS SELECT policy would hide it.
    const legId = randomUUID();
    await tx.insert(schema.leg).values({
      id: legId,
      orgId: principal.orgId,
      workItemId: dto.workItemId,
      seq: REFERRAL_LEG_SEQ,
      fromPartyId: null, // the business bears the referral cost
      toPartyId: referrerId,
      amount: String(amount),
      dealTermId,
      note: "referral",
      createdBy: principal.userId,
    });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "referral.attached",
      entity: "work_item",
      entityId: dto.workItemId,
      detail: {
        legId,
        referrerId,
        amount,
        basis: term?.basis ?? "fixed",
        source: dto.amount != null ? "override" : term ? "derived" : "manual",
      },
    });
    return { ok: true, legId, referrerId, amount };
  }

  // ── referrer self-view (own slice only) ──────────────────────────────────────
  async myReferrals(tx: Db, principal: SessionPrincipal) {
    if (!principal.partyId) {
      return { works: [], balance: await this.balance.balance(tx, null) };
    }
    const works = await tx.execute(sql`
      select work_item_id as "workItemId", title, client_name as "clientName",
             referral_amount as "referralAmount", referral_at as "referralAt",
             job_created_at as "jobCreatedAt"
      from referrer_works(${principal.partyId})
    `);
    const balance = await this.balance.balance(tx, principal.partyId);
    return { works: works.rows, balance };
  }
}
