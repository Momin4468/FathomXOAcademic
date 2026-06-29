import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { FilesController } from "./files.controller.js";
import { FilesService } from "./files.service.js";

/**
 * The file pipeline (DESIGN_SPEC §1/§11 file rule). Core plumbing — registered
 * unconditionally (like AuditModule), since knowledge media now and payment-
 * proofs/briefs later reuse it. AuthModule supplies the global guards.
 */
@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [FilesService, StorageService],
  exports: [FilesService, StorageService],
})
export class FilesModule {}
