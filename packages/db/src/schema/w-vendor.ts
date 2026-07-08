import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org, party } from "./a-tenancy.js";
import { workItem } from "./c-work.js";

/**
 * SCHEMA (Module 21) — vendor self-service invoicing (migration 0043, audit item
 * 13). A vendor_claim is a propose→confirm governance record: a vendor submits a
 * proposed invoice, an admin approves/rejects. Operational state (tenant-RLS,
 * select/insert/update) — NOT the money ledger; the actual business→vendor leg is
 * posted by the admin in the job flow (chain context).
 */
export const vendorClaim = pgTable("vendor_claim", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  vendorPartyId: uuid("vendor_party_id").notNull().references(() => party.id),
  workItemId: uuid("work_item_id").references(() => workItem.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
  status: text("status").notNull().default("proposed"), // proposed | approved | rejected
  createdBy: uuid("created_by"),
  decidedBy: uuid("decided_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});
