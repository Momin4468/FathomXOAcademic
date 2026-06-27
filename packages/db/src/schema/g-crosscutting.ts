import {
  bigint,
  boolean,
  jsonb,
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
