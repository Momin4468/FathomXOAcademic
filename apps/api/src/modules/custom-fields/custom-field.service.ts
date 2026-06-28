import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import {
  isFieldApplicable,
  missingRequired,
  validateCustomValue,
  type CustomFieldDefLike,
  type RecordScope,
  type SessionPrincipal,
} from "@business-os/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type {
  CreateCustomFieldDto,
  ListCustomFieldQueryDto,
  SearchCustomFieldQueryDto,
  UpdateCustomFieldDto,
} from "./dto.js";

/** Records that carry a custom_json column (0023) → (table, label) for search. */
const TARGET_TABLES: Record<string, { table: string; label: string }> = {
  work_item: { table: "work_item", label: "title" },
  party: { table: "party", label: "display_name" },
  project: { table: "project", label: "title" },
};

/**
 * Custom fields (DESIGN_SPEC §2 #10, §8). The admin catalog (`custom_field_def`)
 * + per-record values (`custom_json`, keyed by the def id). Defining fields is
 * governed (custom_fields:approve); values are validated at the record's edit
 * boundary against the catalog (type/options/applicability HARD; required soft —
 * hard only at a governance gate). Exported for reuse by the record modules.
 */
@Injectable()
export class CustomFieldService {
  constructor(private readonly audit: AuditService) {}

  // ── catalog management (governed) ────────────────────────────────────────────
  async createDef(tx: Db, principal: SessionPrincipal, dto: CreateCustomFieldDto) {
    if (dto.fieldType === "select" && (!dto.options || dto.options.length === 0)) {
      throw new BadRequestException("A select field needs at least one option");
    }
    const [row] = await tx
      .insert(schema.customFieldDef)
      .values({
        orgId: principal.orgId,
        targetEntity: dto.targetEntity,
        fieldName: dto.fieldName.trim(),
        fieldType: dto.fieldType,
        optionsJson: dto.fieldType === "select" ? (dto.options ?? []) : null,
        scopeJson: dto.scope ?? {},
        required: dto.required ?? false,
        sort: dto.sort ?? 0,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "custom_field.created",
      entity: "custom_field_def",
      entityId: row!.id,
      detail: { targetEntity: dto.targetEntity, fieldName: dto.fieldName, fieldType: dto.fieldType },
    });
    return row!;
  }

