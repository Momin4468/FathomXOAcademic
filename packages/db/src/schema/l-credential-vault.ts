import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org, party } from "./a-tenancy.js";

/**
 * Credential vault (§8, CLAUDE.md §4). The secret bundle
 * ({username,password,2FA-recovery,notes}) is AES-256-GCM encrypted by the app
 * before insert — the DB holds only ciphertext + iv + tag (never plaintext).
 * Per-item sharing via credential_share; RLS shows an item only to active
 * holders. Mutable-but-undeletable (archive via archived_at).
 */
export const credentialVaultItem = pgTable("credential_vault_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // portal | google | github | aws | tool | other
  url: text("url"),
  clientPartyId: uuid("client_party_id").references(() => party.id),
  secretIv: text("secret_iv").notNull(),
  secretTag: text("secret_tag").notNull(),
  secretCiphertext: text("secret_ciphertext").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** Per-item ACL: a grant of one credential to one party (revocable). */
export const credentialShare = pgTable("credential_share", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  credentialId: uuid("credential_id")
    .notNull()
    .references(() => credentialVaultItem.id),
  partyId: uuid("party_id")
    .notNull()
    .references(() => party.id),
  grantedBy: uuid("granted_by"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedBy: uuid("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
