// SCHEMA — Personal Finance plane (§11, migration 0027). A SEPARATE, sellable
// service: its own identity (pf_account), its own data (pf_*), joined to the
// business only by the one-way income bridge. Tenant axis is pf_account_id (the
// PF analogue of org_id); RLS isolates every row to one account.
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { citext } from "./_shared.js";

/** The separate PF identity (tenant root). Credentials independent of user_account. */
export const pfAccount = pgTable("pf_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  twofaSecret: text("twofa_secret"),
  status: text("status").notNull().default("active"), // active | deactivated (PF-only)
  displayName: text("display_name"),
  baseCurrency: text("base_currency").notNull().default("BDT"),
  linkedPartyId: uuid("linked_party_id"), // soft link to a business party (§11)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Hashed, rotating, per-device PF refresh tokens (mirror of auth_refresh_token). */
export const pfRefreshToken = pgTable("pf_refresh_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  deviceLabel: text("device_label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** User-defined income/expense categories (not a fixed list). */
export const pfCategory = pgTable("pf_category", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  kind: text("kind").notNull(), // income | expense
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** Income entries — multi-currency, optional conversion; append-only. */
export const pfIncome = pgTable("pf_income", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  categoryId: uuid("category_id"),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BDT"),
  convertedAmount: numeric("converted_amount", { precision: 16, scale: 2 }),
  convertedCurrency: text("converted_currency"),
  occurredOn: date("occurred_on").notNull(),
  note: text("note"),
  source: text("source").notNull().default("manual"), // manual | business_payout
  sourceRef: text("source_ref"), // originating payment_allocation id (bridge idempotency)
  sourcePartyId: uuid("source_party_id"),
  reversesId: uuid("reverses_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Expense entries — multi-currency, optional conversion; append-only. */
export const pfExpense = pgTable("pf_expense", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  categoryId: uuid("category_id"),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BDT"),
  convertedAmount: numeric("converted_amount", { precision: 16, scale: 2 }),
  convertedCurrency: text("converted_currency"),
  occurredOn: date("occurred_on").notNull(),
  note: text("note"),
  reversesId: uuid("reverses_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Loans given/taken. Outstanding is derived from principal ∓ events. */
export const pfLoan = pgTable("pf_loan", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  direction: text("direction").notNull(), // given | taken
  counterpartyName: text("counterparty_name").notNull(),
  principal: numeric("principal", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BDT"),
  startedOn: date("started_on").notNull(),
  dueOn: date("due_on"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const pfLoanEvent = pgTable("pf_loan_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  loanId: uuid("loan_id").notNull(),
  kind: text("kind").notNull(), // repayment | disbursement | adjustment
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  occurredOn: date("occurred_on").notNull(),
  note: text("note"),
  reversesId: uuid("reverses_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Savings pots. Balance is derived from Σ(deposits − withdrawals). */
export const pfSaving = pgTable("pf_saving", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("BDT"),
  targetAmount: numeric("target_amount", { precision: 16, scale: 2 }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const pfSavingEvent = pgTable("pf_saving_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  savingId: uuid("saving_id").notNull(),
  kind: text("kind").notNull(), // deposit | withdraw
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  occurredOn: date("occurred_on").notNull(),
  note: text("note"),
  reversesId: uuid("reverses_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Budgets/goals. Progress is derived at read (never stored). */
export const pfTarget = pgTable("pf_target", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  kind: text("kind").notNull(), // budget_cap | income_goal | savings_target
  categoryId: uuid("category_id"),
  period: text("period").notNull(), // month | year
  periodStart: date("period_start").notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BDT"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** Subscription tracking + the 3-days-before email reminder (reuses EmailService). */
export const pfSubscription = pgTable("pf_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  name: text("name").notNull(),
  categoryId: uuid("category_id"),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BDT"),
  nextDueDate: date("next_due_date"),
  lastRemindedDue: date("last_reminded_due"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** PF-account-scoped audit (separate from the business audit_log). Append-only. */
export const pfAuditLog = pgTable("pf_audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  pfAccountId: uuid("pf_account_id").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  detailJson: jsonb("detail_json"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/** Personal notes (§11, migration 0028) — lists/reminders/free text; editable (not a ledger). */
export const pfNote = pgTable("pf_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  title: text("title"),
  body: text("body"),
  items: jsonb("items").notNull().default([]), // checklist: [{ text, done }]
  color: text("color"),
  pinned: boolean("pinned").notNull().default(false),
  remindOn: date("remind_on"),
  lastRemindedOn: date("last_reminded_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** Note attachments (file rule): metadata + a reference (storage key or external URL). */
export const pfNoteAttachment = pgTable("pf_note_attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  noteId: uuid("note_id").notNull(),
  isLink: boolean("is_link").notNull(),
  url: text("url").notNull(), // storage key (uploaded) or external URL (link)
  filename: text("filename"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  mime: text("mime"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-account PF settings (0035). One row/account; "sensible defaults, few settings". */
export const pfPreferences = pgTable("pf_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  rollupPeriod: text("rollup_period").notNull().default("month"), // week | month | custom
  rollupCustomDays: integer("rollup_custom_days").notNull().default(30),
  subscriptionLeadDays: integer("subscription_lead_days").notNull().default(3),
  reminderSubscriptions: boolean("reminder_subscriptions").notNull().default(true),
  reminderNotes: boolean("reminder_notes").notNull().default(true),
  anomalyEnabled: boolean("anomaly_enabled").notNull().default(true),
  anomalyThresholdPct: integer("anomaly_threshold_pct").notNull().default(150),
  activeCurrencies: text("active_currencies").array().notNull().default(["BDT", "USD", "GBP", "EUR", "AUD"]),
  defaultBudgetPeriod: text("default_budget_period").notNull().default("month"), // month | year
  aiQuickaddEnabled: boolean("ai_quickadd_enabled").notNull().default(true),
  prefsJson: jsonb("prefs_json"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Anomaly notices (0035) — dedup + dismissible alert log; NOT a stored balance. */
export const pfAnomalyNotice = pgTable("pf_anomaly_notice", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  kind: text("kind").notNull(), // period_total | category
  periodKey: text("period_key").notNull(),
  categoryId: uuid("category_id"),
  observed: numeric("observed", { precision: 16, scale: 2 }).notNull(),
  baseline: numeric("baseline", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BDT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
});

/** PF-scoped AI quick-add daily cap (0035) — never the business ai_usage table. */
export const pfAiUsage = pgTable("pf_ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  pfAccountId: uuid("pf_account_id").notNull(),
  day: date("day").notNull(),
  count: integer("count").notNull().default(0),
});
