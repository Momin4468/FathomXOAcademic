import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { ClientPrincipal } from "@business-os/shared";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { StorageService } from "../../common/storage/storage.service.js";
import type { UploadedFile } from "../files/files.service.js";
import { FILES_MAX_BYTES } from "../files/files.service.js";
import type { SubmitRequestDto } from "./dto.js";

const VIDEO_PREFIX = "video/";

/**
 * The client-facing portal service (Module 18). Every READ goes through a
 * caller-guarded SECURITY DEFINER (client_works / client_outstanding /
 * client_messages) so the chain/margin/writer is never exposed; every WRITE
 * forces the party from the verified token (the client can't set a source or
 * price anything). Runs under the business RLS context scoped to the client party.
 */
@Injectable()
export class ClientPortalService {
  constructor(
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Re-check the account before a WRITE: an access token outlives a deactivation
   * (or a lead's expiry) for its TTL, so confirm the live status in-tx before
   * mutating. Reads stay open (they're harmless + already scoped).
   */
  private async assertWritable(tx: Db, p: ClientPrincipal): Promise<void> {
    const [a] = await tx
      .select({ status: schema.clientAccount.status, expiresAt: schema.clientAccount.expiresAt })
      .from(schema.clientAccount)
      .where(eq(schema.clientAccount.id, p.clientAccountId));
    if (!a || a.status === "deactivated") throw new ForbiddenException("This account can no longer make changes");
    if (a.status === "lead" && a.expiresAt && a.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException("This account has expired");
    }
  }

  /** The client's own jobs + their consumer-side billing (status + amounts only). */
  async works(tx: Db, p: ClientPrincipal) {
    const res = await tx.execute(sql`
      select work_item_id as "workItemId", title, work_state as "workState",
             money_state as "moneyState", amount_billed as "amountBilled",
             amount_paid as "amountPaid", amount_due as "amountDue", created_at as "createdAt"
      from client_works(${p.partyId})
    `);
    return res.rows;
  }

  /** The client's AR position (billed/paid/due). */
  async summary(tx: Db, p: ClientPrincipal) {
    const res = await tx.execute(sql`
      select billed, paid, due from client_outstanding(${p.partyId})
    `);
    const row = (res.rows[0] as { billed: string; paid: string; due: string } | undefined) ?? {
      billed: "0",
      paid: "0",
      due: "0",
    };
    return { billed: Number(row.billed), paid: Number(row.paid), due: Number(row.due) };
  }

  /** The client's own message thread (and mark admin messages read). */
  async listMessages(tx: Db, p: ClientPrincipal) {
    const res = await tx.execute(sql`
      select id, body, sender, read_at as "readAt", created_at as "createdAt"
      from client_messages(${p.partyId})
    `);
    return res.rows;
  }

  async sendMessage(tx: Db, p: ClientPrincipal, body: string) {
    await this.assertWritable(tx, p);
    const text = body.trim();
    if (!text) throw new BadRequestException("Message cannot be empty");
    const [row] = await tx
      .insert(schema.clientMessage)
      .values({
        orgId: p.orgId,
        partyId: p.partyId, // forced from the token — the client can only post to their own thread
        body: text,
        sender: "client",
        createdByClientAccountId: p.clientAccountId,
      })
      .returning({ id: schema.clientMessage.id });
    await this.audit.record(tx, p.orgId, {
      actorUserId: null,
      action: "client.message_sent",
      entity: "client_message",
      entityId: row!.id,
      detail: { clientAccountId: p.clientAccountId },
    });
    return { id: row!.id };
  }

  /**
   * Submit a work request → a DRAFT job. source_party_id is FORCED to the client's
   * own party (the client cannot set a source, a doer, or any price); zero legs are
   * created. The admin alone confirms (work:approve) + prices it. The provenance
   * marker client_account_id powers the admin's "client requests" queue + the lead
   * promotion trigger on confirm.
   */
  async submitRequest(tx: Db, p: ClientPrincipal, dto: SubmitRequestDto) {
    await this.assertWritable(tx, p);
    const [item] = await tx
      .insert(schema.workItem)
      .values({
        orgId: p.orgId,
        title: dto.title.trim(),
        details: dto.details?.trim() ?? null,
        sourcePartyId: p.partyId,
        clientAccountId: p.clientAccountId,
        // workState defaults to 'draft', moneyState 'unbilled' — never priced here.
        updatedAt: new Date(),
      })
      .returning({ id: schema.workItem.id });
    await this.audit.record(tx, p.orgId, {
      actorUserId: null,
      action: "client.request_submitted",
      entity: "work_item",
      entityId: item!.id,
      detail: { clientAccountId: p.clientAccountId, title: dto.title },
    });
    return { id: item!.id, workState: "draft" as const };
  }

  /** Attach a brief to the client's OWN draft request (reuses the file rule). */
  async attachBrief(tx: Db, p: ClientPrincipal, workItemId: string, file: UploadedFile) {
    await this.assertWritable(tx, p);
    // The job must be the client's own, still a draft.
    const [job] = await tx
      .select({ id: schema.workItem.id, workState: schema.workItem.workState })
      .from(schema.workItem)
      .where(
        and(
          eq(schema.workItem.id, workItemId),
          eq(schema.workItem.sourcePartyId, p.partyId),
          eq(schema.workItem.clientAccountId, p.clientAccountId),
        ),
      );
    if (!job) throw new NotFoundException("Request not found");
    if (job.workState !== "draft") throw new BadRequestException("This request can no longer be edited");

    // Large files & video → store as a link is not possible from a binary upload;
    // reject oversize/video here (a link path would need a URL, not a file).
    if (file.mimetype.startsWith(VIDEO_PREFIX)) {
      throw new BadRequestException("Video briefs aren't supported — share a link with us in a message instead");
    }
    if (file.size > FILES_MAX_BYTES) {
      throw new BadRequestException(`File too large (max ${Math.floor(FILES_MAX_BYTES / 1024 / 1024)}MB)`);
    }
    const key = await this.storage.put(file.buffer);
    const [fileObj] = await tx
      .insert(schema.fileObject)
      .values({
        orgId: p.orgId,
        kind: "brief",
        isLink: false,
        url: key,
        filename: file.originalname,
        sizeBytes: file.size,
        mime: file.mimetype,
        createdBy: null,
      })
      .returning({ id: schema.fileObject.id });
    await tx
      .update(schema.workItem)
      .set({ briefFileId: fileObj!.id, updatedAt: new Date() })
      .where(eq(schema.workItem.id, workItemId));
    await this.audit.record(tx, p.orgId, {
      actorUserId: null,
      action: "client.brief_attached",
      entity: "work_item",
      entityId: workItemId,
      detail: { clientAccountId: p.clientAccountId, fileId: fileObj!.id },
    });
    return { ok: true, fileId: fileObj!.id, filename: file.originalname };
  }

  /** Portal display config — the WhatsApp handoff link (no API integration). */
  config() {
    const number = (process.env.CLIENT_PORTAL_WHATSAPP ?? "").replace(/[^0-9]/g, "");
    return {
      whatsappUrl: number ? `https://wa.me/${number}` : null,
    };
  }
}
