import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { citext } from "./_shared.js";
import { refEntity } from "./b-reference.js";

/** SCHEMA A — a tenant. org_id everywhere references this. */
export const org = pgTable("org", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA A — any actor (client/writer/vendor/...). party_type is a tag, not a role. */
export const party = pgTable("party", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  displayName: text("display_name").notNull(),
  partyType: text("party_type").array().notNull().default([]),
  externalRef: text("external_ref"),
  universityId: uuid("university_id").references(() => refEntity.id),
  programme: text("programme"),
  contactJson: jsonb("contact_json").default({}),
  expertiseTags: text("expertise_tags").array().default([]),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** SCHEMA A — a login. Auth only. Linked to a party, never merged. */
export const userAccount = pgTable("user_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  twofaSecret: text("twofa_secret"),
  status: text("status").notNull().default("active"),
  partyId: uuid("party_id").references(() => party.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SCHEMA A — roles as data (not an enum). */
export const role = pgTable("role", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
});

/** SCHEMA A — role × module × action × scope. The permission engine reads these. */
export const permission = pgTable("permission", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  roleId: uuid("role_id")
    .notNull()
    .references(() => role.id),
  module: text("module").notNull(),
  action: text("action").notNull(), // view | create | edit | approve
  scopeJson: jsonb("scope_json").notNull().default({}),
});

/** SCHEMA A — a user's roles (multi-hat; may be scoped). */
export const userRole = pgTable("user_role", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => org.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => userAccount.id),
  roleId: uuid("role_id")
    .notNull()
    .references(() => role.id),
  scopeJson: jsonb("scope_json").default({}),
});
