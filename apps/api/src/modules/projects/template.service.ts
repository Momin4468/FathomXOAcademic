import { Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { asc, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateTemplateDto, CreateTemplateItemDto } from "./dto.js";

/**
 * Milestone templates — per-uni/programme reference lists (e.g. UWTSD MBA Thesis:
 * proposal → ethics → … → final) that a project INSTANTIATES then EXTENDS
 * (DESIGN_SPEC §5). Tenant-RLS; gated by work:* like the rest of the domain.
 */
@Injectable()
export class TemplateService {
  constructor(private readonly audit: AuditService) {}

  async createTemplate(tx: Db, principal: SessionPrincipal, dto: CreateTemplateDto) {
    const [row] = await tx
      .insert(schema.milestoneTemplate)
      .values({
        orgId: principal.orgId,
        name: dto.name.trim(),
        scopeRefId: dto.scopeRefId ?? null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "milestone_template.created",
      entity: "milestone_template",
      entityId: row!.id,
      detail: { name: row!.name },
    });
    return row!;
  }

  async addItem(tx: Db, principal: SessionPrincipal, templateId: string, dto: CreateTemplateItemDto) {
    const [tpl] = await tx
      .select({ id: schema.milestoneTemplate.id })
      .from(schema.milestoneTemplate)
      .where(eq(schema.milestoneTemplate.id, templateId));
    if (!tpl) throw new NotFoundException("Template not found");
    const [row] = await tx
      .insert(schema.milestoneTemplateItem)
      .values({
        orgId: principal.orgId,
        templateId,
        title: dto.title.trim(),
        trackable: dto.trackable ?? true,
        billable: dto.billable ?? false,
        sort: dto.sort ?? 0,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "milestone_template.item_added",
      entity: "milestone_template",
      entityId: templateId,
      detail: { title: row!.title },
    });
    return row!;
  }

  async list(tx: Db) {
    return tx
      .select()
      .from(schema.milestoneTemplate)
      .orderBy(asc(schema.milestoneTemplate.name))
      .limit(500);
  }

  async getTemplate(tx: Db, id: string) {
    const [tpl] = await tx
      .select()
      .from(schema.milestoneTemplate)
      .where(eq(schema.milestoneTemplate.id, id));
    if (!tpl) throw new NotFoundException("Template not found");
    const items = await this.itemsFor(tx, id);
    return { template: tpl, items };
  }

  /** Template items in apply order — reused by project instantiation. */
  async itemsFor(tx: Db, templateId: string) {
    return tx
      .select()
      .from(schema.milestoneTemplateItem)
      .where(eq(schema.milestoneTemplateItem.templateId, templateId))
      .orderBy(asc(schema.milestoneTemplateItem.sort));
  }
}
