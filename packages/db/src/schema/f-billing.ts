import {
  boolean,
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { party } from "./a-tenancy.js";
import { workItem, workLine } from "./c-work.js";
import { dealTerm } from "./e-rules.js";
import { fileObject } from "./g-crosscutting.js";

/** SCHEMA F — a live grouping of billable lines for a client. */
export const invoice = pgTable("invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  clientPartyId: uuid("client_party_id")
    .notNull()
    .references(() => party.id),
  status: text("status").notNull().default("open"), // open|sent|partial|paid|void
  isEstimate: boolean("is_estimate").notNull().default(false),
  supersedesInvoiceId: uuid("supersedes_invoice_id"),
  issuedAt: date("issued_at"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA F — a billable work_line placed on an invoice (its own record). */
export const invoiceLine = pgTable("invoice_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoice.id),
  workLineId: uuid("work_line_id")
    .notNull()
    .references(() => workLine.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  // NOTE: the physical `paid_amount` column is DERIVE-ONLY (deprecated) and is
  // intentionally NOT mapped here — paid/due are summed from payment_allocation
  // at read time (SCHEMA §I, migration 0013). Do not add it back.
  note: text("note"),
});

/** SCHEMA F — a money event (in/out). Append-only ledger. */
export const payment = pgTable("payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  direction: text("direction").notNull(), // in | out
  counterpartyPartyId: uuid("counterparty_party_id").references(() => party.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // BDT (the ledger currency)
  paidAt: date("paid_at").notNull(),
  medium: text("medium"), // DBBL|Bank|bkash|Nagad|Sonali|cash|MTB|USDT
  // Multi-currency provenance (0037): amount stays BDT; these capture the foreign
  // original + rate. original_currency defaults BDT (a plain BDT payment).
  originalCurrency: text("original_currency").notNull().default("BDT"),
  originalAmount: numeric("original_amount", { precision: 16, scale: 2 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 6 }),
  trxId: text("trx_id"),
  note: text("note"),
  reversesPaymentId: uuid("reverses_payment_id"), // correction link (no double-reverse)
  aiCaptureId: uuid("ai_capture_id"), // "added by AI" provenance marker (0030)
  importBatchId: uuid("import_batch_id"), // "added by import" provenance marker (0031)
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA F — links a payment to invoice_lines (client) or a writer (aggregate). */
export const paymentAllocation = pgTable("payment_allocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payment.id),
  invoiceLineId: uuid("invoice_line_id").references(() => invoiceLine.id),
  writerPartyId: uuid("writer_party_id").references(() => party.id),
  chargeId: uuid("charge_id").references(() => charge.id), // settles a party→business charge
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
});

/** SCHEMA F — proof attachments per payment, tagged side (payer/payee). */
export const paymentProof = pgTable("payment_proof", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payment.id),
  fileObjectId: uuid("file_object_id")
    .notNull()
    .references(() => fileObject.id),
  side: text("side").notNull(), // payer | payee
  attachedBy: uuid("attached_by").notNull(),
  attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * SCHEMA (Module 5) — a charge a party OWES the business (platform fee, AI-check
 * fee, …). Bidirectional ledger: legs carry business→party earnings; `charge`
 * carries party→business dues. Append-only; corrections are reversing entries
 * (negative amount + reverses_charge_id). Party-scoped RLS (a party sees only
 * their own dues). Settled via payment_allocation.charge_id.
 */
export const charge = pgTable("charge", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  partyId: uuid("party_id")
    .notNull()
    .references(() => party.id),
  workItemId: uuid("work_item_id").references(() => workItem.id),
  dealTermId: uuid("deal_term_id").references(() => dealTerm.id),
  category: text("category").notNull(), // platform_fee | writer_commission | ai_check | adjustment | other
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason"),
  reversesChargeId: uuid("reverses_charge_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * SCHEMA (0037) — business "other income" that is NOT a client→writer leg (e.g.
 * the govt 2.5%/1000-BDT FX incentive). Append-only; STRUCTURALLY DISJOINT from
 * payment_allocation / invoice_line so it can never net against a client's dues.
 * `amount` is BDT; original_currency/original_amount/fx_rate capture the foreign
 * source. Corrections are reversing rows (reverses_income_id).
 */
export const otherIncome = pgTable("other_income", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // BDT
  originalCurrency: text("original_currency").notNull().default("BDT"),
  originalAmount: numeric("original_amount", { precision: 16, scale: 2 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 6 }),
  category: text("category").notNull(), // govt_fx_incentive | other
  occurredOn: date("occurred_on").notNull(),
  sourcePaymentId: uuid("source_payment_id").references(() => payment.id),
  note: text("note"),
  reversesIncomeId: uuid("reverses_income_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
