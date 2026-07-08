import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import {
  derivePartnerBalance,
  deriveProfitShares,
  round2,
  type DealTermLike,
  type ProfitShareJobInput,
  type SessionPrincipal,
  type SettlementTransferRow,
} from "@business-os/shared";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { PartyService } from "../refdata/party.service.js";
import type {
  CreateChannelDto,
  MyProfitShareQueryDto,
  SetProfitShareTermDto,
  UpdateChannelDto,
} from "./dto.js";

/** A profit_share basis that exposes the whole-business margin (back-computable). */
const NET_BASES = new Set(["pct_of_net", "pct_after_writer"]);

/**
 * Channels + source-driven routing + N-way profit-share (DESIGN_SPEC §3, §4.4;
 * module 17). A channel is a party tagged 'channel' (so work_item.source_party_id
 * reuses the whole source/leg/deal-term engine) plus a thin config row. Profit
 * shares are date-versioned profit_share deal_terms keyed on the beneficiary;
 * the pool is DERIVED from legs at read time (never stored) and divided N-way by
 * the pure deriveProfitShares. Owner dividends are just default-scoped terms.
 */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly audit: AuditService,
    private readonly parties: PartyService,
  ) {}

  // ── channels ────────────────────────────────────────────────────────────────
  async listChannels(tx: Db) {
    const rows = await tx
      .select({
        id: schema.channel.id,
        partyId: schema.channel.partyId,
        name: schema.party.displayName,
        medium: schema.channel.medium,
        controllerPartyId: schema.channel.controllerPartyId,
        isActive: schema.channel.isActive,
        createdAt: schema.channel.createdAt,
      })
      .from(schema.channel)
      .innerJoin(schema.party, eq(schema.party.id, schema.channel.partyId))
      .where(isNull(schema.channel.archivedAt))
      .orderBy(schema.party.displayName);
    const names = await this.partyNames(
      tx,
      rows.map((r) => r.controllerPartyId).filter((x): x is string => !!x),
    );
    // null controller = the business controls the channel.
    return rows.map((r) => ({
      ...r,
      controllerName: r.controllerPartyId ? (names.get(r.controllerPartyId) ?? null) : null,
    }));
  }

  async createChannel(tx: Db, principal: SessionPrincipal, dto: CreateChannelDto) {
    if (!dto.name?.trim()) throw new BadRequestException("name is required");
    if (!dto.medium?.trim()) throw new BadRequestException("medium is required");
    if (dto.controllerPartyId) await this.assertParty(tx, dto.controllerPartyId, "controller");

    // The channel-as-party (reused as a job's source_party_id) — created through
    // the existing PartyService so provenance/RLS/validation all apply.
    const party = await this.parties.create(tx, principal, {
      displayName: dto.name.trim(),
      partyType: ["channel"],
    });

    const [row] = await tx
      .insert(schema.channel)
      .values({
        orgId: principal.orgId,
        partyId: party.id,
        controllerPartyId: dto.controllerPartyId ?? null,
        medium: dto.medium.trim(),
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "channel.created",
      entity: "channel",
      entityId: row!.id,
      detail: { name: dto.name, medium: dto.medium, controllerPartyId: dto.controllerPartyId ?? null },
    });
    return { ...row, name: dto.name.trim() };
  }

  async updateChannel(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateChannelDto) {
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.medium !== undefined) {
      if (!dto.medium.trim()) throw new BadRequestException("medium cannot be empty");
      patch.medium = dto.medium.trim();
    }
    if (dto.controllerPartyId !== undefined) {
      if (dto.controllerPartyId) await this.assertParty(tx, dto.controllerPartyId, "controller");
      patch.controllerPartyId = dto.controllerPartyId; // null = business
    }
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    const [row] = await tx
      .update(schema.channel)
      .set(patch)
      .where(and(eq(schema.channel.id, id), isNull(schema.channel.archivedAt)))
      .returning();
    if (!row) throw new NotFoundException("Channel not found");
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "channel.updated",
      entity: "channel",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt") },
    });
    return row;
  }

  async archiveChannel(tx: Db, principal: SessionPrincipal, id: string) {
    const [row] = await tx
      .update(schema.channel)
      .set({ archivedAt: new Date(), updatedBy: principal.userId, updatedAt: new Date() })
      .where(and(eq(schema.channel.id, id), isNull(schema.channel.archivedAt)))
      .returning({ id: schema.channel.id });
    if (!row) throw new NotFoundException("Channel not found");
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "channel.archived",
      entity: "channel",
      entityId: id,
    });
    return { id, archived: true };
  }

  // ── profit-share terms (profit_share deal_terms; append-only supersede) ───────
  listProfitShareTerms(tx: Db, partyId?: string) {
    const filters = [eq(schema.dealTerm.termType, "profit_share")];
    if (partyId) filters.push(eq(schema.dealTerm.toPartyId, partyId));
    // Join the beneficiary name so the list needs no per-row party lookup.
    return tx
      .select({
        id: schema.dealTerm.id,
        toPartyId: schema.dealTerm.toPartyId,
        toPartyName: schema.party.displayName,
        basis: schema.dealTerm.basis,
        value: schema.dealTerm.value,
        appliesTo: schema.dealTerm.appliesTo,
        effectiveFrom: schema.dealTerm.effectiveFrom,
        effectiveTo: schema.dealTerm.effectiveTo,
        createdAt: schema.dealTerm.createdAt,
      })
      .from(schema.dealTerm)
      .leftJoin(schema.party, eq(schema.party.id, schema.dealTerm.toPartyId))
      .where(and(...filters))
      .orderBy(desc(schema.dealTerm.effectiveFrom), desc(schema.dealTerm.createdAt));
  }

  /**
   * The economic owner of a job source (for the §4.4 source-scoped guard): a
   * channel's controller (null = the business → no partner to protect), or the
   * source party itself when it isn't a channel. Returns null for a
   * business-controlled channel.
   */
  private async sourceOwner(
    tx: Db,
    sourcePartyId: string,
  ): Promise<{ id: string; partyType: string[] } | null> {
    const [ch] = await tx
      .select({ controllerPartyId: schema.channel.controllerPartyId })
      .from(schema.channel)
      .where(eq(schema.channel.partyId, sourcePartyId));
    if (ch) {
      if (!ch.controllerPartyId) return null; // business-controlled channel
      const [c] = await tx
        .select({ id: schema.party.id, partyType: schema.party.partyType })
        .from(schema.party)
        .where(eq(schema.party.id, ch.controllerPartyId));
      return c ? { id: c.id, partyType: c.partyType ?? [] } : null;
    }
    // Not a channel → the source party is its own owner (e.g. a partner/vendor source).
    const [p] = await tx
      .select({ id: schema.party.id, partyType: schema.party.partyType })
      .from(schema.party)
      .where(eq(schema.party.id, sourcePartyId));
    return p ? { id: p.id, partyType: p.partyType ?? [] } : null;
  }

  async setProfitShareTerm(tx: Db, principal: SessionPrincipal, dto: SetProfitShareTermDto) {
    const beneficiary = await this.assertParty(tx, dto.toPartyId, "beneficiary");
    if (dto.sourcePartyId) await this.assertParty(tx, dto.sourcePartyId, "source");
    const isDefaultScope = !dto.sourcePartyId;
    const appliesTo = dto.sourcePartyId ? `source:${dto.sourcePartyId}` : "default";
    const beneficiaryIsPartner = (beneficiary.partyType ?? []).includes("partner");
    const isFixed = dto.basis === "fixed";

    // pct_of_channel is meaningless without a channel scope — and would otherwise
    // silently compute against the WHOLE-business margin. Require a source.
    if (dto.basis === "pct_of_channel" && isDefaultScope) {
      throw new BadRequestException("pct_of_channel requires a channel scope — set a source.");
    }

    // §4.4 OPACITY GUARD. A percentage cut = rate × base, so the beneficiary can
    // back-compute the base. A FIXED amount reveals nothing; a percentage does:
    if (!isFixed && beneficiaryIsPartner) {
      if (isDefaultScope) {
        // base = the whole-business margin (incl. the OTHER partner's private
        // client margins) → never allowed for an active partner.
        throw new BadRequestException(
          "A default-scoped net-profit dividend to an active partner can leak the other partner's private margin (§4.4). Use a fixed amount, a channel-scoped share (set a source), or grant it to a non-partner silent investor.",
        );
      }
      // Source-scoped: the cut reveals that source's per-job margin. That is a
      // §4.4 leak only when the source is owned by a DIFFERENT partner (a
      // business-controlled channel benefit, or the partner's own channel, is fine).
      const owner = await this.sourceOwner(tx, dto.sourcePartyId!);
      if (owner && owner.id !== dto.toPartyId && (owner.partyType ?? []).includes("partner")) {
        throw new BadRequestException(
          "A percentage share of this source reveals its per-job margin, which belongs to another partner (§4.4). Use a fixed amount, or grant the share to the source's controller or a non-partner.",
        );
      }
    }

    const [row] = await tx
      .insert(schema.dealTerm)
      .values({
        orgId: principal.orgId,
        fromPartyId: null, // the business pays the share
        toPartyId: dto.toPartyId,
        appliesTo,
        termType: "profit_share",
        basis: dto.basis,
        value: String(dto.value),
        effectiveFrom: dto.effectiveFrom.slice(0, 10),
        createdBy: principal.userId,
      })
      .returning({ id: schema.dealTerm.id });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "profit_share.term_set",
      entity: "deal_term",
      entityId: row!.id,
      detail: { toPartyId: dto.toPartyId, basis: dto.basis, value: dto.value, appliesTo },
    });
    return { id: row!.id, toPartyId: dto.toPartyId, basis: dto.basis, value: dto.value, appliesTo };
  }

  // ── per-job pool view (admin; money-entitled — gated channels:approve) ────────
  async jobProfitShares(tx: Db, workItemId: string) {
    const [job] = await tx
      .select({ id: schema.workItem.id, createdAt: schema.workItem.createdAt })
      .from(schema.workItem)
      .where(eq(schema.workItem.id, workItemId));
    if (!job) throw new NotFoundException("Work item not found");
    const jobDate = job.createdAt.toISOString().slice(0, 10);

    // Pool bases via the SECURITY DEFINER (an admin isn't a party to the legs).
    const poolRes = await tx.execute(
      sql`select revenue, writer_cost as "writerCost", source_party_id as "sourcePartyId" from profit_share_pool(${workItemId})`,
    );
    const pr = poolRes.rows[0] as
      | { revenue: string; writerCost: string; sourcePartyId: string | null }
      | undefined;
    const revenue = Number(pr?.revenue ?? 0);
    const writerCost = Number(pr?.writerCost ?? 0);
    const sourcePartyId = pr?.sourcePartyId ?? null;

    // Every profit_share term in the org, grouped by beneficiary.
    const terms = (await tx
      .select()
      .from(schema.dealTerm)
      .where(eq(schema.dealTerm.termType, "profit_share"))) as unknown as DealTermLike[];
    const byParty = new Map<string, DealTermLike[]>();
    for (const t of terms) {
      if (!t.toPartyId) continue;
      const list = byParty.get(t.toPartyId);
      if (list) list.push(t);
      else byParty.set(t.toPartyId, [t]);
    }
    const sharers = [...byParty.entries()].map(([toPartyId, ts]) => ({ toPartyId, terms: ts }));

    const jobInput: ProfitShareJobInput = { workItemId, jobDate, revenue, writerCost, sourcePartyId };
    const result = deriveProfitShares(jobInput, sharers);

    // Decorate cuts with the beneficiary's name (and label the residual owner).
    const names = await this.partyNames(tx, [
      ...result.cuts.map((c) => c.toPartyId),
      ...(sourcePartyId ? [sourcePartyId] : []),
    ]);
    const controller = sourcePartyId ? await this.channelController(tx, sourcePartyId) : null;
    return {
      workItemId,
      jobDate,
      ...result,
      cuts: result.cuts.map((c) => ({ ...c, toPartyName: names.get(c.toPartyId) ?? null })),
      residualOwner: controller, // null = business
    };
  }

  // ── sharer self-view (own cuts only; §D: per-job for source, aggregate for net) ─
  async myProfitShare(tx: Db, principal: SessionPrincipal, q: MyProfitShareQueryDto) {
    if (!principal.partyId) {
      return { total: 0, dividendTotal: 0, channelShares: [], jobCount: 0 };
    }
    const res = await tx.execute(sql`
      select work_item_id as "workItemId", job_date as "jobDate", amount, scope
      from my_profit_share(${principal.partyId})
    `);
    const rows = res.rows as Array<{ workItemId: string; jobDate: string; amount: string; scope: string }>;

    let total = 0;
    let dividendTotal = 0;
    const channelShares: Array<{ workItemId: string; jobDate: string; amount: number }> = [];
    for (const r of rows) {
      const amt = Number(r.amount);
      total = round2(total + amt);
      if (r.scope === "source") {
        // Channel-scoped: safe to show per-job (the base is the channel's margin).
        if (q.from && r.jobDate < q.from.slice(0, 10)) continue;
        if (q.to && r.jobDate > q.to.slice(0, 10)) continue;
        channelShares.push({ workItemId: r.workItemId, jobDate: r.jobDate, amount: amt });
      } else {
        // Default net dividend: AGGREGATE-ONLY (never expose a per-job net, §4.4).
        dividendTotal = round2(dividendTotal + amt);
      }
    }
    return { total, dividendTotal, channelShares, jobCount: rows.length };
  }

  /**
   * The caller's OWN running settlement balance vs the business (P0 item 3 + the
   * 0036 cost-attribution follow-on): owed = profit-share accrued − net transfers
   * received − costs the caller bears. Opacity-safe by construction: the accrual
   * comes from the caller-guarded `my_profit_share` definer (own cuts only;
   * default net dividends already aggregated), settlement_transfer RLS scopes to
   * transfers the caller is a party to, and the borne-cost sum SELF-FILTERS to the
   * caller's own attribution (expenses are org-tenant-RLS; only the caller's own
   * bearer_party_id / split share is ever summed, never another party's figure).
   * (Admins net across ALL partners via a future approve-gated board.)
   */
  async mySettlementBalance(tx: Db, principal: SessionPrincipal) {
    if (!principal.partyId) return { accrued: 0, received: 0, borneCost: 0, owed: 0 };
    const acc = await tx.execute(sql`select coalesce(sum(amount), 0) as total from my_profit_share(${principal.partyId})`);
    const accrued = Number((acc.rows[0] as { total: string }).total);
    const transfers = await tx
      .select({
        fromPartyId: schema.settlementTransfer.fromPartyId,
        toPartyId: schema.settlementTransfer.toPartyId,
        amount: schema.settlementTransfer.amount,
      })
      .from(schema.settlementTransfer)
      .where(
        or(
          eq(schema.settlementTransfer.fromPartyId, principal.partyId),
          eq(schema.settlementTransfer.toPartyId, principal.partyId),
        ),
      );
    // Costs the caller BEARS (derive-at-read; only their own attribution is summed):
    //  • cost_bearer='party'  → the whole amount, when bearer_party_id = caller
    //  • cost_bearer='split'  → amount × (caller's share ÷ Σ shares)
    // Archived expenses are excluded (soft-delete). Never sums another party's cost.
    const costRes = await tx.execute(sql`
      select coalesce(sum(
        case
          when cost_bearer = 'party' and bearer_party_id = ${principal.partyId}::uuid then amount
          when cost_bearer = 'split' and jsonb_exists(cost_bearer_split_json, ${principal.partyId})
            then amount * (cost_bearer_split_json->>${principal.partyId})::numeric
                 / nullif((select sum(v::numeric) from jsonb_each_text(cost_bearer_split_json) as e(k, v)), 0)
          else 0
        end
      ), 0) as borne
      from expense
      where archived_at is null
    `);
    const borneCost = Number((costRes.rows[0] as { borne: string }).borne);
    return derivePartnerBalance(accrued, transfers as SettlementTransferRow[], principal.partyId, borneCost);
  }

  // ── helpers ───────────────────────────────────────────────────────────────────
  private async assertParty(tx: Db, id: string, label: string) {
    const [p] = await tx
      .select({ id: schema.party.id, partyType: schema.party.partyType })
      .from(schema.party)
      .where(and(eq(schema.party.id, id), isNull(schema.party.archivedAt)));
    if (!p) throw new NotFoundException(`${label} party not found`);
    return p;
  }

  private async partyNames(tx: Db, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await tx
      .select({ id: schema.party.id, displayName: schema.party.displayName })
      .from(schema.party)
      .where(inArray(schema.party.id, unique));
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }

  /** The controller of a channel given its source party id (null = business). */
  private async channelController(tx: Db, sourcePartyId: string) {
    const [ch] = await tx
      .select({ controllerPartyId: schema.channel.controllerPartyId })
      .from(schema.channel)
      .where(eq(schema.channel.partyId, sourcePartyId));
    if (!ch || !ch.controllerPartyId) return null;
    const names = await this.partyNames(tx, [ch.controllerPartyId]);
    return { partyId: ch.controllerPartyId, name: names.get(ch.controllerPartyId) ?? null };
  }
}
