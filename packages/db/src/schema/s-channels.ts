import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { party } from "./a-tenancy.js";

/**
 * SCHEMA (Module 17) — a channel is a thin config row over a party tagged
 * 'channel'. The party is what a work_item.source_party_id points at (so the
 * existing source/leg/deal-term engine treats a channel like any source); this
 * row adds the channel-specific config: its controller (null = business) and
 * medium. Created/tuned entirely from admin — a new channel needs no code change.
 * Config (not an append-only ledger): tenant-isolation RLS; update allowed.
 */
export const channel = pgTable("channel", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  partyId: uuid("party_id")
    .notNull()
    .references(() => party.id),
  controllerPartyId: uuid("controller_party_id").references(() => party.id), // null = business
  medium: text("medium").notNull(), // 'web' | 'facebook' | free text
  isActive: boolean("is_active").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
