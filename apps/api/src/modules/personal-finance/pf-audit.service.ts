import { Injectable } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";

export interface PfAuditEntry {
  action: string; // e.g. 'pf.income_created'
  entity: string; // e.g. 'pf_income'
  entityId?: string | null;
  detail?: Record<string, unknown> | null;
}

/**
 * Immutable, PF-account-scoped audit (§11) — separate from the business
 * audit_log. Append-only: app_user has INSERT/SELECT only. The insert runs inside
 * a withPfAccount transaction, so RLS's WITH CHECK guarantees the row is scoped
 * to the active account.
 */
@Injectable()
export class PfAuditService {
  async record(tx: Db, pfAccountId: string, entry: PfAuditEntry): Promise<void> {
    await tx.insert(schema.pfAuditLog).values({
      pfAccountId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      detailJson: entry.detail ?? null,
    });
  }
}
