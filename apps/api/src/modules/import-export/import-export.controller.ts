import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import {
  EXPORT_DATASETS,
  IMPORT_ENTITIES,
  type ExportDataset,
  type ImportEntity,
  type RlsContext,
  type SessionPrincipal,
} from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { FILES_MAX_BYTES, FilesService, type UploadedFile as UploadedFileShape } from "../files/files.service.js";
import { ArchiveService } from "./archive.service.js";
import { ArchiveCreateDto, ImportEntityDto } from "./dto.js";
import { ExportService } from "./export.service.js";
import { ImportService } from "./import.service.js";
import { parseUpload } from "./parse.js";
import { toCsv, toXlsx } from "./serialize.js";
import { templateCsv } from "./templates.js";

@Controller()
export class ImportExportController {
  constructor(
    private readonly db: DbService,
    private readonly imports: ImportService,
    private readonly exports: ExportService,
    private readonly archive: ArchiveService,
    private readonly files: FilesService,
  ) {}

  // ── Import ────────────────────────────────────────────────────────────────
  @Get("import/template/:entity")
  @RequirePermission("import_export", "view")
  template(@Param("entity") entity: string, @Res() res: Response) {
    if (!(IMPORT_ENTITIES as readonly string[]).includes(entity)) throw new BadRequestException("Unknown entity");
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${entity}-template.csv"`);
    res.send(templateCsv(entity as ImportEntity));
  }

  @Post("import/preview")
  @RequirePermission("import_export", "create")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: FILES_MAX_BYTES } }))
  async preview(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @UploadedFile() file: UploadedFileShape,
    @Body() body: ImportEntityDto,
  ) {
    if (!file) throw new BadRequestException("No file provided (field name must be 'file')");
    if (!(IMPORT_ENTITIES as readonly string[]).includes(body.entity)) throw new BadRequestException("Unknown entity");
    const rows = await parseUpload(file.buffer, file.originalname);
    return this.db.withTenant(ctx, (tx) => this.imports.preview(tx, p, body.entity, file.originalname, rows));
  }

  @Get("import/:batchId")
  @RequirePermission("import_export", "view")
  getBatch(@CurrentRls() ctx: RlsContext, @Param("batchId", ParseUUIDPipe) batchId: string) {
    return this.db.withTenant(ctx, (tx) => this.imports.getBatch(tx, batchId));
  }

  @Post("import/:batchId/commit")
  @RequirePermission("import_export", "create")
  commit(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("batchId", ParseUUIDPipe) batchId: string,
  ) {
    // commit manages its own per-row transactions (partial commit).
    return this.imports.commit(ctx, p, perms, batchId);
  }

  // ── Export ────────────────────────────────────────────────────────────────
  @Get("export/:dataset")
  @RequirePermission("import_export", "view")
  async export(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("dataset") dataset: string,
    @Query("format") format: string,
    @Res() res: Response,
  ) {
    if (!(EXPORT_DATASETS as readonly string[]).includes(dataset)) throw new BadRequestException("Unknown dataset");
    const rows = await this.db.withTenant(ctx, (tx) => this.exports.export(tx, p, perms, dataset as ExportDataset));
    if (format === "xlsx") {
      const buf = await toXlsx(rows, undefined, dataset);
      res.setHeader("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("content-disposition", `attachment; filename="${dataset}.xlsx"`);
      res.send(buf);
    } else {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${dataset}.csv"`);
      res.send(toCsv(rows));
    }
  }

  // ── Archive ───────────────────────────────────────────────────────────────
  @Post("archive")
  @RequirePermission("import_export", "create")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: FILES_MAX_BYTES } }))
  async createArchive(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @UploadedFile() file: UploadedFileShape | undefined,
    @Body() body: ArchiveCreateDto,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      let fileObjectId: string;
      if (file) {
        const f = await this.files.upload(tx, p, file, "archive");
        fileObjectId = (f as { id: string }).id;
      } else if (body.url?.trim()) {
        const f = await this.files.link(tx, p, { url: body.url.trim(), kind: "archive", filename: body.filename });
        fileObjectId = (f as { id: string }).id;
      } else {
        throw new BadRequestException("Provide a file upload or a url");
      }
      const tags = body.tags ? body.tags.split(",").map((s) => s.trim()).filter(Boolean) : [];
      return this.archive.create(tx, p, {
        title: body.title,
        description: body.description,
        docDate: body.docDate,
        tags,
        fileObjectId,
      });
    });
  }

  @Get("archive")
  @RequirePermission("import_export", "view")
  listArchive(
    @CurrentRls() ctx: RlsContext,
    @Query("q") q?: string,
    @Query("tag") tag?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.archive.list(tx, { q, tag, from, to }));
  }

  @Get("archive/:id")
  @RequirePermission("import_export", "view")
  getArchive(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.archive.getById(tx, id));
  }
}
