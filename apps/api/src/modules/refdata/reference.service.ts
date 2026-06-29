import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { normalize, type RefKind, type SessionPrincipal } from "@business-os/shared";
import { and, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";

export interface RefEntityView {
  id: string;
  kind: string;
  canonical: string;
  status: string;
  parentId: string | null;
  archivedAt: Date | null;
  mergedIntoId: string | null;
}

const ENTITY_COLS = {
  id: schema.refEntity.id,
  kind: schema.refEntity.kind,
  canonical: schema.refEntity.canonical,
  status: schema.refEntity.status,
  parentId: schema.refEntity.parentId,
  archivedAt: schema.refEntity.archivedAt,
  mergedIntoId: schema.refEntity.mergedIntoId,
};

/**
 * Canonical reference data (DESIGN_SPEC §7). Fuzzy-in / canonical-out resolution,
 * provisional→confirmed governance, and merge (the duplicate-killer). All work
 * runs inside the caller's tenant transaction so RLS scopes every row.
 */
@Injectable()
export class ReferenceService {
  constructor(private readonly audit: AuditService) {}

  /** Type-ahead: rank by exact normalized hit, then trigram similarity. */
  async search(tx: Db, kind: RefKind, q: string | undefined, limit = 20): Promise<RefEntityView[]> {
    if (!q || q.trim() === "") {
      return tx
        .select(ENTITY_COLS)
        .from(schema.refEntity)
        .where(and(eq(schema.refEntity.kind, kind), isNull(schema.refEntity.archivedAt)))
        .orderBy(schema.refEntity.canonical)
        .limit(limit);
    }
    const nq = normalize(q);
    const res = await tx.execute(sql`
      select e.id, e.kind, e.canonical, e.status, e.parent_id as "parentId",
             max((a.normalized = ${nq})::int) as exact,
             max(similarity(a.normalized, ${nq})) as sim
      from ref_alias a
      join ref_entity e on e.id = a.ref_id
      where e.kind = ${kind} and e.archived_at is null
      group by e.id, e.kind, e.canonical, e.status, e.parent_id
      having max((a.normalized = ${nq})::int) = 1
          or max(similarity(a.normalized, ${nq})) > 0.2
      order by exact desc, sim desc, e.canonical
      limit ${limit}
    `);
    return res.rows as unknown as RefEntityView[];
  }

  async getById(tx: Db, id: string): Promise<RefEntityView> {
    const [row] = await tx.select(ENTITY_COLS).from(schema.refEntity).where(eq(schema.refEntity.id, id));
    if (!row) throw new NotFoundException("Reference entity not found");
    return row;
  }

  /**
   * Read-only canonical lookup (the import DRY-RUN path): exact normalized-alias
   * match, NEVER creates. Returns the canonical entity or null. resolveOrCreate
   * is the write path used at commit.
   */
  async lookup(tx: Db, kind: RefKind, raw: string): Promise<RefEntityView | null> {
    const nq = normalize(raw ?? "");
    if (!nq) return null;
    const res = await tx.execute(sql`
      select e.id, e.kind, e.canonical, e.status, e.parent_id as "parentId"
      from ref_alias a
      join ref_entity e on e.id = a.ref_id
      where a.normalized = ${nq} and e.kind = ${kind} and e.archived_at is null
      limit 1
    `);
    return (res.rows[0] as unknown as RefEntityView) ?? null;
  }

  /**
   * Resolve a typed value to its canonical entity, or create a PROVISIONAL one.
   * Capture-first: this never blocks (a writer typing a new code just creates a
   * provisional entity for a steward to confirm/merge later).
   */
  async resolveOrCreate(
    tx: Db,
    principal: SessionPrincipal,
    args: { kind: RefKind; raw: string; parentId?: string | null },
  ): Promise<{ entity: RefEntityView; created: boolean }> {
    const raw = args.raw.trim();
    if (!raw) throw new BadRequestException("raw is required");
    const nq = normalize(raw);

    const existing = await tx.execute(sql`
      select e.id, e.kind, e.canonical, e.status, e.parent_id as "parentId"
      from ref_alias a
      join ref_entity e on e.id = a.ref_id
      where a.normalized = ${nq} and e.kind = ${args.kind} and e.archived_at is null
      limit 1
    `);
    if (existing.rows[0]) {
      return { entity: existing.rows[0] as unknown as RefEntityView, created: false };
    }

    const [entity] = await tx
      .insert(schema.refEntity)
      .values({
        orgId: principal.orgId,
        kind: args.kind,
        canonical: raw,
        parentId: args.parentId ?? null,
        status: "provisional",
        createdBy: principal.userId,
      })
      .returning(ENTITY_COLS);
    await tx.insert(schema.refAlias).values({
      orgId: principal.orgId,
      refId: entity!.id,
      alias: raw,
      normalized: nq,
    });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "reference.entity_created",
      entity: "ref_entity",
      entityId: entity!.id,
      detail: { kind: args.kind, canonical: raw, status: "provisional" },
    });
    return { entity: entity!, created: true };
  }

  /** Add another spelling (alias) to an entity. */
  async addAlias(tx: Db, principal: SessionPrincipal, refId: string, raw: string): Promise<void> {
    const alias = raw.trim();
    if (!alias) throw new BadRequestException("alias is required");
    await this.getById(tx, refId); // 404 if missing / cross-org
    await tx
      .insert(schema.refAlias)
      .values({ orgId: principal.orgId, refId, alias, normalized: normalize(alias) })
      .onConflictDoNothing();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "reference.alias_added",
      entity: "ref_entity",
      entityId: refId,
      detail: { alias },
    });
  }

  /** Steward action: promote a provisional entity to confirmed. */
  async confirm(tx: Db, principal: SessionPrincipal, id: string): Promise<RefEntityView> {
    const [row] = await tx
      .update(schema.refEntity)
      .set({ status: "confirmed", confirmedBy: principal.userId, confirmedAt: new Date() })
      .where(and(eq(schema.refEntity.id, id), isNull(schema.refEntity.archivedAt)))
      .returning(ENTITY_COLS);
    if (!row) throw new NotFoundException("Reference entity not found");
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "reference.entity_confirmed",
      entity: "ref_entity",
      entityId: id,
    });
    return row;
  }

  /**
   * Steward action: merge a duplicate (source) into a canonical survivor (target).
   * Moves aliases, keeps the old canonical name resolving, repoints FK references,
   * and archives the source pointing at the target. Atomic within the caller's tx.
   */
  async merge(
    tx: Db,
    principal: SessionPrincipal,
    sourceId: string,
    targetId: string,
  ): Promise<RefEntityView> {
    if (sourceId === targetId) throw new BadRequestException("Cannot merge an entity into itself");
    const source = await this.getById(tx, sourceId); // 404 if missing/cross-org
    const target = await this.getById(tx, targetId);
    if (source.kind !== target.kind) {
      throw new BadRequestException("Cannot merge entities of different kinds");
    }
    // Don't merge from/into a tombstone (an already-archived/merged entity).
    if (source.archivedAt) throw new BadRequestException("Source entity is already archived/merged");
    if (target.archivedAt) throw new BadRequestException("Cannot merge into an archived/merged entity");

    // Drop source aliases whose normalized already exists on target (avoid unique clash)...
    await tx.execute(sql`
      delete from ref_alias
      where ref_id = ${sourceId}
        and normalized in (select normalized from ref_alias where ref_id = ${targetId})
    `);
    // ...then move the remaining source aliases to the target.
    await tx.execute(sql`update ref_alias set ref_id = ${targetId} where ref_id = ${sourceId}`);
    // Ensure the source's old canonical name still resolves to the target.
    await tx
      .insert(schema.refAlias)
      .values({
        orgId: principal.orgId,
        refId: targetId,
        alias: source.canonical,
        normalized: normalize(source.canonical),
      })
      .onConflictDoNothing();
    // Repoint known FK references to the survivor (more as ref-consuming tables
    // are added). party.university_id + work_item course/assignment refs.
    await tx.execute(sql`
      update party set university_id = ${targetId} where university_id = ${sourceId}
    `);
    await tx.execute(sql`
      update work_item set course_ref_id = ${targetId} where course_ref_id = ${sourceId}
    `);
    await tx.execute(sql`
      update work_item set assignment_type_ref_id = ${targetId} where assignment_type_ref_id = ${sourceId}
    `);
    // Archive the source, redirecting to the survivor.
    await tx
      .update(schema.refEntity)
      .set({ archivedAt: new Date(), mergedIntoId: targetId })
      .where(eq(schema.refEntity.id, sourceId));

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "reference.entity_merged",
      entity: "ref_entity",
      entityId: sourceId,
      detail: { sourceId, targetId },
    });
    return this.getById(tx, targetId);
  }
}
