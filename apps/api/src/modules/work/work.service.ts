import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import {
  deriveJobPnl,
  WORK_STATES,
  type RecordScope,
  type SessionPrincipal,
  type WorkState,
} from "@business-os/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { CustomFieldService } from "../custom-fields/custom-field.service.js";
import { LegService } from "./leg.service.js";
import { LineService } from "./line.service.js";
import type { CreateWorkItemDto, UpdateWorkItemDto } from "./dto.js";

@Injectable()
export class WorkService {
  constructor(
    private readonly audit: AuditService,
    private readonly lines: LineService,
    private readonly legs: LegService,
    private readonly customFields: CustomFieldService,
  ) {}

  /** A job's matchable custom-field scope: client, assignment-type, course + its
   *  parent university (so a field can be scoped by client/type/uni). */
  private async workScope(
    tx: Db,
    item: { sourcePartyId?: string | null; assignmentTypeRefId?: string | null; courseRefId?: string | null },
  ): Promise<RecordScope> {
    let universityRefId: string | null = null;
    if (item.courseRefId) {
      const [c] = await tx
        .select({ parentId: schema.refEntity.parentId })
        .from(schema.refEntity)
        .where(eq(schema.refEntity.id, item.courseRefId));
      universityRefId = c?.parentId ?? null;
    }
    return {
      clientPartyId: item.sourcePartyId ?? null,
      assignmentTypeRefId: item.assignmentTypeRefId ?? null,
      courseRefId: item.courseRefId ?? null,
      universityRefId,
    };
  }

  async create(tx: Db, principal: SessionPrincipal, dto: CreateWorkItemDto, opts?: { aiCaptureId?: string }) {
    const scope = await this.workScope(tx, dto);
    const customJson = await this.customFields.validateValues(tx, "work_item", scope, dto.customJson);
    const [item] = await tx
      .insert(schema.workItem)
      .values({
        orgId: principal.orgId,
        title: dto.title.trim(),
        customJson,
        details: dto.details ?? null,
        sourcePartyId: dto.sourcePartyId ?? null,
        doerPartyId: dto.doerPartyId ?? null,
        courseRefId: dto.courseRefId ?? null,
        assignmentTypeRefId: dto.assignmentTypeRefId ?? null,
        projectId: dto.projectId ?? null,
        milestoneId: dto.milestoneId ?? null,
        trackable: dto.trackable ?? undefined, // column default true
        billable: dto.billable ?? undefined, // column default false
        isEstimate: dto.isEstimate ?? false,
        notes: dto.notes ?? null,
        aiCaptureId: opts?.aiCaptureId ?? null,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.item_created",
      entity: "work_item",
      entityId: item!.id,
      detail: { title: item!.title },
    });
    return item!;
  }

