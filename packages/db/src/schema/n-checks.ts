import { boolean, date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org, party } from "./a-tenancy.js";
import { workItem } from "./c-work.js";
import { fileObject } from "./g-crosscutting.js";
import { credentialVaultItem } from "./l-credential-vault.js";

/** SCHEMA (checks) — a WhatsApp account/line run by a check employee (§8). */
export const checkChannel = pgTable("check_channel", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  label: text("label").notNull(),
  employeePartyId: uuid("employee_party_id").notNull().references(() => party.id),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** SCHEMA (checks) — a checking tool account (AcademyCX); login lives in the vault. */
export const checkToolAccount = pgTable("check_tool_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  label: text("label").notNull(),
  vaultItemId: uuid("vault_item_id").references(() => credentialVaultItem.id),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** SCHEMA (checks) — append-only credit purchases (the cost basis). */
export const checkCreditTopup = pgTable("check_credit_topup", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  toolAccountId: uuid("tool_account_id").notNull().references(() => checkToolAccount.id),
  credits: numeric("credits", { precision: 12, scale: 2 }).notNull(),
  cost: numeric("cost", { precision: 14, scale: 2 }).notNull(),
  purchasedAt: date("purchased_at").notNull(),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA (checks) — the tally: per (employee, account, day). proposed→confirmed. */
export const checkBatch = pgTable("check_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  channelId: uuid("channel_id").notNull().references(() => checkChannel.id),
  toolAccountId: uuid("tool_account_id").references(() => checkToolAccount.id),
  periodDate: date("period_date").notNull(),
  filesChecked: integer("files_checked").notNull().default(0),
  filesPaid: integer("files_paid").notNull().default(0),
  amountCollected: numeric("amount_collected", { precision: 14, scale: 2 }).notNull().default("0"),
  customerPartyId: uuid("customer_party_id").references(() => party.id),
  workItemId: uuid("work_item_id").references(() => workItem.id),
  status: text("status").notNull().default("proposed"), // proposed | confirmed
  note: text("note"),
  recordedBy: uuid("recorded_by"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedBy: uuid("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** SCHEMA (checks) — optional per-file detail (the file + AI/plagiarism score). */
export const checkFile = pgTable("check_file", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  batchId: uuid("batch_id").notNull().references(() => checkBatch.id),
  fileObjectId: uuid("file_object_id").references(() => fileObject.id),
  customerRef: text("customer_ref"),
  aiScore: numeric("ai_score", { precision: 5, scale: 2 }),
  plagiarismScore: numeric("plagiarism_score", { precision: 5, scale: 2 }),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
