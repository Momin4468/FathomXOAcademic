import { date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { org, party } from "./a-tenancy.js";
import { workItem, workLine } from "./c-work.js";

/**
 * SCHEMA (Module 22) — HRM employee work-logging (migration 0044, audit item 12).
 * producer_work_log is a capture-first propose→confirm record: an employee logs
 * work with NO money column (the surface can never show a price); an admin converts
 * it to a priced producer work_line or rejects it. Operational state (tenant-RLS,
 * select/insert/update); employee-own scoping is server-side.
 */
export const producerWorkLog = pgTable("producer_work_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  employeePartyId: uuid("employee_party_id").notNull().references(() => party.id),
  workItemId: uuid("work_item_id").references(() => workItem.id),
  title: text("title").notNull(),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }), // hours/units — never a rate
  loggedOn: date("logged_on").notNull(),
  status: text("status").notNull().default("draft"), // draft | converted | rejected
  convertedWorkLineId: uuid("converted_work_line_id").references(() => workLine.id),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
