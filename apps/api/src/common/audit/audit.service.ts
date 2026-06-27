import { Injectable } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import type { RlsContext } from "@business-os/shared";
import { DbService } from "../db/db.service.js";

export interface AuditEntry {
  actorUserId: string | null;
  action: string; // e.g. 'auth.login', 'platform.role_assigned'
  entity: string; // e.g. 'user_account'
  entityId?: string | null;
  detail?: Record<string, unknown> | null;
}

/**
 * Immutable audit trail (CLAUDE.md §4). Writes append-only audit_log rows; the
 * app_user role has INSERT/SELECT only, so rows can never be edited or deleted.
 * The insert runs inside a tenant transaction, so RLS's WITH CHECK (org_id =
 * current_org()) guarantees the row is scoped to the active tenant.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /** Record inside an existing tenant transaction. `orgId` is the active tenant. */
  async record(tx: Db, orgId: string, entry: AuditEntry): Promise<void> {
    await tx.insert(schema.auditLog).values({
      orgId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      detailJson: entry.detail ?? null,
    });
  }

  /** Record when no transaction is in hand (opens its own tenant tx). */
  async recordScoped(ctx: RlsContext, entry: AuditEntry): Promise<void> {
    await this.db.withTenant(ctx, (tx) => this.record(tx, ctx.orgId, entry));
  }
}
