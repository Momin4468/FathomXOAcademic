import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { party } from "./a-tenancy.js";
import { workItem, workLine } from "./c-work.js";
import { dealTerm } from "./e-rules.js";

/**
 * SCHEMA D — one link in a work item's money chain: from_party -> to_party.
 * The heart of the opacity model. Append-only. RLS (0001_rls.sql) restricts
 * SELECT to SuperAdmin or a party on the leg. Margin = inbound − outbound,
 * COMPUTED at read time, never stored (SCHEMA §I).
 */
export const leg = pgTable("leg", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  workItemId: uuid("work_item_id")
    .notNull()
    .references(() => workItem.id),
  workLineId: uuid("work_line_id").references(() => workLine.id),
  seq: integer("seq").notNull(), // 1 = client->top, ..., n = ->writer
  fromPartyId: uuid("from_party_id").references(() => party.id),
  toPartyId: uuid("to_party_id").references(() => party.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  dealTermId: uuid("deal_term_id").references(() => dealTerm.id),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
