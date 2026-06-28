import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { LinkFileDto, UploadMetaDto } from "./dto.js";
import { FILES_MAX_BYTES, FilesService, type UploadedFile as UploadedFileShape } from "./files.service.js";

/**
 * File pipeline endpoints (auth-only; the file_object is tenant-RLS so a download
 * is same-org). Uploads enforce the file rule (size cap, no video, image
 * compression); large files / video are registered as links.
 */
@Controller("files")
export class FilesController {
  constructor(
    private readonly db: DbService,
    private readonly files: FilesService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: FILES_MAX_BYTES } }))
  upload(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @UploadedFile() file: UploadedFileShape,
    @Body() meta: UploadMetaDto,
  ) {
    if (!file) throw new BadRequestException("No file provided (field name must be 'file')");
    return this.db.withTenant(ctx, (tx) => this.files.upload(tx, p, file, meta.kind ?? "other"));
  }

  @Post("link")
  link(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: LinkFileDto) {
    return this.db.withTenant(ctx, (tx) => this.files.link(tx, p, dto));
  }

  @Get(":id")
  meta(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.files.getMeta(tx, id));
  }

  /** Stream a STORED file. Link files are opened directly from their metadata
   *  URL by the client — never bounced through here (avoids an open redirect). */
  @Get(":id/download")
  async download(
    @CurrentRls() ctx: RlsContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.db.withTenant(ctx, (tx) => this.files.openForDownload(tx, id));
    if (f.isLink) throw new BadRequestException("This is a link — open its URL directly");
    // Only known-safe image types render inline; everything else is forced to
    // download (an inline text/html or SVG on our origin would be stored-XSS).
    const inlineOk = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    res.setHeader("content-type", f.mime);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader(
      "content-disposition",
      `${inlineOk.has(f.mime) ? "inline" : "attachment"}; filename="${f.filename.replace(/"/g, "")}"`,
    );
    return new StreamableFile(f.stream);
  }
}
