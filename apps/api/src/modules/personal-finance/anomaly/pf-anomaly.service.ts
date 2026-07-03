import { Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { and, eq, isNull } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";

/** Dismiss an in-app anomaly notice. RLS scopes the row to the calling account. */
@Injectable()
export class PfAnomalyService {
  constructor(private readonly audit: PfAuditService) {}

  async dismiss(tx: Db, pfAccountId: string, id: string): Promise<{ ok: true }> {
    const [row] = await tx
      .update(schema.pfAnomalyNotice)
      .set({ dismissedAt: new Date() })
      .where(and(eq(schema.pfAnomalyNotice.id, id), isNull(schema.pfAnomalyNotice.dismissedAt)))
      .returning({ id: schema.pfAnomalyNotice.id });
    if (!row) throw new NotFoundException("Notice not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.anomaly_dismissed", entity: "pf_anomaly_notice", entityId: id });
    return { ok: true };
  }
}
