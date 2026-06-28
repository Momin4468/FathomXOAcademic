import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { AddNoteLinkDto, CreateNoteDto, ListNotesQueryDto, UpdateNoteDto } from "./pf-note.dto.js";
import { NOTE_ATTACH_MAX_BYTES, PfNoteService, type UploadedFile as UploadedFileShape } from "./pf-note.service.js";
import { PfNoteReminderService } from "./pf-note-reminder.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/notes")
export class PfNoteController {
  constructor(
    private readonly db: DbService,
    private readonly notes: PfNoteService,
    private readonly reminders: PfNoteReminderService,
  ) {}

  /** Manually fire today's note reminders for THIS account (daily @Cron sweeps all). */
  @Post("reminders/run")
  runReminders(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, async (tx) => ({
      sent: await this.reminders.runForAccount(tx, p.pfAccountId),
    }));
  }

  @Post()
  create(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreateNoteDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.create(tx, p.pfAccountId, dto));
  }

  @Get()
  list(@CurrentPfAccount() p: PfPrincipal, @Query() q: ListNotesQueryDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.list(tx, p.pfAccountId, q));
  }

  @Get(":id")
  getById(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.getById(tx, p.pfAccountId, id));
  }

  @Patch(":id")
  update(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateNoteDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.update(tx, p.pfAccountId, id, dto));
  }

  @Post(":id/archive")
  archive(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.archive(tx, p.pfAccountId, id));
  }

  @Post(":id/restore")
  restore(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.restore(tx, p.pfAccountId, id));
  }

  @Post(":id/attachments/link")
  addLink(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AddNoteLinkDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.addLink(tx, p.pfAccountId, id, dto));
  }

  @Post(":id/attachments")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: NOTE_ATTACH_MAX_BYTES } }))
  attachUpload(
    @CurrentPfAccount() p: PfPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileShape,
  ) {
    if (!file) throw new BadRequestException("No file provided (field name must be 'file')");
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.attachUpload(tx, p.pfAccountId, id, file));
  }
}

/** Attachment-by-id operations (download/delete). Separate base path `pf/attachments`. */
@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/attachments")
export class PfAttachmentController {
  constructor(
    private readonly db: DbService,
    private readonly notes: PfNoteService,
  ) {}

  @Get(":id/download")
  async download(
    @CurrentPfAccount() p: PfPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.openForDownload(tx, p.pfAccountId, id));
    if (f.isLink) throw new BadRequestException("This is a link — open its URL directly");
    const inlineOk = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    res.setHeader("content-type", f.mime);
    res.setHeader("x-content-type-options", "nosniff");
    const safeName = f.filename.replace(/[\r\n"]/g, "");
    res.setHeader(
      "content-disposition",
      `${inlineOk.has(f.mime) ? "inline" : "attachment"}; filename="${safeName}"`,
    );
    return new StreamableFile(f.stream);
  }

  @Delete(":id")
  remove(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.notes.removeAttachment(tx, p.pfAccountId, id));
  }
}
