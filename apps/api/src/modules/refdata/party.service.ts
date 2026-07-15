import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { PartyType, RecordScope, SessionPrincipal } from "@business-os/shared";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { CustomFieldService } from "../custom-fields/custom-field.service.js";
import { ReferenceService } from "./reference.service.js";
import type { CreatePartyDto, UpdatePartyDto } from "./dto.js";

const LIST_COLS = {
  id: schema.party.id,
  displayName: schema.party.displayName,
  partyType: schema.party.partyType,
  externalRef: schema.party.externalRef,
  universityId: schema.party.universityId,
  programme: schema.party.programme,
  referredByPartyId: schema.party.referredByPartyId,
};

/**
 * Party / client directory (DESIGN_SPEC §7). Capture-first create (a typed
 * university auto-resolves to canonical reference data), list/search, and detail
 * with the referred-by chain. Gated by the `reference` module permissions, so
 * client contact is never exposed to roles without them (e.g. Writers).
 */
@Injectable()
export class PartyService {
  constructor(
    private readonly reference: ReferenceService,
    private readonly audit: AuditService,
    private readonly customFields: CustomFieldService,
  ) {}

  /** A party's matchable custom-field scope (by-university; global otherwise). */
  private partyScope(p: { id?: string | null; universityId?: string | null }): RecordScope {
    return { clientPartyId: p.id ?? null, universityRefId: p.universityId ?? null };
  }

