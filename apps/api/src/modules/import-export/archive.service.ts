import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, desc, eq, gte, ilike, isNull, lte, or, type SQL } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";

const day = (s: string) => s.slice(0, 10);

export interface CreateArchiveArgs {
  title: string;
  description?: string;
  docDate?: string;
  tags?: string[];
  fileObjectId: string; // the uploaded/linked file (via the file pipeline)
}

/**
 * A dated, searchable store of business documents (old sheets, the 2025 file,
 * references). Content is read-only (the file is immutable via the file pipeline);
 * we hold light, searchable metadata. RLS-scoped to the org. Archived, not deleted.
 */
@Injectable()
export class ArchiveService {
  constructor(private readonly audit: AuditService) {}

  async create(tx: Db, principal: SessionPrincipal, args: CreateArchiveArgs) {
    if (!args.title?.trim()) throw new BadRequestException("title is required");
    const [row] = await tx
      .insert(schema.archiveItem)
      .values({
        orgId: principal.orgId,
        title: args.title.trim(),
        description: args.description?.trim() || null,
        docDate: args.docDate ? day(args.docDate) : null,
        tags: args.tags ?? [],
        fileObjectId: args.fileObjectId,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "archive.added",
      entity: "archive_item",
      entityId: row!.id,
      detail: { title: args.title },
    });
    return row!;
  }

  /** Light search: title/description ilike, a tag match, and a doc-date range. */
  async list(tx: Db, filters: { q?: string; tag?: string; from?: string; to?: string }) {
    const conds: SQL[] = [isNull(schema.archiveItem.archivedAt)];
    if (filters.q?.trim()) {
      const like = `%${filters.q.trim()}%`;
      conds.push(or(ilike(schema.archiveItem.title, like), ilike(schema.archiveItem.description, like)) as SQL);
    }
    if (filters.tag?.trim()) conds.push(sql`${schema.archiveItem.tags} @> array[${filters.tag.trim()}]::text[]`);
    if (filters.from) conds.push(gte(schema.archiveItem.docDate, day(filters.from)));
    if (filters.to) conds.push(lte(schema.archiveItem.docDate, day(filters.to)));
    // Join the file metadata so the UI can open a stored file vs. follow a link.
    return tx
      .select({
        id: schema.archiveItem.id,
        title: schema.archiveItem.title,
        description: schema.archiveItem.description,
        docDate: schema.archiveItem.docDate,
        tags: schema.archiveItem.tags,
        fileObjectId: schema.archiveItem.fileObjectId,
        createdAt: schema.archiveItem.createdAt,
        fileIsLink: schema.fileObject.isLink,
        fileUrl: schema.fileObject.url,
        fileName: schema.fileObject.filename,
      })
      .from(schema.archiveItem)
      .leftJoin(schema.fileObject, eq(schema.fileObject.id, schema.archiveItem.fileObjectId))
      .where(and(...conds))
      .orderBy(desc(schema.archiveItem.docDate), desc(schema.archiveItem.createdAt))
      .limit(500);
  }

  async getById(tx: Db, id: string) {
    const [row] = await tx.select().from(schema.archiveItem).where(eq(schema.archiveItem.id, id));
    if (!row) throw new NotFoundException("Archive item not found");
    return row;
  }
}
