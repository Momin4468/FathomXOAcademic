import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { CreateTaskDto, ListTasksQueryDto, UpdateTaskDto } from "./dto.js";
import { TaskService } from "./task.service.js";

/** Module 6 — capture-first task board (DESIGN_SPEC §8). Gated `capture:*`. */
@Controller("tasks")
export class TaskController {
  constructor(
    private readonly db: DbService,
    private readonly tasks: TaskService,
  ) {}

  @Post()
  @RequirePermission("capture", "create")
  create(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateTaskDto) {
    return this.db.withTenant(ctx, (tx) => this.tasks.create(tx, p, dto));
  }

  @Patch(":id")
  @RequirePermission("capture", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.tasks.update(tx, p, id, dto));
  }

  @Post(":id/complete")
  @RequirePermission("capture", "edit")
  complete(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.tasks.complete(tx, p, id));
  }

  @Get()
  @RequirePermission("capture", "view")
  list(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Query() q: ListTasksQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.tasks.list(tx, p, q));
  }
}
