import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { BroadcastDto } from "./dto.js";

/** Hard ceiling on a single broadcast fan-out (a runaway "everyone" backstop). */
const MAX_FANOUT = 5000;
const LIST_LIMIT = 50;

/**
 * Module 19 — in-app notifications + admin broadcast (P1 item 7). Notifications
 * are per-USER: the tenant RLS GUC carries org + party but NOT user, so every read
 * and mark-read is self-scoped IN-SERVICE by `recipient_user_id = principal.userId`
 * (the same pattern as dashboards/tasks) under tenant-RLS. A broadcast resolves its
 * audience to org users and inserts one notification row per recipient in one tx.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly audit: AuditService) {}

  /** The caller's own notifications, unread first then newest. */
  list(tx: Db, principal: SessionPrincipal) {
    return tx
      .select({
        id: schema.notification.id,
        kind: schema.notification.kind,
        title: schema.notification.title,
        body: schema.notification.body,
        readAt: schema.notification.readAt,
        broadcastId: schema.notification.broadcastId,
        createdAt: schema.notification.createdAt,
      })
      .from(schema.notification)
      .where(eq(schema.notification.recipientUserId, principal.userId))
      .orderBy(sql`${schema.notification.readAt} is not null`, desc(schema.notification.createdAt))
      .limit(LIST_LIMIT);
  }

  /** The caller's unread count (for the bell badge). */
  async unreadCount(tx: Db, principal: SessionPrincipal): Promise<{ unread: number }> {
    const res = await tx.execute(
      sql`select count(*)::int as n from notification where recipient_user_id = ${principal.userId} and read_at is null`,
    );
    return { unread: Number((res.rows[0] as { n: number }).n) };
  }

  /** Mark ONE of the caller's own notifications read (no-op if not theirs). */
  async markRead(tx: Db, principal: SessionPrincipal, id: string): Promise<{ ok: true }> {
    await tx
      .update(schema.notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notification.id, id),
          eq(schema.notification.recipientUserId, principal.userId),
          isNull(schema.notification.readAt),
        ),
      );
    return { ok: true };
  }

  /** Mark ALL of the caller's own unread notifications read. */
  async markAllRead(tx: Db, principal: SessionPrincipal): Promise<{ ok: true }> {
    await tx
      .update(schema.notification)
      .set({ readAt: new Date() })
      .where(and(eq(schema.notification.recipientUserId, principal.userId), isNull(schema.notification.readAt)));
    return { ok: true };
  }

  /**
   * Broadcast to an audience (notifications:approve). Resolves recipients, records
   * the broadcast, and inserts one notification per recipient in the caller's tx.
   */
  async broadcast(tx: Db, principal: SessionPrincipal, dto: BroadcastDto) {
    const recipientIds = await this.resolveAudience(tx, principal, dto);
    if (recipientIds.length === 0) throw new BadRequestException("The audience resolved to zero recipients");
    let ids = recipientIds;
    if (ids.length > MAX_FANOUT) {
      this.logger.warn(`broadcast fan-out capped at ${MAX_FANOUT} of ${ids.length} recipients (org ${principal.orgId})`);
      ids = ids.slice(0, MAX_FANOUT);
    }

    const [bc] = await tx
      .insert(schema.notificationBroadcast)
      .values({
        orgId: principal.orgId,
        audienceKind: dto.audienceKind,
        audienceJson: dto.audienceKind === "role" ? { roleId: dto.roleId } : dto.audienceKind === "users" ? { userIds: ids } : null,
        title: dto.title,
        body: dto.body ?? null,
        createdBy: principal.userId,
      })
      .returning({ id: schema.notificationBroadcast.id });

    await tx.insert(schema.notification).values(
      ids.map((uid) => ({
        orgId: principal.orgId,
        recipientUserId: uid,
        kind: "broadcast",
        title: dto.title,
        body: dto.body ?? null,
        broadcastId: bc!.id,
        createdBy: principal.userId,
      })),
    );

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "notifications.broadcast",
      entity: "notification_broadcast",
      entityId: bc!.id,
      detail: { audienceKind: dto.audienceKind, recipients: ids.length },
    });
    return { broadcastId: bc!.id, recipients: ids.length };
  }

  /** Resolve a broadcast audience to a de-duplicated list of in-org, active recipient user ids. */
  private async resolveAudience(tx: Db, principal: SessionPrincipal, dto: BroadcastDto): Promise<string[]> {
    if (dto.audienceKind === "all") {
      const rows = await tx
        .select({ id: schema.userAccount.id })
        .from(schema.userAccount)
        .where(and(eq(schema.userAccount.orgId, principal.orgId), eq(schema.userAccount.status, "active")));
      return rows.map((r) => r.id);
    }
    if (dto.audienceKind === "role") {
      if (!dto.roleId) throw new BadRequestException("roleId is required for a role broadcast");
      const rows = await tx
        .selectDistinct({ id: schema.userRole.userId })
        .from(schema.userRole)
        .innerJoin(schema.userAccount, eq(schema.userAccount.id, schema.userRole.userId))
        .where(
          and(
            eq(schema.userRole.roleId, dto.roleId),
            eq(schema.userRole.orgId, principal.orgId),
            eq(schema.userAccount.status, "active"),
          ),
        );
      return rows.map((r) => r.id);
    }
    // users — only ids that are active accounts in THIS org (silently drop others).
    if (!dto.userIds?.length) throw new BadRequestException("userIds is required for a users broadcast");
    const rows = await tx
      .select({ id: schema.userAccount.id })
      .from(schema.userAccount)
      .where(
        and(
          eq(schema.userAccount.orgId, principal.orgId),
          eq(schema.userAccount.status, "active"),
          inArray(schema.userAccount.id, dto.userIds),
        ),
      );
    return rows.map((r) => r.id);
  }
}
