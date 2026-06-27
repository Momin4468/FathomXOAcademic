import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { party, userAccount } from "./a-tenancy.js";
import { workItem } from "./c-work.js";

/**
 * Task & reminder board (Module 6, DESIGN_SPEC §8). Timezone-aware deadlines:
 * due_at is the absolute moment (UTC); due_tz is the IANA zone it was set in,
 * kept so the deadline can be shown in its original zone. Urgency ("time left")
 * is derived from due_at, never stored.
 */
export const task = pgTable("task", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  title: text("title").notNull(),
  details: text("details"),
  state: text("state").notNull().default("open"), // open | done | cancelled
  dueAt: timestamp("due_at", { withTimezone: true }),
  dueTz: text("due_tz"),
  assigneePartyId: uuid("assignee_party_id").references(() => party.id),
  assigneeUserId: uuid("assignee_user_id").references(() => userAccount.id),
  workItemId: uuid("work_item_id").references(() => workItem.id),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
