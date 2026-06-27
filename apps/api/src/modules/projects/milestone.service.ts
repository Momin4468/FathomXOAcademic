import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { MILESTONE_STATES, isValidTimeZone, urgency, zonedWallToInstant, type SessionPrincipal } from "@business-os/shared";
import { and, asc, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateMilestoneDto, UpdateMilestoneDto } from "./dto.js";

type MilestoneRow = typeof schema.milestone.$inferSelect;

/** Resolve a deadline from either an absolute instant or wall date+time+zone (§8). */
function resolveDue(dto: {
  dueAt?: string;
  dueDate?: string;
  dueTime?: string;
  dueTz?: string;
}): { dueAt: Date | null; dueTz: string | null } {
  if (dto.dueTz && !isValidTimeZone(dto.dueTz)) {
    throw new BadRequestException(`Invalid timezone: ${dto.dueTz}`);
  }
  if (dto.dueAt) return { dueAt: new Date(dto.dueAt), dueTz: dto.dueTz ?? null };
  if (dto.dueDate && dto.dueTime && dto.dueTz) {
    return { dueAt: new Date(zonedWallToInstant(dto.dueDate, dto.dueTime, dto.dueTz)), dueTz: dto.dueTz };
  }
  return { dueAt: null, dueTz: dto.dueTz ?? null };
}

@Injectable()
export class MilestoneService {
  constructor(private readonly audit: AuditService) {}

  /** Attach computed urgency ("time left") in the viewer's zone — derived, never stored. */
  private withUrgency(row: MilestoneRow) {
    return { ...row, urgency: urgency(row.dueAt ? row.dueAt.toISOString() : null) };
  }

  async create(tx: Db, principal: SessionPrincipal, projectId: string, dto: CreateMilestoneDto) {
    const { dueAt, dueTz } = resolveDue(dto);
    const [row] = await tx
      .insert(schema.milestone)
      .values({
        orgId: principal.orgId,
        projectId,
        title: dto.title.trim(),
        trackable: dto.trackable ?? true,
        billable: dto.billable ?? false,
        sort: dto.sort ?? 0,
        dueAt,
        dueTz,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "milestone.created",
      entity: "milestone",
      entityId: row!.id,
      detail: { projectId, title: row!.title },
    });
    return this.withUrgency(row!);
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateMilestoneDto) {
    const [existing] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, id));
    if (!existing) throw new NotFoundException("Milestone not found");
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.trackable !== undefined) patch.trackable = dto.trackable;
    if (dto.billable !== undefined) patch.billable = dto.billable;
    if (dto.sort !== undefined) patch.sort = dto.sort;
    if (dto.dueAt !== undefined || (dto.dueDate && dto.dueTime && dto.dueTz)) {
      const { dueAt, dueTz } = resolveDue(dto);
      patch.dueAt = dueAt;
      patch.dueTz = dueTz;
    } else if (dto.dueTz !== undefined) {
      patch.dueTz = dto.dueTz;
    }
    const [row] = await tx.update(schema.milestone).set(patch).where(eq(schema.milestone.id, id)).returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "milestone.updated",
      entity: "milestone",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return this.withUrgency(row!);
  }

  /** Milestone state machine: pending → in_progress → done (adjacent, forward-only). */
  async transition(tx: Db, principal: SessionPrincipal, id: string, toState: string) {
    const [existing] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, id));
    if (!existing) throw new NotFoundException("Milestone not found");
    const order = MILESTONE_STATES as readonly string[];
    if (order.indexOf(toState) !== order.indexOf(existing.state) + 1) {
      throw new BadRequestException(`Invalid transition ${existing.state} → ${toState}`);
    }
    const [row] = await tx
      .update(schema.milestone)
      .set({ state: toState, updatedBy: principal.userId, updatedAt: new Date() })
      .where(eq(schema.milestone.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "milestone.state_changed",
      entity: "milestone",
      entityId: id,
      detail: { from: existing.state, to: toState },
    });
    return this.withUrgency(row!);
  }

  async listForProject(tx: Db, projectId: string) {
    const rows = await tx
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.projectId, projectId))
      .orderBy(asc(schema.milestone.sort));
    return rows.map((r) => this.withUrgency(r));
  }

  /** Belongs-to guard for the nested routes (the milestone is on THIS project). */
  async assertOnProject(tx: Db, projectId: string, milestoneId: string) {
    const [row] = await tx
      .select({ id: schema.milestone.id })
      .from(schema.milestone)
      .where(and(eq(schema.milestone.id, milestoneId), eq(schema.milestone.projectId, projectId)));
    if (!row) throw new NotFoundException("Milestone not found on this project");
  }
}
