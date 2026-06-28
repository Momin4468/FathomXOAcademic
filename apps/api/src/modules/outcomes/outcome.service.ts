import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { deriveReputation, type OutcomeLike, type SessionPrincipal } from "@business-os/shared";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import type { ListOutcomesQueryDto, RecordOutcomeDto, UpdateOutcomeDto, WriterProfileDto } from "./dto.js";

/** The columns reputation reads, selected with the work's writer for scoping. */
const OUTCOME_COLS = {
  id: schema.workOutcome.id,
  workItemId: schema.workOutcome.workItemId,
  onTime: schema.workOutcome.onTime,
  daysLate: schema.workOutcome.daysLate,
  revisionCount: schema.workOutcome.revisionCount,
  revisionFault: schema.workOutcome.revisionFault,
  grade: schema.workOutcome.grade,
  markerFeedback: schema.workOutcome.markerFeedback,
  complaint: schema.workOutcome.complaint,
  complaintReason: schema.workOutcome.complaintReason,
  failed: schema.workOutcome.failed,
  aiScore: schema.workOutcome.aiScore,
  satisfaction: schema.workOutcome.satisfaction,
  reworkCost: schema.workOutcome.reworkCost,
  disputed: schema.workOutcome.disputed,
  recordedBy: schema.workOutcome.recordedBy,
  recordedAt: schema.workOutcome.recordedAt,
  writerPartyId: schema.workItem.doerPartyId,
} as const;

/**
 * Per-work outcomes (§8) + the DERIVED reputation read-model. Outcomes are
 * entered by an authorized role (the outcomes module) and NEVER self-reported by
 * the writer (the no-self-report guard). Reputation/course-history/load are all
 * derived at read time — never stored.
 */
@Injectable()
export class OutcomeService {
  constructor(private readonly audit: AuditService) {}

  /**
   * A "manager" caller who can read across all writers and edit any writer's
   * profile — i.e. anyone who records outcomes (the delegated marker/QA role with
   * outcomes:edit, or an Admin with approve), plus System SuperAdmin. A plain
   * Writer (outcomes:view only) is NOT a manager → own-only. Read and
   * profile-edit use this same capability so there's no read/write asymmetry.
   */
  private canSeeAll(principal: SessionPrincipal, perms: EffectivePermissions): boolean {
    return (
      principal.isSystemSuperadmin ||
      perms.perms.has("outcomes:approve") ||
      perms.perms.has("outcomes:edit")
    );
  }

  private async loadWorkItem(tx: Db, workItemId: string) {
    const [wi] = await tx
      .select({ id: schema.workItem.id, doerPartyId: schema.workItem.doerPartyId })
      .from(schema.workItem)
      .where(eq(schema.workItem.id, workItemId));
    if (!wi) throw new NotFoundException("Work item not found");
    return wi;
  }

  /** Never let someone record/edit the outcome of a job they are the doer of. */
  private assertNotSelf(principal: SessionPrincipal, doerPartyId: string | null) {
    if (principal.partyId && doerPartyId && principal.partyId === doerPartyId) {
      throw new ForbiddenException("You cannot record an outcome for your own work");
    }
  }