  async search(tx: Db, q: string | undefined, type: PartyType | undefined, limit = 50) {
    const filters = [isNull(schema.party.archivedAt)];
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      filters.push(or(ilike(schema.party.displayName, like), ilike(schema.party.externalRef, like))!);
    }
    if (type) {
      filters.push(sql`${schema.party.partyType} @> array[${type}]::text[]`);
    }
    return tx
      .select(LIST_COLS)
      .from(schema.party)
      .where(and(...filters))
      .orderBy(schema.party.displayName)
      .limit(limit);
  }

  /**
   * Batched Clients directory (handoff §10): every client party with university
   * name, added-by (the creating user's person/email), a display Contact that is
   * server-side MASKED unless `canSeeContact`, and derived expected/paid/remaining
   * (AR rolled up per client from non-void invoices − allocations). Runs under the
   * caller's RLS (org-scoped); money is derived at read time, never stored.
   */
  async listClients(tx: Db, canSeeContact: boolean) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const res = await tx.execute(sql`
      select p.id, p.display_name as "displayName", p.external_ref as "externalRef",
             p.programme, u.canonical as university, p.university_id as "universityId",
             coalesce(cp.display_name, uc.email) as "addedBy",
             p.contact_json as contact,
             coalesce(ar.billed, 0) as expected,
             coalesce(ar.paid, 0) as paid
      from party p
      left join ref_entity u on u.id = p.university_id
      left join user_account uc on uc.id = p.created_by
      left join party cp on cp.id = uc.party_id
      left join lateral (
        select sum(il.amount) as billed,
               sum(coalesce((select sum(pa.amount) from payment_allocation pa where pa.invoice_line_id = il.id), 0)) as paid
        from invoice i join invoice_line il on il.invoice_id = i.id
        where i.client_party_id = p.id and i.status <> 'void'
      ) ar on true
      where p.party_type @> array['client']::text[] and p.archived_at is null
      order by p.display_name
    `);
    return (res.rows as Array<Record<string, unknown>>).map((row) => {
      const c = (row.contact ?? {}) as { email?: string; phone?: string };
      const expected = r2(Number(row.expected ?? 0));
      const paid = r2(Number(row.paid ?? 0));
      return {
        id: row.id as string,
        displayName: row.displayName as string,
        externalRef: (row.externalRef as string | null) ?? null,
        programme: (row.programme as string | null) ?? null,
        university: (row.university as string | null) ?? null,
        universityId: (row.universityId as string | null) ?? null,
        addedBy: (row.addedBy as string | null) ?? null,
        // Masked contact never leaves the server as the real value.
        contact: canSeeContact ? [c.phone, c.email].filter(Boolean).join(" · ") || null : null,
        contactMasked: !canSeeContact,
        expected,
        paid,
        remaining: r2(expected - paid),
      };
    });
  }

  /** Detail incl. resolved university canonical + referred-by name. */
  async getById(tx: Db, id: string) {
    const res = await tx.execute(sql`
      select p.id, p.display_name as "displayName", p.party_type as "partyType",
             p.external_ref as "externalRef", p.programme, p.contact_json as "contact",
             p.university_id as "universityId", u.canonical as "universityCanonical",
             p.referred_by_party_id as "referredByPartyId", r.display_name as "referredByName",
             p.custom_json as "customJson", p.created_at as "createdAt"
      from party p
      left join ref_entity u on u.id = p.university_id
      left join party r on r.id = p.referred_by_party_id
      where p.id = ${id} and p.archived_at is null
    `);
    const row = res.rows[0] as
      | { id: string; universityId: string | null; customJson: Record<string, unknown> | null }
      | undefined;
    if (!row) throw new NotFoundException("Party not found");
    const customFields = await this.customFields.describeForRecord(
      tx,
      "party",
      this.partyScope({ id: row.id, universityId: row.universityId }),
      row.customJson,
    );
    return { ...row, customFields };
  }

  /** Read-only lookup by exact (case-insensitive) display name or external ref —
   *  the import/AI resolution path, never creates. Returns the first match or null. */
  async findByName(tx: Db, name: string): Promise<{ id: string; displayName: string } | null> {
    const n = name.trim();
    if (!n) return null;
    const [row] = await tx
      .select({ id: schema.party.id, displayName: schema.party.displayName })
      .from(schema.party)
      .where(
        and(
          isNull(schema.party.archivedAt),
          or(ilike(schema.party.displayName, n), ilike(schema.party.externalRef, n)),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async create(tx: Db, principal: SessionPrincipal, dto: CreatePartyDto, opts?: { aiCaptureId?: string; importBatchId?: string }) {
    // Capture-first: a typed university name auto-resolves (or creates provisional).
    let universityId = dto.universityId ?? null;
    if (!universityId && dto.universityRaw?.trim()) {
      const { entity } = await this.reference.resolveOrCreate(tx, principal, {
        kind: "university",
        raw: dto.universityRaw,
      });
      universityId = entity.id;
    }

    const customJson = await this.customFields.validateValues(
      tx,
      "party",
      this.partyScope({ universityId }),
      dto.customJson,
    );
    const [party] = await tx
      .insert(schema.party)
      .values({
        orgId: principal.orgId,
        displayName: dto.displayName.trim(),
        partyType: dto.partyType ?? [],
        externalRef: dto.externalRef ?? null,
        universityId,
        programme: dto.programme ?? null,
        contactJson: dto.contact ?? {},
        referredByPartyId: dto.referredByPartyId ?? null,
        customJson,
        aiCaptureId: opts?.aiCaptureId ?? null,
        importBatchId: opts?.importBatchId ?? null,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning({ id: schema.party.id });

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "party.created",
      entity: "party",
      entityId: party!.id,
      detail: { displayName: dto.displayName, partyType: dto.partyType ?? [] },
    });
    return this.getById(tx, party!.id);
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdatePartyDto) {
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.displayName !== undefined) patch.displayName = dto.displayName.trim();
    if (dto.partyType !== undefined) {
      // §4.4 OPACITY: tagging a party 'partner' must not retroactively turn a
      // standing net-profit dividend (allowed only for a non-partner silent
      // investor) into a partner's whole-business-margin window. Refuse the tag
      // while such a term is live (close it or scope it to a channel first).
      if (dto.partyType.includes("partner")) {
        const live = await tx.execute(sql`
          select 1 from deal_term
          where org_id = ${principal.orgId} and to_party_id = ${id}
            and term_type = 'profit_share' and applies_to = 'default'
            and basis in ('pct_of_net', 'pct_after_writer')
            and (effective_to is null or effective_to > current_date)
          limit 1
        `);
        if (live.rows.length > 0) {
          throw new BadRequestException(
            "This party holds a standing net-profit dividend, which is allowed only for a non-partner investor. End or channel-scope that profit share before tagging them a partner (§4.4).",
          );
        }
      }
      patch.partyType = dto.partyType;
    }
    if (dto.externalRef !== undefined) patch.externalRef = dto.externalRef;
    if (dto.universityId !== undefined) patch.universityId = dto.universityId;
    if (dto.programme !== undefined) patch.programme = dto.programme;
    if (dto.contact !== undefined) patch.contactJson = dto.contact;
    if (dto.referredByPartyId !== undefined) patch.referredByPartyId = dto.referredByPartyId;
    if (dto.customJson !== undefined) {
      const [cur] = await tx
        .select({ universityId: schema.party.universityId, customJson: schema.party.customJson })
        .from(schema.party)
        .where(eq(schema.party.id, id));
      const validated = await this.customFields.validateValues(
        tx,
        "party",
        this.partyScope({ id, universityId: dto.universityId ?? cur?.universityId }),
        dto.customJson,
      );
      patch.customJson = { ...((cur?.customJson as Record<string, unknown>) ?? {}), ...validated };
    }

    const [row] = await tx
      .update(schema.party)
      .set(patch)
      .where(and(eq(schema.party.id, id), isNull(schema.party.archivedAt)))
      .returning({ id: schema.party.id });
    if (!row) throw new NotFoundException("Party not found");

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "party.updated",
      entity: "party",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt") },
    });
    return this.getById(tx, id);
  }
}
