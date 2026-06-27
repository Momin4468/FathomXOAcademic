import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { isValidTimeZone, urgency, zonedWallToInstant, type SessionPrincipal } from "@business-os/shared";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateTaskDto, ListTasksQueryDto, UpdateTaskDto } from "./dto.js";

type TaskRow = typeof schema.task.$inferSelect;

/** Resolve a deadline from either an absolute instant or wall date+time+zone. */
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
export class TaskService {
  constructor(private readonly audit: AuditService) {}

  /** Attach computed urgency ("time left") — derived, never stored. */
  private withUrgency(row: TaskRow) {
    return { ...row, urgency: urgency(row.dueAt ? row.dueAt.toISOString() : null) };
  }

  async create(tx: Db, principal: SessionPrincipal, dto: CreateTaskDto) {
    const { dueAt, dueTz } = resolveDue(dto);
    const [row] = await tx
      .insert(schema.task)
      .values({
        orgId: principal.orgId,
        title: dto.title.trim(),
        details: dto.details ?? null,
        assigneePartyId: dto.assigneePartyId ?? null,
        assigneeUserId: dto.assigneeUserId ?? null,
        workItemId: dto.workItemId ?? null,
        dueAt,
        dueTz,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "task.created",
      entity: "task",
      entityId: row!.id,
      detail: { title: dto.title, dueAt: dueAt?.toISOString() ?? null, dueTz },
    });
    return this.withUrgency(row!);
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateTaskDto) {
    const [existing] = await tx.select().from(schema.task).where(eq(schema.task.id, id));
    if (!existing) throw new NotFoundException("Task not found");
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.details !== undefined) patch.details = dto.details;
    if (dto.assigneePartyId !== undefined) patch.assigneePartyId = dto.assigneePartyId;
    if (dto.state !== undefined) {
      patch.state = dto.state;
      patch.completedAt = dto.state === "done" ? new Date() : null;
    }
    if (dto.dueAt !== undefined || (dto.dueDate && dto.dueTime && dto.dueTz)) {
      const { dueAt, dueTz } = resolveDue(dto);
      patch.dueAt = dueAt;
      patch.dueTz = dueTz;
    } else if (dto.dueTz !== undefined) {
      patch.dueTz = dto.dueTz;
    }
    const [row] = await tx.update(schema.task).set(patch).where(eq(schema.task.id, id)).returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "task.updated",
      entity: "task",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return this.withUrgency(row!);
  }

  /** Capture-first: completing nudges state, never blocks. */
  async complete(tx: Db, principal: SessionPrincipal, id: string) {
    const [row] = await tx
      .update(schema.task)
      .set({ state: "done", completedAt: new Date(), updatedBy: principal.userId, updatedAt: new Date() })
      .where(eq(schema.task.id, id))
      .returning();
    if (!row) throw new NotFoundException("Task not found");
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "task.completed",
      entity: "task",
      entityId: id,
    });
    return this.withUrgency(row);
  }

  async list(tx: Db, principal: SessionPrincipal, q: ListTasksQueryDto) {
    const conds: SQL[] = [];
    if (q.mine === "true" && principal.partyId) {
      conds.push(eq(schema.task.assigneePartyId, principal.partyId));
    }
    if (q.state) conds.push(eq(schema.task.state, q.state));
    const rows = await tx
      .select()
      .from(schema.task)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(schema.task.dueAt))
      .limit(500);
    return rows.map((r) => this.withUrgency(r));
  }
}
