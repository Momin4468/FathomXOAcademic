import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext } from "./_shared.js";
import { org, party } from "./a-tenancy.js";

/**
 * SCHEMA (Module 18) — the client portal: a THIRD scoped identity plane. A
 * client_account is the client's own login (own credentials), mapped 1:1 to a
 * client party. The portal is a scoped, redacted view of business data + an
 * inbound draft path; reads go through caller-guarded definers (migration 0033),
 * not these tables directly. `lead`/`expires_at` are the seam for the future
 * public quotation funnel (a lead is promoted on job confirm; unconverted leads
 * are purged).
 */
export const clientAccount = pgTable("client_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  partyId: uuid("party_id").notNull().references(() => party.id),
  loginId: citext("login_id").notNull().unique(), // email OR a client/student id
  passwordHash: text("password_hash").notNull(),
  twofaSecret: text("twofa_secret"),
  status: text("status").notNull().default("invited"), // invited | active | lead | deactivated
  // First-login gate (0040): an auto-provisioned account must reset before a session issues.
  mustResetPassword: boolean("must_reset_password").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // set for leads
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientRefreshToken = pgTable("client_refresh_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientAccountId: uuid("client_account_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  deviceLabel: text("device_label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientMessage = pgTable("client_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  partyId: uuid("party_id").notNull().references(() => party.id), // the client's thread
  body: text("body").notNull(),
  sender: text("sender").notNull(), // client | admin
  createdByClientAccountId: uuid("created_by_client_account_id"),
  createdByUserId: uuid("created_by_user_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
