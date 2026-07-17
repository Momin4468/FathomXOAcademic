import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { party, userAccount } from "./a-tenancy.js";
import { refEntity } from "./b-reference.js";
import { fileObject } from "./g-crosscutting.js";

/** SCHEMA H (minimal) — per-uni/programme milestone template. */
export const milestoneTemplate = pgTable("milestone_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  scopeRefId: uuid("scope_ref_id").references(() => refEntity.id),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const milestoneTemplateItem = pgTable("milestone_template_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => milestoneTemplate.id),
  title: text("title").notNull(),
  trackable: boolean("trackable").notNull().default(true),
  billable: boolean("billable").notNull().default(false),
  sort: integer("sort").default(0),
});

/** SCHEMA C — engagement container (thesis/course). Optional. */
export const project = pgTable("project", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  title: text("title").notNull(),
  clientPartyId: uuid("client_party_id").references(() => party.id),
  templateId: uuid("template_id").references(() => milestoneTemplate.id),
  estimateAmount: numeric("estimate_amount", { precision: 14, scale: 2 }),
  status: text("status").notNull().default("active"), // active | completed | archived
  customJson: jsonb("custom_json").default({}), // admin-defined custom fields (0023)
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedBy: uuid("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** SCHEMA C — project milestone; trackable/billable; tz-aware due. */
export const milestone = pgTable("milestone", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id),
  title: text("title").notNull(),
  trackable: boolean("trackable").notNull().default(true),
  billable: boolean("billable").notNull().default(false),
  dueAt: timestamp("due_at", { withTimezone: true }),
  dueTz: text("due_tz"),
  state: text("state").notNull().default("pending"), // pending | in_progress | done
  sort: integer("sort").default(0),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA C — the job. Producer-side anchor; two parallel closes (work/money). */
export const workItem = pgTable("work_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  projectId: uuid("project_id").references(() => project.id),
  milestoneId: uuid("milestone_id").references(() => milestone.id),
  courseRefId: uuid("course_ref_id").references(() => refEntity.id),
  assignmentTypeRefId: uuid("assignment_type_ref_id").references(() => refEntity.id),
  title: text("title").notNull(),
  details: text("details"),
  sourcePartyId: uuid("source_party_id").references(() => party.id),
  // The paying student — DISTINCT from source_party_id (the referral/source that
  // drives profit-share). A direct job may set both to the same party (0048).
  clientPartyId: uuid("client_party_id").references(() => party.id),
  doerPartyId: uuid("doer_party_id").references(() => party.id),
  // The owning admin (book of business) — drives row privacy (0051). A non-owner
  // admin sees this job only if they are on it (source/doer/client) or granted.
  ownerPartyId: uuid("owner_party_id").references(() => party.id),
  assignerUserId: uuid("assigner_user_id").references(() => userAccount.id),
  // §3.1 academic capture (0048).
  universityRefId: uuid("university_ref_id").references(() => refEntity.id),
  moduleName: text("module_name"),
  groupKind: text("group_kind").notNull().default("individual"), // individual | group
  groupScope: text("group_scope"), // full | partial (when group)
  groupNote: text("group_note"),
  deliveryDate: text("delivery_date"), // date (yyyy-mm-dd)
  submissionDate: text("submission_date"),
  wordCount: integer("word_count"),
  workState: text("work_state").notNull().default("draft"), // draft|pending|confirmed|delivered
  moneyState: text("money_state").notNull().default("unbilled"), // unbilled|invoiced|partial|settled
  // Child flags within a project (trackable / billable / both); §5.
  trackable: boolean("trackable").notNull().default(true),
  billable: boolean("billable").notNull().default(false),
  isEstimate: boolean("is_estimate").notNull().default(false),
  customJson: jsonb("custom_json").default({}),
  briefFileId: uuid("brief_file_id").references(() => fileObject.id),
  notes: text("notes"),
  aiCaptureId: uuid("ai_capture_id"), // "added by AI" provenance marker (0030)
  importBatchId: uuid("import_batch_id"), // "added by import" provenance marker (0031)
  clientAccountId: uuid("client_account_id"), // "submitted by client portal" provenance marker (0033)
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedBy: uuid("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/**
 * SCHEMA C — component of a work item: copy | rate_layer | extra | part.
 * Line amounts are COMPUTED (rate×count or fixed); never store profit (SCHEMA §I).
 */
export const workLine = pgTable("work_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  workItemId: uuid("work_item_id")
    .notNull()
    .references(() => workItem.id),
  lineKind: text("line_kind").notNull(), // copy | rate_layer | extra | part
  // Per-line lifecycle (0048); job status is a rollup of these. draft|pending|
  // submitted|billed|cancelled. 'billed' is set when the line is invoiced.
  lineStatus: text("line_status").notNull().default("pending"),
  consumerPartyId: uuid("consumer_party_id").references(() => party.id),
  writerPartyId: uuid("writer_party_id").references(() => party.id),
  wordCount: integer("word_count"),
  unitCount: integer("unit_count").default(1),
  unitLabel: text("unit_label"), // words | slides | pages | weight% | copies (0050)
  clientRate: numeric("client_rate", { precision: 10, scale: 4 }),
  writerRate: numeric("writer_rate", { precision: 10, scale: 4 }),
  fixedAmount: numeric("fixed_amount", { precision: 14, scale: 2 }),
  // Copy fan-out: a consumer line points back to the one producer line it came from.
  sourceLineId: uuid("source_line_id"),
  // Ad-hoc bulk pricing (0039): N consumer lines share a group; the anchor carries
  // the combined amount, siblings sit at ৳0 tagged with the group.
  priceGroupId: uuid("price_group_id"),
  note: text("note"),
});

/** SCHEMA C (0039) — an ad-hoc bulk-price container: N tasks, one combined sum. */
export const priceGroup = pgTable("price_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  clientPartyId: uuid("client_party_id").references(() => party.id),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
