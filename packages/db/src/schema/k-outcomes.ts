import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workItem } from "./c-work.js";

/**
 * SCHEMA G — per finished work outcome (§8). One row per work_item (unique).
 * Entered by an authorized role (the outcomes module), NEVER self-reported by
 * the writer. Reputation is DERIVED from these rows at read time (see
 * packages/shared/src/reputation.ts) — never a stored score. Mutable (corrections
 * are edits, audited) but not deletable.
 */
export const workOutcome = pgTable("work_outcome", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  workItemId: uuid("work_item_id")
    .notNull()
    .references(() => workItem.id),
  onTime: boolean("on_time"),
  daysLate: integer("days_late"),
  revisionCount: integer("revision_count").notNull().default(0),
  revisionFault: text("revision_fault"), // writer | brief_change | client
  grade: text("grade"),
  markerFeedback: text("marker_feedback"),
  complaint: boolean("complaint").notNull().default(false),
  complaintReason: text("complaint_reason"),
  failed: boolean("failed").notNull().default(false),
  aiScore: numeric("ai_score", { precision: 5, scale: 2 }),
  satisfaction: text("satisfaction"), // high | neutral | low
  reworkCost: numeric("rework_cost", { precision: 14, scale: 2 }),
  disputed: boolean("disputed").notNull().default(false),
  recordedBy: uuid("recorded_by"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
