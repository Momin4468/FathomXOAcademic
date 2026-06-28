import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org } from "./a-tenancy.js";
import { refEntity } from "./b-reference.js";
import { fileObject } from "./g-crosscutting.js";

/** SCHEMA (knowledge) — docs / prompt packs / blogs; open authoring (§8). */
export const knowledgeArticle = pgTable("knowledge_article", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  type: text("type").notNull(), // doc | prompt_pack | blog
  title: text("title").notNull(),
  body: text("body"),
  universityRefId: uuid("university_ref_id").references(() => refEntity.id),
  programmeRefId: uuid("programme_ref_id").references(() => refEntity.id),
  status: text("status").notNull().default("published"), // draft | published
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** SCHEMA (knowledge) — article ↔ file_object (media under the file rule). */
export const knowledgeAttachment = pgTable("knowledge_attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  articleId: uuid("article_id")
    .notNull()
    .references(() => knowledgeArticle.id),
  fileObjectId: uuid("file_object_id")
    .notNull()
    .references(() => fileObject.id),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA (knowledge) — a university/programme cover sheet = ref data + a file. */
export const coverSheetTemplate = pgTable("cover_sheet_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  name: text("name").notNull(),
  universityRefId: uuid("university_ref_id").references(() => refEntity.id),
  programmeRefId: uuid("programme_ref_id").references(() => refEntity.id),
  fileObjectId: uuid("file_object_id").references(() => fileObject.id),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