  async record(tx: Db, principal: SessionPrincipal, dto: RecordOutcomeDto) {
    const wi = await this.loadWorkItem(tx, dto.workItemId);
    this.assertNotSelf(principal, wi.doerPartyId);

    const [existing] = await tx
      .select({ id: schema.workOutcome.id })
      .from(schema.workOutcome)
      .where(eq(schema.workOutcome.workItemId, dto.workItemId));
    if (existing) throw new ConflictException("An outcome already exists for this work item (edit it instead)");

    const values = {
      orgId: principal.orgId,
      workItemId: dto.workItemId,
      onTime: dto.onTime ?? null,
      daysLate: dto.daysLate ?? null,
      revisionCount: dto.revisionCount ?? 0,
      revisionFault: dto.revisionFault ?? null,
      grade: dto.grade ?? null,
      markerFeedback: dto.markerFeedback ?? null,
      complaint: dto.complaint ?? false,
      complaintReason: dto.complaintReason ?? null,
      failed: dto.failed ?? false,
      aiScore: dto.aiScore != null ? String(dto.aiScore) : null,
      satisfaction: dto.satisfaction ?? null,
      reworkCost: dto.reworkCost != null ? String(dto.reworkCost) : null,
      disputed: dto.disputed ?? false,
      recordedBy: principal.userId,
      updatedBy: principal.userId,
    };
    let row: typeof schema.workOutcome.$inferSelect | undefined;
    try {
      [row] = await tx.insert(schema.workOutcome).values(values).returning();
    } catch (err) {
      // Backstop the pre-check against a concurrent insert (unique work_item_id).
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictException("An outcome already exists for this work item (edit it instead)");
      }
      throw err;
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "outcome.recorded",
      entity: "work_outcome",
      entityId: row!.id,
      detail: { workItemId: dto.workItemId },
    });
    return row!;
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateOutcomeDto) {
    const [outcome] = await tx.select().from(schema.workOutcome).where(eq(schema.workOutcome.id, id));
    if (!outcome) throw new NotFoundException("Outcome not found");
    const wi = await this.loadWorkItem(tx, outcome.workItemId);
    this.assertNotSelf(principal, wi.doerPartyId);

    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    for (const k of ["onTime", "daysLate", "revisionCount", "revisionFault", "grade", "markerFeedback", "complaint", "complaintReason", "failed", "satisfaction", "disputed"] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (dto.aiScore !== undefined) patch.aiScore = dto.aiScore != null ? String(dto.aiScore) : null;
    if (dto.reworkCost !== undefined) patch.reworkCost = dto.reworkCost != null ? String(dto.reworkCost) : null;

    const [row] = await tx.update(schema.workOutcome).set(patch).where(eq(schema.workOutcome.id, id)).returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "outcome.updated",
      entity: "work_outcome",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return row!;
  }

  async list(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, q: ListOutcomesQueryDto) {
    const all = this.canSeeAll(principal, perms);
    const conds = [];
    if (q.workItemId) conds.push(eq(schema.workOutcome.workItemId, q.workItemId));
    if (all) {
      // Managers may filter by any writer (or none).
      if (q.writerPartyId) conds.push(eq(schema.workItem.doerPartyId, q.writerPartyId));
    } else {
      // Non-managers are UNCONDITIONALLY scoped to their own work (as the doer).
      if (!principal.partyId) throw new ForbiddenException("No party linked to this account");
      if (q.writerPartyId && q.writerPartyId !== principal.partyId) {
        throw new ForbiddenException("You can only view your own outcomes");
      }
      conds.push(eq(schema.workItem.doerPartyId, principal.partyId));
    }
    return tx
      .select(OUTCOME_COLS)
      .from(schema.workOutcome)
      .innerJoin(schema.workItem, eq(schema.workOutcome.workItemId, schema.workItem.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(schema.workOutcome.recordedAt);
  }

  /** Own-or-admin guard for the per-writer read endpoints. */
  private assertCanViewWriter(principal: SessionPrincipal, perms: EffectivePermissions, partyId: string) {
    if (!this.canSeeAll(principal, perms) && principal.partyId !== partyId) {
      throw new ForbiddenException("You can only view your own reputation");
    }
  }

  async getReputation(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, partyId: string) {
    this.assertCanViewWriter(principal, perms, partyId);
    const rows = await tx
      .select(OUTCOME_COLS)
      .from(schema.workOutcome)
      .innerJoin(schema.workItem, eq(schema.workOutcome.workItemId, schema.workItem.id))
      .where(eq(schema.workItem.doerPartyId, partyId));
    return { partyId, reputation: deriveReputation(rows as unknown as OutcomeLike[]) };
  }

  /** The consolidated writer card: profile + derived reputation/courseHistory/load. */
  async getWriterCard(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, partyId: string) {
    this.assertCanViewWriter(principal, perms, partyId);
    const [party] = await tx
      .select({
        id: schema.party.id,
        displayName: schema.party.displayName,
        expertiseTags: schema.party.expertiseTags,
        availability: schema.party.availability,
        maxConcurrent: schema.party.maxConcurrent,
      })
      .from(schema.party)
      .where(eq(schema.party.id, partyId));
    if (!party) throw new NotFoundException("Party not found");

    const outcomeRows = await tx
      .select(OUTCOME_COLS)
      .from(schema.workOutcome)
      .innerJoin(schema.workItem, eq(schema.workOutcome.workItemId, schema.workItem.id))
      .where(eq(schema.workItem.doerPartyId, partyId));

    // Course history auto-accumulates from logged jobs (derived, not stored).
    const courseRows = await tx.execute(sql`
      select wi.course_ref_id as "courseRefId", re.canonical as "courseName",
             count(*)::int as "jobCount", max(wi.created_at) as "lastWorkedAt"
      from work_item wi
      left join ref_entity re on re.id = wi.course_ref_id
      where wi.doer_party_id = ${partyId} and wi.course_ref_id is not null
      group by wi.course_ref_id, re.canonical
      order by max(wi.created_at) desc
    `);

    // Current load = open work items the writer is the doer of (derived).
    const loadRes = await tx.execute(sql`
      select count(*)::int as n from work_item
      where doer_party_id = ${partyId} and work_state in ('draft','pending','confirmed')
    `);
    const openJobs = Number((loadRes.rows[0] as { n: number }).n);

    return {
      profile: {
        partyId: party.id,
        displayName: party.displayName,
        expertiseTags: party.expertiseTags ?? [],
        availability: party.availability,
        maxConcurrent: party.maxConcurrent,
      },
      reputation: deriveReputation(outcomeRows as unknown as OutcomeLike[]),
      courseHistory: courseRows.rows,
      load: {
        openJobs,
        availability: party.availability,
        maxConcurrent: party.maxConcurrent,
        atCapacity: party.maxConcurrent != null ? openJobs >= party.maxConcurrent : null,
      },
    };
  }

  /** Edit a writer's profile/capacity — own party, or an admin (outcomes:edit). */
  async updateProfile(
    tx: Db,
    principal: SessionPrincipal,
    perms: EffectivePermissions,
    partyId: string,
    dto: WriterProfileDto,
  ) {
    // Own party, or a manager (same capability that can read across writers).
    if (!this.canSeeAll(principal, perms) && principal.partyId !== partyId) {
      throw new ForbiddenException("You can only edit your own profile");
    }
    const [exists] = await tx.select({ id: schema.party.id }).from(schema.party).where(eq(schema.party.id, partyId));
    if (!exists) throw new NotFoundException("Party not found");

    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    let changed = false;
    if (dto.expertiseTags !== undefined) { patch.expertiseTags = dto.expertiseTags; changed = true; }
    if (dto.availability !== undefined) { patch.availability = dto.availability; changed = true; }
    if (dto.maxConcurrent !== undefined) { patch.maxConcurrent = dto.maxConcurrent; changed = true; }
    if (!changed) throw new BadRequestException("Nothing to update");

    const [row] = await tx
      .update(schema.party)
      .set(patch)
      .where(eq(schema.party.id, partyId))
      .returning({
        partyId: schema.party.id,
        expertiseTags: schema.party.expertiseTags,
        availability: schema.party.availability,
        maxConcurrent: schema.party.maxConcurrent,
      });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "outcome.profile_updated",
      entity: "party",
      entityId: partyId,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return row!;
  }
}
