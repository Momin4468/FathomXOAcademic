import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { PasswordService } from "../../common/auth/password.service.js";
import { DbService } from "../../common/db/db.service.js";
import type { AdminReplyDto, ProvisionAccountDto, UpdateAccountDto } from "./dto.js";

/**
 * Admin-side management of the client portal (Module 18), gated by the
 * `client_portal` business permission. Provisions logins for existing client
 * parties, reads/replies to client message threads, and hosts the lead-retention
 * purge (manual endpoint + a daily @Cron sweeping every org).
 */
@Injectable()
export class ClientAdminService {
  private readonly logger = new Logger(ClientAdminService.name);

  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  listAccounts(tx: Db) {
    return tx
      .select({
        id: schema.clientAccount.id,
        partyId: schema.clientAccount.partyId,
        partyName: schema.party.displayName,
        loginId: schema.clientAccount.loginId,
        status: schema.clientAccount.status,
        expiresAt: schema.clientAccount.expiresAt,
        createdAt: schema.clientAccount.createdAt,
      })
      .from(schema.clientAccount)
      .leftJoin(schema.party, eq(schema.party.id, schema.clientAccount.partyId))
      .orderBy(desc(schema.clientAccount.createdAt));
  }

  async provisionAccount(tx: Db, principal: SessionPrincipal, dto: ProvisionAccountDto) {
    const [party] = await tx
      .select({ id: schema.party.id, partyType: schema.party.partyType })
      .from(schema.party)
      .where(and(eq(schema.party.id, dto.partyId), isNull(schema.party.archivedAt)));
    if (!party) throw new NotFoundException("Client party not found");
    if (!(party.partyType ?? []).includes("client")) {
      throw new BadRequestException("That party is not a client (tag party_type 'client' first)");
    }
    const passwordHash = await this.passwords.hash(dto.password);
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(schema.clientAccount)
        .values({
          orgId: principal.orgId,
          partyId: dto.partyId,
          loginId: dto.loginId.trim(),
          passwordHash,
          status: "invited",
          createdBy: principal.userId,
          updatedBy: principal.userId,
        })
        .returning({ id: schema.clientAccount.id });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        throw new ConflictException("That login id is taken, or this client already has a login");
      }
      throw e;
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "client_portal.account_provisioned",
      entity: "client_account",
      entityId: row!.id,
      detail: { partyId: dto.partyId, loginId: dto.loginId },
    });
    return { id: row!.id, loginId: dto.loginId, status: "invited" as const };
  }

  async updateAccount(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateAccountDto) {
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.password !== undefined) patch.passwordHash = await this.passwords.hash(dto.password);
    if (dto.status !== undefined) {
      if (dto.status !== "active" && dto.status !== "deactivated") {
        throw new BadRequestException("status must be active or deactivated");
      }
      patch.status = dto.status;
    }
    const [row] = await tx
      .update(schema.clientAccount)
      .set(patch)
      .where(eq(schema.clientAccount.id, id))
      .returning({ id: schema.clientAccount.id });
    if (!row) throw new NotFoundException("Client account not found");
    // Reset password / deactivate → revoke all live refresh tokens (force re-login).
    if (dto.password !== undefined || dto.status === "deactivated") {
      await tx
        .update(schema.clientRefreshToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.clientRefreshToken.clientAccountId, id), isNull(schema.clientRefreshToken.revokedAt)));
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "client_portal.account_updated",
      entity: "client_account",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt") },
    });
    return { id, ok: true };
  }

  /** Admin view of a client's message thread (org-scoped). */
  listMessages(tx: Db, partyId: string) {
    return tx
      .select({
        id: schema.clientMessage.id,
        body: schema.clientMessage.body,
        sender: schema.clientMessage.sender,
        readAt: schema.clientMessage.readAt,
        createdAt: schema.clientMessage.createdAt,
      })
      .from(schema.clientMessage)
      .where(eq(schema.clientMessage.partyId, partyId))
      .orderBy(schema.clientMessage.createdAt);
  }

  async reply(tx: Db, principal: SessionPrincipal, dto: AdminReplyDto) {
    const text = dto.body.trim();
    if (!text) throw new BadRequestException("Message cannot be empty");
    const [row] = await tx
      .insert(schema.clientMessage)
      .values({
        orgId: principal.orgId,
        partyId: dto.partyId,
        body: text,
        sender: "admin",
        createdByUserId: principal.userId,
      })
      .returning({ id: schema.clientMessage.id });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "client_portal.message_replied",
      entity: "client_message",
      entityId: row!.id,
      detail: { partyId: dto.partyId },
    });
    return { id: row!.id };
  }

  /** Manual purge for the caller's org (gated client_portal:approve). */
  async purge(tx: Db): Promise<{ purged: number }> {
    const res = await tx.execute(sql`select client_purge_expired_leads() as n`);
    return { purged: Number((res.rows[0] as { n: number }).n) };
  }

  /** Daily sweep across every org — deletes unconverted leads past expiry. */
  @Cron("0 3 * * *")
  async dailyPurge(): Promise<void> {
    try {
      const system = { orgId: "00000000-0000-0000-0000-000000000000", partyId: null, isSuperadmin: false };
      const orgRows = await this.db.withTenant(system, (tx) => tx.execute(sql`select id from reminder_org_ids()`));
      let total = 0;
      for (const r of orgRows.rows as Array<{ id: string }>) {
        const { purged } = await this.db.withTenant(
          { orgId: r.id, partyId: null, isSuperadmin: false },
          (tx) => this.purge(tx),
        );
        total += purged;
      }
      if (total > 0) this.logger.log(`expired client leads purged: ${total}`);
    } catch (e) {
      this.logger.error(`lead purge sweep failed: ${(e as Error).message}`);
    }
  }
}