  async getRaw(tx: Db, id: string) {
    const [item] = await tx.select().from(schema.workItem).where(eq(schema.workItem.id, id));
    if (!item) throw new NotFoundException("Work item not found");
    return item;
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateWorkItemDto) {
    const existing = await this.getRaw(tx, id);
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.customJson !== undefined) {
      // Validate against the EFFECTIVE scope (dto overrides, else existing).
      const scope = await this.workScope(tx, {
        sourcePartyId: dto.sourcePartyId ?? existing.sourcePartyId,
        assignmentTypeRefId: dto.assignmentTypeRefId ?? existing.assignmentTypeRefId,
        courseRefId: dto.courseRefId ?? existing.courseRefId,
      });
      // Validate only the INCOMING keys, then MERGE into the stored map so a
      // partial edit never wipes other captured values (and stale values for a
      // since-archived field aren't re-validated).
      const validated = await this.customFields.validateValues(tx, "work_item", scope, dto.customJson);
      patch.customJson = { ...((existing.customJson as Record<string, unknown>) ?? {}), ...validated };
    }
    for (const k of [
      "title",
      "details",
      "sourcePartyId",
      "doerPartyId",
      "courseRefId",
      "assignmentTypeRefId",
      "projectId",
      "milestoneId",
      "trackable",
      "billable",
      "notes",
    ] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    const [item] = await tx
      .update(schema.workItem)
      .set(patch)
      .where(eq(schema.workItem.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.item_updated",
      entity: "work_item",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return item!;
  }

  /**
   * Work-state machine: draft→pending→confirmed→delivered (adjacent, forward
   * only). →confirmed is the governance step (claim becomes fact) and needs
   * work:approve; it stamps confirmed_by/at. Independent of money-state.
   */
  async transition(
    tx: Db,
    principal: SessionPrincipal,
    id: string,
    toState: WorkState,
    canApprove: boolean,
  ) {
    const item = await this.getRaw(tx, id);
    const order = WORK_STATES as readonly string[];
    const curIdx = order.indexOf(item.workState);
    const toIdx = order.indexOf(toState);
    if (toIdx !== curIdx + 1) {
      throw new BadRequestException(`Invalid transition ${item.workState} → ${toState}`);
    }
    if (toState === "confirmed" && !canApprove) {
      throw new ForbiddenException("Confirming a work item requires work:approve");
    }
    // Hard gate: required custom fields must be complete to advance the close.
    if (toState === "confirmed" || toState === "delivered") {
      const scope = await this.workScope(tx, item);
      await this.customFields.assertRequiredComplete(
        tx,
        "work_item",
        scope,
        item.customJson as Record<string, unknown> | null,
      );
    }
    const patch: Record<string, unknown> = {
      workState: toState,
      updatedBy: principal.userId,
      updatedAt: new Date(),
    };
    if (toState === "confirmed") {
      patch.confirmedBy = principal.userId;
      patch.confirmedAt = new Date();
    }
    const [updated] = await tx
      .update(schema.workItem)
      .set(patch)
      .where(eq(schema.workItem.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.state_changed",
      entity: "work_item",
      entityId: id,
      detail: { from: item.workState, to: toState },
    });
    return updated!;
  }

  /** Capture-first list with light filters. Spec only (no money). */
  async list(
    tx: Db,
    filters: { doerPartyId?: string; sourcePartyId?: string; workState?: WorkState; includeArchived?: boolean },
  ) {
    const conds = [];
    if (!filters.includeArchived) conds.push(isNull(schema.workItem.archivedAt));
    if (filters.doerPartyId) conds.push(eq(schema.workItem.doerPartyId, filters.doerPartyId));
    if (filters.sourcePartyId) conds.push(eq(schema.workItem.sourcePartyId, filters.sourcePartyId));
    if (filters.workState) conds.push(eq(schema.workItem.workState, filters.workState));
    return tx
      .select({
        id: schema.workItem.id,
        title: schema.workItem.title,
        workState: schema.workItem.workState,
        moneyState: schema.workItem.moneyState,
        doerPartyId: schema.workItem.doerPartyId,
        sourcePartyId: schema.workItem.sourcePartyId,
        updatedAt: schema.workItem.updatedAt,
      })
      .from(schema.workItem)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.workItem.updatedAt))
      .limit(100);
  }

  /**
   * The job-detail hub read model. Lines carry money only if canSeeMoney; legs
   * are RLS-filtered to the viewer (the DB guarantee); margins are derived from
   * exactly those visible legs — never stored, never leaked.
   */
  async getDetail(tx: Db, id: string, canSeeMoney: boolean) {
    const item = await this.getRaw(tx, id);
    const lineRows = await this.lines.getLines(tx, id);
    const legs = await this.legs.getVisibleLegs(tx, id);
    // Job-level P&L / loss (derived, never stored) — money-gated so a non-money
    // caller never sees the figures. Surfaces a fail/resit net loss truthfully.
    let pnl: ReturnType<typeof deriveJobPnl> | null = null;
    if (canSeeMoney) {
      const r = await tx.execute(
        sql`select revenue, writer_cost as "writerCost", clawback from job_pnl(${id})`,
      );
      const row = (r.rows[0] ?? {}) as { revenue?: string; writerCost?: string; clawback?: string };
      const [oc] = await tx
        .select({ reworkCost: schema.workOutcome.reworkCost })
        .from(schema.workOutcome)
        .where(eq(schema.workOutcome.workItemId, id));
      pnl = deriveJobPnl({
        revenue: Number(row.revenue ?? 0),
        writerCost: Number(row.writerCost ?? 0),
        clawback: Number(row.clawback ?? 0),
        reworkCost: Number(oc?.reworkCost ?? 0),
      });
    }
    const scope = await this.workScope(tx, item);
    const customFields = await this.customFields.describeForRecord(
      tx,
      "work_item",
      scope,
      item.customJson as Record<string, unknown> | null,
    );
    return {
      item,
      lines: lineRows.map((l) => this.lines.mapLine(l, canSeeMoney)),
      legs,
      margins: this.legs.marginsFor(legs),
      pnl,
      customFields,
    };
  }
}
