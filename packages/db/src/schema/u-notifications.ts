import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org, userAccount } from "./a-tenancy.js";

/**
 * SCHEMA (Module 19) — in-app notifications + admin broadcast (migration 0041,
 * BUSINESS_MODEL_AUDIT P1 item 7). Per-USER operational state (read/unread), NOT
 * the money ledger: tenant-isolation RLS with select/insert/update grants (mark-read
 * is an UPDATE), like `task`. A broadcast fans out to N `notification` rows in one tx.
 */
export const notificationBroadcast = pgTable("notification_broadcast", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  audienceKind: text("audience_kind").notNull(), // all | role | users
  audienceJson: jsonb("audience_json"), // role_id (role) or user_id[] (users)
  title: text("title").notNull(),
  body: text("body"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  recipientUserId: uuid("recipient_user_id").notNull().references(() => userAccount.id),
  kind: text("kind").notNull().default("info"), // info | broadcast | <event kinds later>
  title: text("title").notNull(),
  body: text("body"),
  readAt: timestamp("read_at", { withTimezone: true }), // null = unread
  broadcastId: uuid("broadcast_id").references(() => notificationBroadcast.id),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
