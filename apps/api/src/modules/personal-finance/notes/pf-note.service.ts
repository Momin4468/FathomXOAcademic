import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { and, desc, eq, ilike, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import sharp from "sharp";
import { StorageService } from "../../../common/storage/storage.service.js";
import { PfAuditService } from "../pf-audit.service.js";
import type { AddNoteLinkDto, CreateNoteDto, ListNotesQueryDto, UpdateNoteDto } from "./pf-note.dto.js";

const day = (s: string) => s.slice(0, 10);

/** Same file rule as the business pipeline: small files stored, large → link. */
export const NOTE_ATTACH_MAX_BYTES = Number(process.env.FILES_MAX_BYTES ?? 10 * 1024 * 1024);
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Minimal multipart file shape (multer). */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Personal notes (§11, in the PF private plane). Editable scratch data — lists,
 * free text, reminders, attachments — all RLS-scoped to the owning pf_account.
 * Attachments honor the file rule (metadata + reference, never blobs).
 */
@Injectable()
export class PfNoteService {
  constructor(
    private readonly storage: StorageService,
    private readonly audit: PfAuditService,
  ) {}

  async create(tx: Db, pfAccountId: string, dto: CreateNoteDto) {
    const [row] = await tx
      .insert(schema.pfNote)
      .values({
        pfAccountId,
        title: dto.title?.trim() || null,
        body: dto.body ?? null,
        items: dto.items ?? [],
        color: dto.color ?? null,
        pinned: dto.pinned ?? false,
        remindOn: dto.remindOn ? day(dto.remindOn) : null,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.note_created", entity: "pf_note", entityId: row!.id });
    return row!;
  }

  list(tx: Db, _pfAccountId: string, filters: ListNotesQueryDto) {
    const conds: SQL[] = [filters.archived === "true" ? isNotNull(schema.pfNote.archivedAt) : isNull(schema.pfNote.archivedAt)];
    if (filters.q) {
      const like = `%${filters.q}%`;
      conds.push(or(ilike(schema.pfNote.title, like), ilike(schema.pfNote.body, like)) as SQL);
    }
    return tx
      .select()
      .from(schema.pfNote)
      .where(and(...conds))
      .orderBy(desc(schema.pfNote.pinned), desc(schema.pfNote.updatedAt))
      .limit(500);
  }

  async getById(tx: Db, _pfAccountId: string, id: string) {
    const [note] = await tx.select().from(schema.pfNote).where(eq(schema.pfNote.id, id));
    if (!note) throw new NotFoundException("Note not found");
    const attachments = await tx
      .select()
      .from(schema.pfNoteAttachment)
      .where(eq(schema.pfNoteAttachment.noteId, id))
      .orderBy(schema.pfNoteAttachment.createdAt);
    return { ...note, attachments };
  }

  async update(tx: Db, pfAccountId: string, id: string, dto: UpdateNoteDto) {
    const [existing] = await tx.select().from(schema.pfNote).where(eq(schema.pfNote.id, id));
    if (!existing) throw new NotFoundException("Note not found");
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title?.trim() || null;
    if (dto.body !== undefined) patch.body = dto.body ?? null;
    if (dto.items !== undefined) patch.items = dto.items;
    if (dto.color !== undefined) patch.color = dto.color ?? null;
    if (dto.pinned !== undefined) patch.pinned = dto.pinned;
    if (dto.remindOn !== undefined) {
      patch.remindOn = dto.remindOn ? day(dto.remindOn) : null;
      // A changed reminder date re-arms the email for the new date.
      patch.lastRemindedOn = null;
    }
    const [row] = await tx.update(schema.pfNote).set(patch).where(eq(schema.pfNote.id, id)).returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.note_updated", entity: "pf_note", entityId: id });
    return row!;
  }

  async archive(tx: Db, pfAccountId: string, id: string) {
    const [row] = await tx
      .update(schema.pfNote)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.pfNote.id, id), isNull(schema.pfNote.archivedAt)))
      .returning();
    if (!row) throw new NotFoundException("Note not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.note_archived", entity: "pf_note", entityId: id });
    return { ok: true };
  }

  async restore(tx: Db, pfAccountId: string, id: string) {
    const [row] = await tx
      .update(schema.pfNote)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(schema.pfNote.id, id))
      .returning();
    if (!row) throw new NotFoundException("Note not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.note_restored", entity: "pf_note", entityId: id });
    return row;
  }

  /** Confirm a note exists in THIS account (RLS-scoped) before attaching to it. */
  private async assertNote(tx: Db, noteId: string): Promise<void> {
    const [n] = await tx.select({ id: schema.pfNote.id }).from(schema.pfNote).where(eq(schema.pfNote.id, noteId));
    if (!n) throw new NotFoundException("Note not found");
  }

  async addLink(tx: Db, pfAccountId: string, noteId: string, dto: AddNoteLinkDto) {
    await this.assertNote(tx, noteId);
    const [row] = await tx
      .insert(schema.pfNoteAttachment)
      .values({ pfAccountId, noteId, isLink: true, url: dto.url, filename: dto.filename ?? null })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.note_link_added", entity: "pf_note_attachment", entityId: row!.id, detail: { noteId } });
    return row!;
  }

  /** Upload a small file: enforce the size/type rule, compress images, store, record. */
  async attachUpload(tx: Db, pfAccountId: string, noteId: string, file: UploadedFile) {
    await this.assertNote(tx, noteId);
    if (!file) throw new BadRequestException("No file provided");
    if (file.size > NOTE_ATTACH_MAX_BYTES) {
      throw new BadRequestException(
        `File exceeds the ${Math.round(NOTE_ATTACH_MAX_BYTES / 1024 / 1024)} MB limit — attach it as a link instead`,
      );
    }
    if (file.mimetype.startsWith("video/")) {
      throw new BadRequestException("Videos are link-only — attach a video URL instead");
    }
    let buffer = file.buffer;
    let mime = file.mimetype;
    if (COMPRESSIBLE.has(file.mimetype)) {
      const img = sharp(file.buffer).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true });
      if (file.mimetype === "image/png") buffer = await img.png({ compressionLevel: 9 }).toBuffer();
      else if (file.mimetype === "image/webp") buffer = await img.webp({ quality: 80 }).toBuffer();
      else {
        buffer = await img.jpeg({ quality: 80 }).toBuffer();
        mime = "image/jpeg";
      }
    }
    const key = await this.storage.put(buffer);
    const [row] = await tx
      .insert(schema.pfNoteAttachment)
      .values({ pfAccountId, noteId, isLink: false, url: key, filename: file.originalname, mime, sizeBytes: buffer.length })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.note_file_attached", entity: "pf_note_attachment", entityId: row!.id, detail: { noteId, mime } });
    return row!;
  }

  async removeAttachment(tx: Db, pfAccountId: string, attachmentId: string) {
    const [att] = await tx.select().from(schema.pfNoteAttachment).where(eq(schema.pfNoteAttachment.id, attachmentId));
    if (!att) throw new NotFoundException("Attachment not found");
    await tx.delete(schema.pfNoteAttachment).where(eq(schema.pfNoteAttachment.id, attachmentId));
    if (!att.isLink) await this.storage.remove(att.url); // best-effort byte cleanup
    await this.audit.record(tx, pfAccountId, { action: "pf.note_attachment_removed", entity: "pf_note_attachment", entityId: attachmentId });
    return { ok: true };
  }

  /** Resolve an attachment for download (RLS scopes it to the owning account). */
  async openForDownload(tx: Db, _pfAccountId: string, attachmentId: string) {
    const [att] = await tx.select().from(schema.pfNoteAttachment).where(eq(schema.pfNoteAttachment.id, attachmentId));
    if (!att) throw new NotFoundException("Attachment not found");
    if (att.isLink) return { isLink: true as const, url: att.url };
    return {
      isLink: false as const,
      stream: await this.storage.readStream(att.url),
      mime: att.mime ?? "application/octet-stream",
      filename: att.filename ?? "download",
    };
  }
}
