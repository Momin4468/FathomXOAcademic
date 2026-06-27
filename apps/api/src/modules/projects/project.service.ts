import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { computeLineAmount, type SessionPrincipal } from "@business-os/shared";
import { and, asc, desc, eq, isNotNull, type SQL } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateProjectDto, ListProjectsQueryDto, UpdateProjectDto } from "./dto.js";
import { MilestoneService } from "./milestone.service.js";
import { TemplateService } from "./template.service.js";

/**
 * Projects / engagements (DESIGN_SPEC §5): a container of child work_items, each
 * flagged trackable/billable. A plain job is the one-child case — children are
 * ordinary work_items (no parallel type). The client estimate is stored; the
 * ACTUAL is DERIVED from billable children at read time (money-gated, §3.3/§4).
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly audit: AuditService,
    private readonly templates: TemplateService,
    private readonly milestones: MilestoneService,
  ) {}

  async create(tx: Db, principal: SessionPrincipal, dto: CreateProjectDto) {
    const [project] = await tx
      .insert(schema.project)
      .values({
        orgId: principal.orgId,
        title: dto.title.trim(),
        clientPartyId: dto.clientPartyId ?? null,
        templateId: dto.templateId ?? null,
        estimateAmount: dto.estimateAmount != null ? String(dto.estimateAmount) : null,
        status: dto.status ?? "active",
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "project.created",
      entity: "project",
      entityId: project!.id,
      detail: { title: project!.title, templateId: dto.templateId ?? null },
    });
    if (dto.templateId) {
      await this.instantiate(tx, principal, project!.id, dto.templateId);
    }
    return project!;
  }

  /**
   * Instantiate (or EXTEND) a project's milestones from a template's items —
   * callable repeatedly; appends each time (fluid programmes). Snapshots the
   * item titles/flags/sort into real milestones so later template edits don't
   * mutate an in-flight project.
   */
  async instantiate(tx: Db, principal: SessionPrincipal, projectId: string, templateId: string) {
    await this.getRaw(tx, projectId); // 404 if the project isn't visible/exists
    const items = await this.templates.itemsFor(tx, templateId);
    if (items.length === 0) throw new NotFoundException("Template has no items (or does not exist)");
    const created: string[] = [];
    for (const it of items) {
      const [row] = await tx
        .insert(schema.milestone)
        .values({
          orgId: principal.orgId,
          projectId,
          title: it.title,
          trackable: it.trackable,
          billable: it.billable,
          sort: it.sort ?? 0,
          createdBy: principal.userId,
          updatedBy: principal.userId,
        })
        .returning({ id: schema.milestone.id });
      created.push(row!.id);
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "project.template_instantiated",
      entity: "project",
      entityId: projectId,
      detail: { templateId, milestonesAdded: created.length },
    });
    return { milestoneIds: created };
  }

  async getRaw(tx: Db, id: string) {
    const [row] = await tx.select().from(schema.project).where(eq(schema.project.id, id));
    if (!row) throw new NotFoundException("Project not found");
    return row;
  }

  /** estimate_amount is money — null it out for callers who can't see money. */
  private redact<T extends { estimateAmount: string | null }>(project: T, canSeeMoney: boolean): T {
    return canSeeMoney ? project : { ...project, estimateAmount: null };
  }

  async list(tx: Db, q: ListProjectsQueryDto, canSeeMoney: boolean) {
    const conds: SQL[] = [];
    if (q.clientPartyId) conds.push(eq(schema.project.clientPartyId, q.clientPartyId));
    if (q.status) conds.push(eq(schema.project.status, q.status));
    const rows = await tx
      .select()
      .from(schema.project)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.project.updatedAt))
      .limit(200);
    return rows.map((r) => this.redact(r, canSeeMoney));
  }

  /**
   * The engagement hub: project + milestones (with urgency) + children flagged
   * trackable/billable. Money (the stored estimate + the DERIVED actual) is
   * included ONLY when the caller can see money.
   */
  async getDetail(tx: Db, id: string, canSeeMoney: boolean) {
    const project = await this.getRaw(tx, id);
    const milestones = await this.milestones.listForProject(tx, id);
    const children = await tx
      .select({
        id: schema.workItem.id,
        title: schema.workItem.title,
        workState: schema.workItem.workState,
        moneyState: schema.workItem.moneyState,
        trackable: schema.workItem.trackable,
        billable: schema.workItem.billable,
        milestoneId: schema.workItem.milestoneId,
      })
      .from(schema.workItem)
      .where(eq(schema.workItem.projectId, id))
      .orderBy(asc(schema.workItem.createdAt));

    const base = { project: this.redact(project, canSeeMoney), milestones, children };
    if (!canSeeMoney) return base;

    // ACTUAL = Σ over billable children of Σ their consumer-line client amounts.
    // Derived at read time (never stored); same computeLineAmount the lines use.
    const lines = await tx
      .select({
        clientRate: schema.workLine.clientRate,
        wordCount: schema.workLine.wordCount,
        fixedAmount: schema.workLine.fixedAmount,
      })
      .from(schema.workLine)
      .innerJoin(schema.workItem, eq(schema.workLine.workItemId, schema.workItem.id))
      .where(
        and(
          eq(schema.workItem.projectId, id),
          eq(schema.workItem.billable, true),
          isNotNull(schema.workLine.consumerPartyId),
        ),
      );
    const actual = lines.reduce(
      (sum, l) => sum + computeLineAmount({ rate: l.clientRate, count: l.wordCount, fixedAmount: l.fixedAmount }),
      0,
    );
    return {
      ...base,
      money: {
        estimate: project.estimateAmount, // the stored quote
        actual: Math.round((actual + Number.EPSILON) * 100) / 100, // derived, firms as work lands
      },
    };
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateProjectDto, canSeeMoney: boolean) {
    await this.getRaw(tx, id);
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.clientPartyId !== undefined) patch.clientPartyId = dto.clientPartyId;
    if (dto.estimateAmount !== undefined) patch.estimateAmount = String(dto.estimateAmount);
    if (dto.status !== undefined) patch.status = dto.status;
    const [row] = await tx.update(schema.project).set(patch).where(eq(schema.project.id, id)).returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "project.updated",
      entity: "project",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return this.redact(row!, canSeeMoney);
  }

  /**
   * Firm the engagement to completion (estimate → actual). Governance step:
   * requires work:approve; stamps confirmed_by/at. The client invoice is firmed
   * separately via the billing estimate→final supersede (module seam kept).
   */
  async complete(tx: Db, principal: SessionPrincipal, id: string, canApprove: boolean) {
    if (!canApprove) throw new ForbiddenException("Completing a project requires work:approve");
    const project = await this.getRaw(tx, id);
    if (project.status === "completed") throw new ConflictException("Project is already completed");
    const [row] = await tx
      .update(schema.project)
      .set({
        status: "completed",
        confirmedBy: principal.userId,
        confirmedAt: new Date(),
        updatedBy: principal.userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.project.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "project.completed",
      entity: "project",
      entityId: id,
    });
    return row!;
  }
}
