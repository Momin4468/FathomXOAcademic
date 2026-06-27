import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import {
  CreateMilestoneDto,
  CreateProjectDto,
  CreateTemplateDto,
  CreateTemplateItemDto,
  InstantiateDto,
  ListProjectsQueryDto,
  MilestoneTransitionDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from "./dto.js";
import { MilestoneService } from "./milestone.service.js";
import { ProjectService } from "./project.service.js";
import { TemplateService } from "./template.service.js";

/** Whether the caller may see project money (estimate + derived actual). */
function canSeeMoney(principal: SessionPrincipal, perms: EffectivePermissions): boolean {
  return principal.isSystemSuperadmin || perms.perms.has("work:approve");
}

@Controller()
export class ProjectsController {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectService,
    private readonly milestones: MilestoneService,
    private readonly templates: TemplateService,
  ) {}

  // ── projects ──
  @Post("projects")
  @RequirePermission("work", "create")
  create(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateProjectDto) {
    return this.db.withTenant(ctx, (tx) => this.projects.create(tx, p, dto));
  }

  @Get("projects")
  @RequirePermission("work", "view")
  list(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Query() q: ListProjectsQueryDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.projects.list(tx, q, canSeeMoney(p, perms)));
  }

  @Get("projects/:id")
  @RequirePermission("work", "view")
  getById(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.projects.getDetail(tx, id, canSeeMoney(p, perms)));
  }

  @Patch("projects/:id")
  @RequirePermission("work", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.projects.update(tx, p, id, dto, canSeeMoney(p, perms)));
  }

  /** Firm the engagement to completion (governance → work:approve). */
  @Post("projects/:id/complete")
  @RequirePermission("work", "approve")
  complete(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.projects.complete(tx, p, id, canSeeMoney(p, perms)));
  }

  @Post("projects/:id/instantiate")
  @RequirePermission("work", "create")
  instantiate(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: InstantiateDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.projects.instantiate(tx, p, id, dto.templateId));
  }

  // ── milestones (nested under a project) ──
  @Post("projects/:id/milestones")
  @RequirePermission("work", "create")
  addMilestone(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.projects.getRaw(tx, id); // project must exist/be visible
      return this.milestones.create(tx, p, id, dto);
    });
  }

  @Patch("projects/:id/milestones/:mid")
  @RequirePermission("work", "edit")
  updateMilestone(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("mid", ParseUUIDPipe) mid: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.milestones.assertOnProject(tx, id, mid);
      return this.milestones.update(tx, p, mid, dto);
    });
  }

  @Post("projects/:id/milestones/:mid/transition")
  @RequirePermission("work", "edit")
  transitionMilestone(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("mid", ParseUUIDPipe) mid: string,
    @Body() dto: MilestoneTransitionDto,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.milestones.assertOnProject(tx, id, mid);
      return this.milestones.transition(tx, p, mid, dto.state);
    });
  }

  // ── milestone templates (per-uni/programme reference lists) ──
  @Post("milestone-templates")
  @RequirePermission("work", "create")
  createTemplate(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateTemplateDto) {
    return this.db.withTenant(ctx, (tx) => this.templates.createTemplate(tx, p, dto));
  }

  @Get("milestone-templates")
  @RequirePermission("work", "view")
  listTemplates(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.templates.list(tx));
  }

  @Get("milestone-templates/:id")
  @RequirePermission("work", "view")
  getTemplate(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.templates.getTemplate(tx, id));
  }

  @Post("milestone-templates/:id/items")
  @RequirePermission("work", "create")
  addTemplateItem(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateTemplateItemDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.templates.addItem(tx, p, id, dto));
  }
}
