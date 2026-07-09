import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
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
  availability: text("availability").notNull().default("available"), // available | limited | unavailable
  maxConcurrent: integer("max_concurrent"), // optional capacity; load is derived
  notes: text("notes"),
  referredByPartyId: uuid("referred_by_party_id"), // directory "referred-by" (self-ref)
  customJson: jsonb("custom_json").default({}), // admin-defined custom fields (0023)
  aiCaptureId: uuid("ai_capture_id"), // "added by AI" provenance marker (0030)
  importBatchId: uuid("import_batch_id"), // "added by import" provenance marker (0031)
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
  description: text("description"), // human note shown in the Roles admin (0045)
  isSystem: boolean("is_system").notNull().default(false),
});

/** SCHEMA A — role × module × action × scope. The permission engine reads these. */
export const permission = pgTable(
  "permission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => org.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id),
    module: text("module").notNull(),
    action: text("action").notNull(), // view | create | edit | approve | delete | export
    scopeJson: jsonb("scope_json").notNull().default({}),
  },
  // Idempotent grant/revoke: one row per (org, role, module, action) (0045).
  (t) => ({ uniq: unique("permission_role_module_action_uniq").on(t.orgId, t.roleId, t.module, t.action) }),
);

/** SCHEMA A — a user's roles (multi-hat; may be scoped). */
export const userRole = pgTable(
  "user_role",
  {
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
  },
  // A user holds a given role at most once (0045).
  (t) => ({ uniq: unique("user_role_user_role_uniq").on(t.orgId, t.userId, t.roleId) }),
);
