import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { BroadcastDto } from "./dto.js";
import { NotificationsService } from "./notifications.service.js";

/**
 * Module 19 — in-app notifications (P1 item 7). Reads/mark-read are self-scoped to
 * the caller (notifications:view — every role has it, sees only their OWN rows);
 * broadcast is notifications:approve (admins/superadmins). Feature-flagged
 * `notifications`.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @RequirePermission("notifications", "view")
  list(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.notifications.list(tx, p));
  }

  @Get("unread-count")
  @RequirePermission("notifications", "view")
  unreadCount(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.notifications.unreadCount(tx, p));
  }

  @Post("read-all")
  @HttpCode(200)
  @RequirePermission("notifications", "view")
  markAllRead(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.notifications.markAllRead(tx, p));
  }

  @Post(":id/read")
  @HttpCode(200)
  @RequirePermission("notifications", "view")
  markRead(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.notifications.markRead(tx, p, id));
  }

  @Post("broadcast")
  @RequirePermission("notifications", "approve")
  broadcast(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: BroadcastDto) {
    return this.db.withTenant(ctx, (tx) => this.notifications.broadcast(tx, p, dto));
  }
}
