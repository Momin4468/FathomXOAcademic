import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import type {
  AttachDto,
  CreateArticleDto,
  CreateCoverSheetDto,
  ListArticlesQueryDto,
  ListCoverSheetsQueryDto,
  UpdateArticleDto,
  UpdateCoverSheetDto,
} from "./dto.js";

/** File metadata exposed with an article's attachments (never the storage key). */
const FILE_META = {
  id: schema.fileObject.id,
  kind: schema.fileObject.kind,
  isLink: schema.fileObject.isLink,
  filename: schema.fileObject.filename,
  mime: schema.fileObject.mime,
  sizeBytes: schema.fileObject.sizeBytes,
  url: schema.fileObject.url, // only meaningful for links; stored files download via /files/:id/download
} as const;

/**
 * Knowledge base (§8) — docs/prompt-packs/blogs with OPEN AUTHORING (any role
 * with knowledge:create), media via the file pipeline, and links to a
 * university/programme (ref_entity) so a university hub surfaces its content.
 * Plus cover-sheet templates (reference data + a file), readable by all.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly audit: AuditService) {}

  private canCurate(principal: SessionPrincipal, perms: EffectivePermissions): boolean {
    return principal.isSystemSuperadmin || perms.perms.has("knowledge:approve");
  }

  // ── articles ──
  async createArticle(tx: Db, principal: SessionPrincipal, dto: CreateArticleDto) {
    const [article] = await tx
      .insert(schema.knowledgeArticle)
      .values({
        orgId: principal.orgId,
        type: dto.type,
        title: dto.title.trim(),
        body: dto.body ?? null,
        universityRefId: dto.universityRefId ?? null,
        programmeRefId: dto.programmeRefId ?? null,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    for (const fileId of dto.attachmentFileIds ?? []) {
      await tx.insert(schema.knowledgeAttachment).values({
        orgId: principal.orgId,
        articleId: article!.id,
        fileObjectId: fileId,
        createdBy: principal.userId,
      });
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "knowledge.article_created",
      entity: "knowledge_article",
      entityId: article!.id,
      detail: { type: dto.type, title: article!.title },
    });
    return article!;
  }

  private async loadArticle(tx: Db, id: string) {
    const [a] = await tx.select().from(schema.knowledgeArticle).where(eq(schema.knowledgeArticle.id, id));
    if (!a) throw new NotFoundException("Article not found");
    return a;
  }

  /** Author-own (the creator) or a curator (knowledge:approve) may edit/archive. */
  private assertCanEdit(article: { createdBy: string | null }, principal: SessionPrincipal, perms: EffectivePermissions) {
    if (!this.canCurate(principal, perms) && article.createdBy !== principal.userId) {
      throw new ForbiddenException("Only the author or a curator can change this article");
    }
  }

  async updateArticle(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, id: string, dto: UpdateArticleDto) {
    const article = await this.loadArticle(tx, id);
    this.assertCanEdit(article, principal, perms);
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    for (const k of ["type", "title", "body", "universityRefId", "programmeRefId"] as const) {
      if (dto[k] !== undefined) patch[k] = k === "title" && dto.title ? dto.title.trim() : dto[k];
    }
    // Publish/unpublish is a curation action — only a curator may change status.
    if (dto.status !== undefined && this.canCurate(principal, perms)) patch.status = dto.status;
    const [row] = await tx
      .update(schema.knowledgeArticle)
      .set(patch)
      .where(eq(schema.knowledgeArticle.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "knowledge.article_updated",
      entity: "knowledge_article",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return row!;
  }

  async archiveArticle(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, id: string) {
    const article = await this.loadArticle(tx, id);
    this.assertCanEdit(article, principal, perms);
    await tx
      .update(schema.knowledgeArticle)
      .set({ archivedAt: new Date(), updatedBy: principal.userId, updatedAt: new Date() })
      .where(eq(schema.knowledgeArticle.id, id));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "knowledge.article_archived",
      entity: "knowledge_article",
      entityId: id,
    });
    return { ok: true };
  }

  listArticles(tx: Db, q: ListArticlesQueryDto) {
    const conds = [isNull(schema.knowledgeArticle.archivedAt)];
    if (q.type) conds.push(eq(schema.knowledgeArticle.type, q.type));
    if (q.universityRefId) conds.push(eq(schema.knowledgeArticle.universityRefId, q.universityRefId));
    return tx
      .select({
        id: schema.knowledgeArticle.id,
        type: schema.knowledgeArticle.type,
        title: schema.knowledgeArticle.title,
        universityRefId: schema.knowledgeArticle.universityRefId,
        programmeRefId: schema.knowledgeArticle.programmeRefId,
        status: schema.knowledgeArticle.status,
        updatedAt: schema.knowledgeArticle.updatedAt,
      })
      .from(schema.knowledgeArticle)
      .where(and(...conds))
      .orderBy(desc(schema.knowledgeArticle.updatedAt))
      .limit(200);
  }

  async getArticle(tx: Db, id: string) {
    const article = await this.loadArticle(tx, id);
    const rows = await tx
      .select(FILE_META)
      .from(schema.knowledgeAttachment)
      .innerJoin(schema.fileObject, eq(schema.knowledgeAttachment.fileObjectId, schema.fileObject.id))
      .where(eq(schema.knowledgeAttachment.articleId, id));
    // A stored file's storage key is never exposed — only a link's URL is meaningful.
    const attachments = rows.map((f) => ({ ...f, url: f.isLink ? f.url : null }));
    return { article, attachments };
  }

  async attach(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, articleId: string, dto: AttachDto) {
    const article = await this.loadArticle(tx, articleId);
    this.assertCanEdit(article, principal, perms);
    await tx.insert(schema.knowledgeAttachment).values({
      orgId: principal.orgId,
      articleId,
      fileObjectId: dto.fileObjectId,
      createdBy: principal.userId,
    });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "knowledge.attachment_added",
      entity: "knowledge_article",
      entityId: articleId,
      detail: { fileObjectId: dto.fileObjectId },
    });
    return { ok: true };
  }

  async detach(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, articleId: string, fileId: string) {
    const article = await this.loadArticle(tx, articleId);
    this.assertCanEdit(article, principal, perms);
    await tx
      .delete(schema.knowledgeAttachment)
      .where(and(eq(schema.knowledgeAttachment.articleId, articleId), eq(schema.knowledgeAttachment.fileObjectId, fileId)));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "knowledge.attachment_removed",
      entity: "knowledge_article",
      entityId: articleId,
      detail: { fileObjectId: fileId },
    });
    return { ok: true };
  }

  // ── cover-sheet templates (curator-managed; readable by all) ──
  async createCoverSheet(tx: Db, principal: SessionPrincipal, dto: CreateCoverSheetDto) {
    const [row] = await tx
      .insert(schema.coverSheetTemplate)
      .values({
        orgId: principal.orgId,
        name: dto.name.trim(),
        universityRefId: dto.universityRefId ?? null,
        programmeRefId: dto.programmeRefId ?? null,
        fileObjectId: dto.fileObjectId ?? null,
        notes: dto.notes ?? null,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "knowledge.cover_sheet_created",
      entity: "cover_sheet_template",
      entityId: row!.id,
      detail: { name: row!.name, universityRefId: dto.universityRefId ?? null },
    });
    return row!;
  }

  async updateCoverSheet(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateCoverSheetDto) {
    const [existing] = await tx.select().from(schema.coverSheetTemplate).where(eq(schema.coverSheetTemplate.id, id));
    if (!existing) throw new NotFoundException("Cover sheet not found");
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    for (const k of ["name", "universityRefId", "programmeRefId", "fileObjectId", "notes"] as const) {
      if (dto[k] !== undefined) patch[k] = k === "name" && dto.name ? dto.name.trim() : dto[k];
    }
    const [row] = await tx.update(schema.coverSheetTemplate).set(patch).where(eq(schema.coverSheetTemplate.id, id)).returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "knowledge.cover_sheet_updated",
      entity: "cover_sheet_template",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return row!;
  }

  listCoverSheets(tx: Db, q: ListCoverSheetsQueryDto) {
    const conds = [isNull(schema.coverSheetTemplate.archivedAt)];
    if (q.universityRefId) conds.push(eq(schema.coverSheetTemplate.universityRefId, q.universityRefId));
    return tx
      .select()
      .from(schema.coverSheetTemplate)
      .where(and(...conds))
      .orderBy(desc(schema.coverSheetTemplate.updatedAt))
      .limit(200);
  }

  /** University hub: opening a university surfaces its programmes, referencing
   *  style, linked articles, and cover sheets (§7). */
  async getUniversityHub(tx: Db, refId: string) {
    const [university] = await tx
      .select({ id: schema.refEntity.id, kind: schema.refEntity.kind, canonical: schema.refEntity.canonical })
      .from(schema.refEntity)
      .where(eq(schema.refEntity.id, refId));
    if (!university) throw new NotFoundException("University not found");

    const children = await tx
      .select({ id: schema.refEntity.id, kind: schema.refEntity.kind, canonical: schema.refEntity.canonical })
      .from(schema.refEntity)
      .where(and(eq(schema.refEntity.parentId, refId), isNull(schema.refEntity.archivedAt)));

    const articles = await this.listArticles(tx, { universityRefId: refId });
    const coverSheets = await this.listCoverSheets(tx, { universityRefId: refId });

    return {
      university,
      programmes: children.filter((c) => c.kind !== "referencing_style"),
      referencingStyles: children.filter((c) => c.kind === "referencing_style"),
      articles,
      coverSheets,
    };
  }
}
