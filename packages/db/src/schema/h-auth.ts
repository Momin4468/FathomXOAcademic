import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org, userAccount } from "./a-tenancy.js";

/**
 * Refresh tokens (migration 0003). Stores the sha256 of the opaque refresh JWT
 * so sessions are revocable; one row per device; sliding 10-day expiry re-set on
 * every use. See /docs/DECISIONS.md (Module 0 auth).
 */
export const authRefreshToken = pgTable("auth_refresh_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => userAccount.id),
  tokenHash: text("token_hash").notNull(),
  deviceLabel: text("device_label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
