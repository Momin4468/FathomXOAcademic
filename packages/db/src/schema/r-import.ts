// SCHEMA — Import / Export / Archive (§ import module, migration 0031). Import
// stages rows then commits through the existing create services; archive stores
// dated business files reusing the file pipeline.
import { date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const importBatch = pgTable("import_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  entityType: text("entity_type").notNull(), // clients | jobs | payments | settlement_opening
  filename: text("filename"),
  status: text("status").notNull().default("preview"), // preview | committed | discarded
  rowTotal: integer("row_total").notNull().default(0),
  validCount: integer("valid_count").notNull().default(0),
  invalidCount: integer("invalid_count").notNull().default(0),
  committedCount: integer("committed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importRow = pgTable("import_row", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  rawJson: jsonb("raw_json").notNull().default({}),
  mappedJson: jsonb("mapped_json").notNull().default({}),
  status: text("status").notNull().default("valid"), // valid | invalid | committed | failed
  errorsJson: jsonb("errors_json"),
  resolutionJson: jsonb("resolution_json"),
  createdEntityType: text("created_entity_type"),
  createdEntityId: uuid("created_entity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const archiveItem = pgTable("archive_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  docDate: date("doc_date"),
  tags: text("tags").array().notNull().default([]),
  fileObjectId: uuid("file_object_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
