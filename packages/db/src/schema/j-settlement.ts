import { date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { party } from "./a-tenancy.js";

/**
 * SCHEMA (settlement) — dated partner→partner transfers (Emon↔Momin), §4.4.
 * Append-only (corrections are reversing entries); leg-style party-scoped RLS so
 * a transfer is visible only to the two parties on it (or System SuperAdmin).
 * The shared profit pool / who-owes-whom is DERIVED at read time from legs +
 * these transfers (see settlement_legs() SECURITY DEFINER) — never stored.
 */
export const settlementTransfer = pgTable("settlement_transfer", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  fromPartyId: uuid("from_party_id")
    .notNull()
    .references(() => party.id),
  toPartyId: uuid("to_party_id")
    .notNull()
    .references(() => party.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  transferredAt: date("transferred_at").notNull(),
  medium: text("medium"),
  note: text("note"),
  reversesTransferId: uuid("reverses_transfer_id"),
  importBatchId: uuid("import_batch_id"), // "added by import" provenance marker (0031)
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
