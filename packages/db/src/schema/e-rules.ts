import {
  date,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { party, role } from "./a-tenancy.js";

/** SCHEMA E — effective-dated rule on a relationship (split/commission/per-word/...). */
export const dealTerm = pgTable("deal_term", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  fromPartyId: uuid("from_party_id").references(() => party.id),
  toPartyId: uuid("to_party_id").references(() => party.id),
  appliesTo: text("applies_to").notNull().default("default"), // default | client:<id> | jobtype:<x>
  termType: text("term_type").notNull(), // split_pct|commission_pct|referral_pct|per_word|fixed
  basis: text("basis"), // referral_pct only: revenue | margin | fixed (0021); null otherwise
  value: numeric("value", { precision: 12, scale: 4 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA E — how a party/role is paid: basis + rate + cost-bearer + cadence. */
export const compRule = pgTable("comp_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  partyId: uuid("party_id").references(() => party.id),
  roleId: uuid("role_id").references(() => role.id),
  basis: text("basis").notNull(), // per_word|per_task|per_file|per_copy|commission|monthly|weekly|contractual
  rate: numeric("rate", { precision: 12, scale: 4 }),
  costBearer: text("cost_bearer").notNull(), // momin|emon|split|writer
  costBearerSplitJson: jsonb("cost_bearer_split_json"),
  cadence: text("cadence"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  // Provenance (migration 0008) — comp rules are money-defining.
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
