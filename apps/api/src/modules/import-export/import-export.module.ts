import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { FilesModule } from "../files/files.module.js";
import { ReferenceModule } from "../refdata/reference.module.js";
import { WorkModule } from "../work/work.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { ExpenseModule } from "../expense/expense.module.js";
import { SettlementModule } from "../settlement/settlement.module.js";
import { ImportExportController } from "./import-export.controller.js";
import { ImportService } from "./import.service.js";
import { ExportService } from "./export.service.js";
import { ArchiveService } from "./archive.service.js";

/**
 * Module 16 — Import / Export / Archive. Import commits through the existing
 * create services (canonical reference resolution + provenance); export reuses
 * the RLS-scoped list read-models; archive reuses the file pipeline. Imports the
 * target modules to inject their (now-exported) services. Gated FEATURE_IMPORT_EXPORT.
 */
@Module({
  imports: [AuthModule, FilesModule, ReferenceModule, WorkModule, BillingModule, ExpenseModule, SettlementModule],
  controllers: [ImportExportController],
  providers: [ImportService, ExportService, ArchiveService],
})
export class ImportExportModule {}
