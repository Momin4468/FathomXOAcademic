import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { FileKind, SessionPrincipal } from "@business-os/shared";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { AuditService } from "../../common/audit/audit.service.js";
import { PermissionService } from "../../common/authz/permission.service.js";
import { StorageService } from "../../common/storage/storage.service.js";
import type { LinkFileDto } from "./dto.js";

export const FILES_MAX_BYTES = Number(process.env.FILES_MAX_BYTES ?? 10 * 1024 * 1024); // 10 MB
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Org-public file kinds — readable by any org member (reference data). */
const PUBLIC_KINDS = new Set(["knowledge", "cover_sheet"]);

interface FileOwnerContext {
  kind: string;
  doerParty: string | null;
  sourceParty: string | null;
  paymentCounterparty: string | null;
  expenseCreatedBy: string | null;
  fileCreatedBy: string | null;
}

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * File pipeline (DESIGN_SPEC §1/§11 file rule): small files are stored in object
 * storage with in-system preview/download; large files & video are LINKS only;
 * images are compressed on upload. The DB holds only metadata (file_object) —
 * never the blob. Reused by knowledge media now, payment-proofs/briefs later.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Kind-aware per-file ACL (CLAUDE.md §4). org-public kinds (knowledge,
   * cover_sheet) are readable by any org member; sensitive kinds restrict to the
   * involved parties + the relevant domain admin + System SuperAdmin — so a
   * proof/brief/receipt can't be pulled by any org member by id. Ownership is
   * resolved server-side via the file_owner_context definer (bypasses the owners'
   * RLS so an entitled admin who isn't a party can still be authorized). 404 if
   * the file isn't in the caller's org.
   */
  private async assertCanRead(tx: Db, principal: SessionPrincipal, fileId: string) {
    const res = await tx.execute(sql`
      select kind, doer_party as "doerParty", source_party as "sourceParty",
             payment_counterparty as "paymentCounterparty",
             expense_created_by as "expenseCreatedBy", file_created_by as "fileCreatedBy"
      from file_owner_context(${fileId})
    `);
    const ctx = res.rows[0] as FileOwnerContext | undefined;
    if (!ctx) throw new NotFoundException("File not found");
    if (PUBLIC_KINDS.has(ctx.kind)) return;
    if (principal.isSystemSuperadmin) return;

    const party = principal.partyId;
    const user = principal.userId;
    const perms = await this.permissions.loadEffective(tx, user);
    const can = (k: string) => perms.perms.has(k);

    let ok = false;
    switch (ctx.kind) {
      case "brief":
        ok = (!!party && (party === ctx.doerParty || party === ctx.sourceParty)) || can("work:approve");
        break;
      case "solution":
        // No owner link for solutions yet → the uploader or a work admin (never
        // approve-only, which would lock out the writer who uploaded it).
        ok = user === ctx.fileCreatedBy || can("work:approve");
        break;
      case "proof":
        ok = (!!party && party === ctx.paymentCounterparty) || can("billing:approve");
        break;
      case "receipt":
        ok = user === ctx.expenseCreatedBy || can("expenses:approve");
        break;
      case "archive":
        // Dated business documents (0031): readable by any import_export viewer
        // (org docs) or the uploader.
        ok = can("import_export:view") || user === ctx.fileCreatedBy;
        break;
      default: // other / unlinked
        ok = user === ctx.fileCreatedBy;
    }
    if (!ok) throw new ForbiddenException("You don't have access to this file");
  }

  /** Upload a small file: enforce the size/type rule, compress images, store, record. */
  async upload(tx: Db, principal: SessionPrincipal, file: UploadedFile, kind: FileKind) {
    if (!file) throw new BadRequestException("No file provided");
    if (file.size > FILES_MAX_BYTES) {
      throw new BadRequestException(
        `File exceeds the ${Math.round(FILES_MAX_BYTES / 1024 / 1024)} MB limit — link it instead (POST /files/link)`,
      );
    }
    if (file.mimetype.startsWith("video/")) {
      throw new BadRequestException("Videos are link-only — use POST /files/link with a video URL");
    }

    let buffer = file.buffer;
    let mime = file.mimetype;
    if (COMPRESSIBLE.has(file.mimetype)) {
      // Downscale + re-encode (EXIF-rotated) — genuine compression, same format.
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
      .insert(schema.fileObject)
      .values({
        orgId: principal.orgId,
        kind,
        isLink: false,
        url: key, // opaque storage key, NOT a blob
        filename: file.originalname,
        mime,
        sizeBytes: buffer.length,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "file.uploaded",
      entity: "file_object",
      entityId: row!.id,
      detail: { kind, mime, sizeBytes: buffer.length, filename: file.originalname },
    });
    return this.meta(row!);
  }

  /** Register a large file / video as a link only (no bytes stored). */
  async link(tx: Db, principal: SessionPrincipal, dto: LinkFileDto) {
    const [row] = await tx
      .insert(schema.fileObject)
      .values({
        orgId: principal.orgId,
        kind: dto.kind,
        isLink: true,
        url: dto.url,
        filename: dto.filename ?? null,
        createdBy: principal.userId,
      })
      .returning();
    // Log only the host — a link URL can carry secrets (pre-signed/tokened URLs)
    // and audit_log is append-only + admin-readable.
    let urlHost = "";
    try {
      urlHost = new URL(dto.url).host;
    } catch {
      urlHost = "";
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "file.linked",
      entity: "file_object",
      entityId: row!.id,
      detail: { kind: dto.kind, urlHost },
    });
    return this.meta(row!);
  }

  async getMeta(tx: Db, principal: SessionPrincipal, id: string) {
    await this.assertCanRead(tx, principal, id);
    const [row] = await tx.select().from(schema.fileObject).where(eq(schema.fileObject.id, id));
    if (!row) throw new NotFoundException("File not found");
    return this.meta(row);
  }

  /** Resolve a file for download: a link → its url; a stored file → a disk stream. */
  async openForDownload(tx: Db, principal: SessionPrincipal, id: string) {
    await this.assertCanRead(tx, principal, id);
    const [row] = await tx.select().from(schema.fileObject).where(eq(schema.fileObject.id, id));
    if (!row) throw new NotFoundException("File not found");
    if (row.isLink) return { isLink: true as const, url: row.url ?? "" };
    if (!row.url) throw new NotFoundException("File has no stored content");
    return {
      isLink: false as const,
      stream: await this.storage.readStream(row.url),
      mime: row.mime ?? "application/octet-stream",
      filename: row.filename ?? "download",
    };
  }

  /** Public metadata shape (never exposes anything secret; url is a key/link). */
  private meta(row: typeof schema.fileObject.$inferSelect) {
    return {
      id: row.id,
      kind: row.kind,
      isLink: row.isLink,
      filename: row.filename,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      url: row.isLink ? row.url : null, // a stored file's key is never exposed; download via /files/:id/download
      createdAt: row.createdAt,
    };
  }
}
