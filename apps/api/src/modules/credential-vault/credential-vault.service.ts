import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { EncryptionService } from "../../common/crypto/encryption.service.js";
import { TotpService } from "../../common/auth/totp.service.js";
import type { CreateCredentialDto, GrantShareDto, RevealDto, UpdateCredentialDto } from "./dto.js";

export interface SecretBundle {
  username?: string;
  password?: string;
  totpRecovery?: string;
  notes?: string;
}

/** Item metadata returned by list/get — NEVER the secret. */
const ITEM_META = {
  id: schema.credentialVaultItem.id,
  name: schema.credentialVaultItem.name,
  type: schema.credentialVaultItem.type,
  url: schema.credentialVaultItem.url,
  clientPartyId: schema.credentialVaultItem.clientPartyId,
  createdAt: schema.credentialVaultItem.createdAt,
} as const;

/**
 * Credential vault (§8, CLAUDE.md §4). The secret bundle is AES-256-GCM
 * encrypted before insert (never plaintext in DB or logs). Per-item ACL is
 * RLS-enforced (holders only); admin management uses the SECURITY DEFINER
 * functions. Reveal is holder-only + a mandatory current-TOTP step-up, and
 * every reveal (allowed or denied) is audited.
 */
@Injectable()
export class CredentialVaultService {
  constructor(
    private readonly audit: AuditService,
    private readonly crypto: EncryptionService,
    private readonly totp: TotpService,
  ) {}

  private encryptBundle(b: SecretBundle) {
    const enc = this.crypto.encrypt(JSON.stringify(b));
    return { secretIv: enc.iv, secretTag: enc.tag, secretCiphertext: enc.ciphertext };
  }

