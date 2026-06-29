import {
  bigint,
  boolean,
  date,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** SCHEMA G — small-file storage metadata (large files are links). */
export const fileObject = pgTable("file_object", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  kind: text("kind").notNull(), // brief | solution | proof | receipt | other
  isLink: boolean("is_link").notNull().default(false),
  url: text("url"),
  filename: text("filename"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  mime: text("mime"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA G — any cost with a cost-bearer (salary/subscription/promo/loss/event). */
export const expense = pgTable("expense", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  category: text("category").notNull(), // subscription|salary|promo|loss|event|other
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  incurredAt: date("incurred_at").notNull(),
  costBearer: text("cost_bearer").notNull(), // momin|emon|split|writer
  costBearerSplitJson: jsonb("cost_bearer_split_json"),
  payeePartyId: uuid("payee_party_id"),
  campaignTag: text("campaign_tag"),
  revenueLinkId: uuid("revenue_link_id"),
  receiptFileId: uuid("receipt_file_id"),
  note: text("note"),
  // Subscription/recurring (0026): next payment date + currency (recorded, no FX);
  // last_reminded_due makes the 3-day-before email idempotent per due-date.
  nextDueDate: date("next_due_date"),
  currency: text("currency"), // BDT (default) | USD | GBP | EUR | AUD
  lastRemindedDue: date("last_reminded_due"),
  aiCaptureId: uuid("ai_capture_id"), // "added by AI" provenance marker (0030)
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** SCHEMA G — immutable audit log (append-only; no update/delete grants). */
export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid("org_id").notNull(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  detailJson: jsonb("detail_json"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
