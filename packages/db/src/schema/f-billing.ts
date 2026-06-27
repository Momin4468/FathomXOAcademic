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
import { workLine } from "./c-work.js";
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
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  note: text("note"),
});

/** SCHEMA F — a money event (in/out). Append-only ledger. */
export const payment = pgTable("payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  direction: text("direction").notNull(), // in | out
  counterpartyPartyId: uuid("counterparty_party_id").references(() => party.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paidAt: date("paid_at").notNull(),
  medium: text("medium"), // DBBL|Bank|bkash|Nagad|Sonali|cash
  trxId: text("trx_id"),
  note: text("note"),
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
