import { integer, jsonb, pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { org } from "./a-tenancy.js";

/**
 * SCHEMA G — custom_field_def (DESIGN_SPEC §2 #10, §8). The admin-defined catalog
 * of structured fields: name, type, target entity, scope, dropdown options. Values
 * live in the target's `custom_json`, keyed by this def's `id`. The GOVERNED
 * counterpart to free-form notes. Mutable (archive, not delete).
 */
export const customFieldDef = pgTable("custom_field_def", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  targetEntity: text("target_entity").notNull(), // work_item | party | project
  fieldName: text("field_name").notNull(),
  fieldType: text("field_type").notNull(), // text | number | date | select | bool
  optionsJson: jsonb("options_json"), // select only: string[]
  scopeJson: jsonb("scope_json").notNull().default({}), // {} global, or attrs to match
  required: boolean("required").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
