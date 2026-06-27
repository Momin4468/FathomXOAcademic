import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** SCHEMA B — canonical reference entity (university/course/...); fuzzy-in, canonical-out. */
export const refEntity = pgTable("ref_entity", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  kind: text("kind").notNull(), // university | course | assignment_type | referencing_style
  canonical: text("canonical").notNull(),
  parentId: uuid("parent_id"), // self-ref (course -> university)
  metaJson: jsonb("meta_json").default({}),
  status: text("status").notNull().default("provisional"), // provisional | confirmed
  confirmedBy: uuid("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  // Module 1 merge support: a merged duplicate is archived and points at the survivor.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  mergedIntoId: uuid("merged_into_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA B — every spelling that resolves to a canonical entity. */
export const refAlias = pgTable(
  "ref_alias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    refId: uuid("ref_id")
      .notNull()
      .references(() => refEntity.id),
    alias: text("alias").notNull(),
    normalized: text("normalized").notNull(),
  },
  (t) => [index("ref_alias_org_normalized_idx").on(t.orgId, t.normalized)],
);
