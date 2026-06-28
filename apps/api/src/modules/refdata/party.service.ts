import { Injectable, NotFoundException } from "@nestjs/common";
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

  async create(tx: Db, principal: SessionPrincipal, dto: CreatePartyDto) {
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
    if (dto.partyType !== undefined) patch.partyType = dto.partyType;
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
