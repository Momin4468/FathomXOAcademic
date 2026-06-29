// SCHEMA — AI capture assistant (§10/§2, migration 0030). The AI proposes draft
// records; a human accepts (the governance confirm). Extraction writes only
// ai_proposal rows — never a domain record.
import {
  bigint,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** One capture submission/batch (text / WhatsApp / image / voice). */
export const aiCapture = pgTable("ai_capture", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  kind: text("kind").notNull(), // text | whatsapp | image | voice
  inputText: text("input_text"),
  fileObjectId: uuid("file_object_id"),
  provider: text("provider").notNull(),
  model: text("model"),
  status: text("status").notNull().default("processing"), // processing | proposed | applied | discarded
  usageTokens: integer("usage_tokens").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An extracted candidate draft record (never a fact until a human accepts). */
export const aiProposal = pgTable("ai_proposal", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  captureId: uuid("capture_id").notNull(),
  targetType: text("target_type").notNull(), // client | job | payment | expense
  proposedJson: jsonb("proposed_json").notNull().default({}),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  label: text("label"),
  status: text("status").notNull().default("pending"), // pending | accepted | rejected
  createdEntityType: text("created_entity_type"),
  createdEntityId: uuid("created_entity_id"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only per-user usage ledger — the daily cap is counted from this. */
export const aiUsage = pgTable("ai_usage", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid("org_id").notNull(),
  userId: uuid("user_id"),
  usedOn: date("used_on").notNull().defaultNow(),
  provider: text("provider").notNull(),
  tokens: integer("tokens").notNull().default(0),
  captureId: uuid("capture_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