  async createItem(tx: Db, principal: SessionPrincipal, dto: CreateCredentialDto) {
    const bundle: SecretBundle = {
      username: dto.username,
      password: dto.password,
      totpRecovery: dto.totpRecovery,
      notes: dto.notes,
    };
    const id = randomUUID();
    // No RETURNING: the creator isn't yet a holder, so RLS would hide the row.
    await tx.insert(schema.credentialVaultItem).values({
      id,
      orgId: principal.orgId,
      name: dto.name.trim(),
      type: dto.type,
      url: dto.url ?? null,
      clientPartyId: dto.clientPartyId ?? null,
      ...this.encryptBundle(bundle),
      createdBy: principal.userId,
      updatedBy: principal.userId,
    });
    // Auto-grant the creator a share so they become a holder (can edit/reveal).
    if (principal.partyId) {
      await tx.insert(schema.credentialShare).values({
        id: randomUUID(),
        orgId: principal.orgId,
        credentialId: id,
        partyId: principal.partyId,
        grantedBy: principal.userId,
      });
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "vault.item_created",
      entity: "credential_vault_item",
      entityId: id,
      detail: { name: dto.name, type: dto.type, clientPartyId: dto.clientPartyId ?? null },
    });
    return { id };
  }

  /** Items the caller holds (RLS-scoped) — metadata only, never the secret. */
  listMine(tx: Db) {
    return tx
      .select(ITEM_META)
      .from(schema.credentialVaultItem)
      .where(isNull(schema.credentialVaultItem.archivedAt))
      .orderBy(asc(schema.credentialVaultItem.name));
  }

  /** Reveal the decrypted secret — holder-only (RLS) + mandatory TOTP step-up. */
  async reveal(tx: Db, principal: SessionPrincipal, id: string, dto: RevealDto) {
    // RLS returns the row only if the caller holds an active share (or superadmin).
    const [item] = await tx
      .select()
      .from(schema.credentialVaultItem)
      .where(and(eq(schema.credentialVaultItem.id, id), isNull(schema.credentialVaultItem.archivedAt)));
    if (!item) throw new NotFoundException("Credential not found"); // non-holder ⇒ zero rows

    // 2FA-gated: the caller must have 2FA enrolled and present a valid current code.
    const [user] = await tx
      .select({ twofaSecret: schema.userAccount.twofaSecret })
      .from(schema.userAccount)
      .where(eq(schema.userAccount.id, principal.userId));
    if (!user?.twofaSecret) {
      throw new ForbiddenException("Enrol 2FA to access the vault");
    }
    if (!this.totp.verify(dto.totp, user.twofaSecret)) {
      await this.audit.record(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "vault.reveal_denied",
        entity: "credential_vault_item",
        entityId: id,
        detail: { reason: "bad_totp" },
      });
      throw new UnauthorizedException("Invalid 2FA code");
    }

    const bundle = JSON.parse(
      this.crypto.decrypt({ iv: item.secretIv, tag: item.secretTag, ciphertext: item.secretCiphertext }),
    ) as SecretBundle;

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "vault.secret_revealed",
      entity: "credential_vault_item",
      entityId: id,
      detail: { type: item.type }, // NEVER the secret
    });

    return {
      id: item.id,
      name: item.name,
      type: item.type,
      url: item.url,
      clientPartyId: item.clientPartyId,
      secret: bundle,
    };
  }

  /** Edit metadata and/or rotate the secret (holder-only via RLS). */
  async editItem(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateCredentialDto) {
    const [item] = await tx
      .select()
      .from(schema.credentialVaultItem)
      .where(and(eq(schema.credentialVaultItem.id, id), isNull(schema.credentialVaultItem.archivedAt)));
    if (!item) throw new NotFoundException("Credential not found");

    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.url !== undefined) patch.url = dto.url;
    if (dto.clientPartyId !== undefined) patch.clientPartyId = dto.clientPartyId;

    // Any secret field present ⇒ re-encrypt the full bundle (merge over current).
    const rotates =
      dto.username !== undefined ||
      dto.password !== undefined ||
      dto.totpRecovery !== undefined ||
      dto.notes !== undefined;
    if (rotates) {
      const current = JSON.parse(
        this.crypto.decrypt({ iv: item.secretIv, tag: item.secretTag, ciphertext: item.secretCiphertext }),
      ) as SecretBundle;
      const next: SecretBundle = {
        username: dto.username ?? current.username,
        password: dto.password ?? current.password,
        totpRecovery: dto.totpRecovery ?? current.totpRecovery,
        notes: dto.notes ?? current.notes,
      };
      Object.assign(patch, this.encryptBundle(next));
    }

    await tx.update(schema.credentialVaultItem).set(patch).where(eq(schema.credentialVaultItem.id, id));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "vault.item_updated",
      entity: "credential_vault_item",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt", "secretIv", "secretTag", "secretCiphertext"].includes(k)), rotated: rotates },
    });
    return { id };
  }

  // ── manager path (SECURITY DEFINER; endpoints gated credential_vault:approve) ──

  async manageList(tx: Db) {
    const res = await tx.execute(sql`
      select id, name, type, url, client_party_id as "clientPartyId", created_at as "createdAt", share_count as "shareCount"
      from vault_manage_list()
    `);
    return res.rows;
  }

  async manageShares(tx: Db, itemId: string) {
    const res = await tx.execute(sql`
      select party_id as "partyId", granted_at as "grantedAt", granted_by as "grantedBy"
      from vault_manage_shares(${itemId})
    `);
    return res.rows;
  }

  async grant(tx: Db, principal: SessionPrincipal, itemId: string, dto: GrantShareDto) {
    // Confirm the item is in this org (manager list is the definer, org-filtered).
    const items = (await this.manageList(tx)) as Array<{ id: string }>;
    if (!items.some((i) => i.id === itemId)) throw new NotFoundException("Credential not found");
    // Confirm the grantee party belongs to this org (party is tenant-RLS, so a
    // foreign party returns zero rows) — don't store a cross-org share.
    const [pty] = await tx
      .select({ id: schema.party.id })
      .from(schema.party)
      .where(eq(schema.party.id, dto.partyId));
    if (!pty) throw new NotFoundException("Party not found");

    const id = randomUUID();
    try {
      await tx.insert(schema.credentialShare).values({
        id,
        orgId: principal.orgId,
        credentialId: itemId,
        partyId: dto.partyId,
        grantedBy: principal.userId,
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictException("That party already has an active share for this credential");
      }
      throw err;
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "vault.share_granted",
      entity: "credential_vault_item",
      entityId: itemId,
      detail: { partyId: dto.partyId },
    });
    return { id };
  }

  async revoke(tx: Db, principal: SessionPrincipal, shareId: string) {
    const res = await tx.execute(sql`
      select credential_id as "credentialId", party_id as "partyId"
      from vault_revoke_share(${shareId}, ${principal.userId})
    `);
    const row = res.rows[0] as { credentialId: string; partyId: string } | undefined;
    if (!row) throw new NotFoundException("Active share not found");
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "vault.share_revoked",
      entity: "credential_vault_item",
      entityId: row.credentialId,
      detail: { partyId: row.partyId, shareId },
    });
    return { ok: true };
  }
}