  listDefs(tx: Db, q: ListCustomFieldQueryDto) {
    const conds = [];
    if (q.targetEntity) conds.push(eq(schema.customFieldDef.targetEntity, q.targetEntity));
    if (q.includeArchived !== "true") conds.push(isNull(schema.customFieldDef.archivedAt));
    return tx
      .select()
      .from(schema.customFieldDef)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(schema.customFieldDef.sort), asc(schema.customFieldDef.fieldName));
  }

  private async getDef(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(schema.customFieldDef)
      .where(eq(schema.customFieldDef.id, id));
    if (!row) throw new NotFoundException("Custom field not found");
    return row;
  }

  async updateDef(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateCustomFieldDto) {
    const def = await this.getDef(tx, id);
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.fieldName !== undefined) patch.fieldName = dto.fieldName.trim();
    if (dto.options !== undefined) {
      if (def.fieldType === "select" && dto.options.length === 0) {
        throw new BadRequestException("A select field needs at least one option");
      }
      patch.optionsJson = def.fieldType === "select" ? dto.options : null;
    }
    if (dto.scope !== undefined) patch.scopeJson = dto.scope;
    if (dto.required !== undefined) patch.required = dto.required;
    if (dto.sort !== undefined) patch.sort = dto.sort;
    if (dto.active !== undefined) patch.archivedAt = dto.active ? null : new Date();
    const [row] = await tx
      .update(schema.customFieldDef)
      .set(patch)
      .where(eq(schema.customFieldDef.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "custom_field.updated",
      entity: "custom_field_def",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return row!;
  }

  async archiveDef(tx: Db, principal: SessionPrincipal, id: string) {
    await this.getDef(tx, id);
    await tx
      .update(schema.customFieldDef)
      .set({ archivedAt: new Date(), updatedBy: principal.userId, updatedAt: new Date() })
      .where(eq(schema.customFieldDef.id, id));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "custom_field.archived",
      entity: "custom_field_def",
      entityId: id,
    });
    return { ok: true };
  }

  // ── per-record values (used by the record modules) ───────────────────────────
  private async activeDefs(tx: Db, targetEntity: string): Promise<CustomFieldDefLike[]> {
    const rows = await tx
      .select()
      .from(schema.customFieldDef)
      .where(
        and(
          eq(schema.customFieldDef.targetEntity, targetEntity),
          isNull(schema.customFieldDef.archivedAt),
        ),
      );
    return rows as unknown as CustomFieldDefLike[];
  }

  /**
   * Validate a record's custom_json against the catalog (HARD): every provided key
   * must be an applicable, active def for this entity+record, and the value must
   * match the field's type/options. Returns the validated map. Required-ness is
   * NOT enforced here (soft — see assertRequiredComplete).
   */
  async validateValues(
    tx: Db,
    targetEntity: string,
    record: RecordScope,
    customJson: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown>> {
    const values = customJson ?? {};
    if (Object.keys(values).length === 0) return {};
    const defs = await this.activeDefs(tx, targetEntity);
    const byId = new Map(defs.map((d) => [d.id, d]));
    for (const [key, value] of Object.entries(values)) {
      const def = byId.get(key);
      if (!def || !isFieldApplicable(def, record)) {
        throw new BadRequestException(`Unknown or inapplicable custom field: ${key}`);
      }
      const check = validateCustomValue(def, value);
      if (!check.ok) throw new BadRequestException(check.error);
    }
    return values;
  }

  /** Hard gate: throw if any applicable, required field is empty on the record. */
  async assertRequiredComplete(
    tx: Db,
    targetEntity: string,
    record: RecordScope,
    customJson: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    const defs = await this.activeDefs(tx, targetEntity);
    const missing = missingRequired(defs, customJson, record);
    if (missing.length > 0) {
      const names = defs.filter((d) => missing.includes(d.id)).map((d) => d.fieldName);
      throw new BadRequestException(`Required custom field(s) missing: ${names.join(", ")}`);
    }
  }

  /** The applicable fields + current values for a record's detail read-model. */
  async describeForRecord(
    tx: Db,
    targetEntity: string,
    record: RecordScope,
    customJson: Record<string, unknown> | null | undefined,
  ) {
    const values = customJson ?? {};
    const defs = await this.activeDefs(tx, targetEntity);
    return defs
      .filter((d) => isFieldApplicable(d, record))
      .map((d) => ({
        id: d.id,
        fieldName: d.fieldName,
        fieldType: d.fieldType,
        options: Array.isArray(d.optionsJson) ? d.optionsJson : null,
        required: d.required,
        value: values[d.id] ?? null,
        missingRequired: d.required && (values[d.id] == null || values[d.id] === ""),
      }));
  }

  // ── search (the "verify later" use-case) ─────────────────────────────────────
  async search(tx: Db, dto: SearchCustomFieldQueryDto) {
    const target = TARGET_TABLES[dto.targetEntity];
    if (!target) throw new BadRequestException("Unsupported target entity");
    const like = `%${dto.q.trim()}%`;
    // table/label come from a fixed allowlist (sql.raw); fieldId + value are
    // parameterized. RLS scopes the rows to the caller's org.
    const res = await tx.execute(sql`
      select id, ${sql.raw(`"${target.label}"`)} as label
      from ${sql.raw(target.table)}
      where custom_json ->> ${dto.fieldId} ilike ${like}
        and archived_at is null
      order by ${sql.raw(`"${target.label}"`)}
      limit 50
    `);
    return res.rows as Array<{ id: string; label: string }>;
  }
}
