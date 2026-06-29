import { ForbiddenException, Injectable } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import type { ExportDataset, SessionPrincipal } from "@business-os/shared";
import { AuditService } from "../../common/audit/audit.service.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { PartyService } from "../refdata/party.service.js";
import { WorkService } from "../work/work.service.js";
import { PaymentService } from "../billing/payment.service.js";
import { InvoiceService } from "../billing/invoice.service.js";
import { ExpenseService } from "../expense/expense.service.js";

/** Each dataset requires its OWN view permission — export can never reveal more
 *  than the viewer can already see in the app. */
const DATASET_PERMISSION: Record<ExportDataset, string> = {
  clients: "reference:view",
  jobs: "work:view",
  payments: "billing:view",
  expenses: "expenses:view",
  invoices: "billing:view",
  settlement: "billing:view",
};

/**
 * Export reuses the EXISTING RLS-scoped, permission-gated list read-models and
 * serializes them — so the file can't contain a figure the viewer can't see in
 * the app (redaction is inherited, not re-implemented). The viewer must hold the
 * dataset's own view permission.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly parties: PartyService,
    private readonly work: WorkService,
    private readonly payments: PaymentService,
    private readonly invoices: InvoiceService,
    private readonly expenses: ExpenseService,
    private readonly audit: AuditService,
  ) {}

  async export(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, dataset: ExportDataset): Promise<Array<Record<string, unknown>>> {
    const need = DATASET_PERMISSION[dataset];
    if (!principal.isSystemSuperadmin && !perms.perms.has(need)) {
      throw new ForbiddenException(`Exporting ${dataset} requires ${need}`);
    }
    let rows: Array<Record<string, unknown>>;
    switch (dataset) {
      case "clients":
        rows = (await this.parties.search(tx, undefined, undefined, 100000)) as Array<Record<string, unknown>>;
        break;
      case "jobs":
        rows = (await this.work.list(tx, {})) as Array<Record<string, unknown>>;
        break;
      case "payments":
        rows = (await this.payments.list(tx, {})) as Array<Record<string, unknown>>;
        break;
      case "invoices":
        rows = (await this.invoices.list(tx, {})) as Array<Record<string, unknown>>;
        break;
      case "expenses":
        rows = (await this.expenses.list(tx, {})).expenses as Array<Record<string, unknown>>;
        break;
      case "settlement":
        // RLS scopes settlement_transfer to the viewer's own partner pair.
        rows = (await tx
          .select()
          .from(schema.settlementTransfer)
          .orderBy(schema.settlementTransfer.transferredAt)) as Array<Record<string, unknown>>;
        break;
      default:
        rows = [];
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "export.generated",
      entity: "export",
      entityId: null,
      detail: { dataset, rows: rows.length },
    });
    return rows;
  }
}
