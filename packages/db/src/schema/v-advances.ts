import { date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org, party } from "./a-tenancy.js";

/**
 * SCHEMA (Module 20) — business-plane loan/advance ledger (migration 0042,
 * BUSINESS_MODEL_AUDIT P1 item 11). Advances/loans to writers, vendors, or any
 * named party. The OUTSTANDING balance is DERIVED at read (principal ∓ Σ events),
 * never stored; events are append-only (a correction is a reversing event). Kept
 * DISJOINT from the leg/settlement money math — surfaced next to a party's balance.
 */
export const advance = pgTable("advance", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  counterpartyPartyId: uuid("counterparty_party_id").notNull().references(() => party.id),
  direction: text("direction").notNull(), // given | taken
  principal: numeric("principal", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BDT"),
  startedOn: date("started_on").notNull(),
  dueOn: date("due_on"),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const advanceEvent = pgTable("advance_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  advanceId: uuid("advance_id").notNull().references(() => advance.id),
  kind: text("kind").notNull(), // disbursement | repayment | adjustment
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  occurredOn: date("occurred_on").notNull(),
  note: text("note"),
  reversesId: uuid("reverses_id"), // self-FK enforced in SQL (0042); omitted here to avoid circular type
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
