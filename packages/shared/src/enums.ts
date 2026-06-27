/**
 * Canonical enums for Business OS, traced to /docs/SCHEMA.md.
 * These are the single source of truth reused by API DTO validation (zod) and,
 * later, the web forms — so "validate at the boundary" happens once (CLAUDE.md §4).
 *
 * NOTE: stored as text columns in Postgres (not native enums) to keep them
 * extensible without a migration, per SCHEMA.md "roles/types are data, not code".
 */

/** party.party_type[] — a tag, not a role (SCHEMA A). */
export const PARTY_TYPES = [
  "client",
  "writer",
  "vendor",
  "referrer",
  "partner",
  "employee",
] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

/** user_account.status (SCHEMA A). */
export const USER_STATUSES = ["active", "invited", "deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** permission.action — module × action × scope (SCHEMA A, spec §4.3). */
export const PERMISSION_ACTIONS = ["view", "create", "edit", "approve"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** ref_entity.kind — canonical reference data (SCHEMA B, spec §7). */
export const REF_KINDS = [
  "university",
  "course",
  "assignment_type",
  "referencing_style",
] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** ref_entity.status — provisional until a data-steward confirms/merges (spec §7). */
export const REF_STATUSES = ["provisional", "confirmed"] as const;
export type RefStatus = (typeof REF_STATUSES)[number];

/** work_item.work_state — the WORK close (independent of money) (SCHEMA C, spec §6). */
export const WORK_STATES = ["draft", "pending", "confirmed", "delivered"] as const;
export type WorkState = (typeof WORK_STATES)[number];

/** work_item.money_state — the MONEY close (independent of work) (SCHEMA C, spec §6). */
export const MONEY_STATES = ["unbilled", "invoiced", "partial", "settled"] as const;
export type MoneyState = (typeof MONEY_STATES)[number];

/** work_line.line_kind — copies / layers / parts are one mechanism (SCHEMA C, spec §3.3). */
export const LINE_KINDS = ["copy", "rate_layer", "extra", "part"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** milestone.state (SCHEMA C). */
export const MILESTONE_STATES = ["pending", "in_progress", "done"] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];

/** project.status — engagement lifecycle (SCHEMA C, spec §5). */
export const PROJECT_STATUSES = ["active", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** deal_term.term_type — effective-dated rule on a relationship (SCHEMA E, spec §3.4). */
export const TERM_TYPES = [
  "split_pct",
  "commission_pct",
  "referral_pct",
  "per_word",
  "fixed",
] as const;
export type TermType = (typeof TERM_TYPES)[number];

/** comp_rule.basis — how a unit of work is paid (SCHEMA E, spec §3.5). */
export const COMP_BASES = [
  "per_word",
  "per_task",
  "per_file",
  "per_copy",
  "commission",
  "monthly",
  "weekly",
  "contractual",
] as const;
export type CompBasis = (typeof COMP_BASES)[number];

/**
 * cost_bearer — drives all profit deductions (SCHEMA E/G, spec §3.5).
 * Seeded values today; modeled as text so it can extend to a party ref later.
 */
export const COST_BEARERS = ["momin", "emon", "split", "writer"] as const;
export type CostBearer = (typeof COST_BEARERS)[number];

/** invoice.status — live grouping lifecycle (SCHEMA F, spec §6). */
export const INVOICE_STATUSES = ["open", "sent", "partial", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** payment.direction — in (from client) | out (to writer/vendor) (SCHEMA F, spec §6). */
export const PAYMENT_DIRECTIONS = ["in", "out"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

/** payment.medium (SCHEMA F, spec §6/§9). */
export const PAYMENT_MEDIUMS = [
  "DBBL",
  "Bank",
  "bkash",
  "Nagad",
  "Sonali",
  "cash",
] as const;
export type PaymentMedium = (typeof PAYMENT_MEDIUMS)[number];

/** payment_proof.side — proof may come from either party (SCHEMA F, spec §6). */
export const PROOF_SIDES = ["payer", "payee"] as const;
export type ProofSide = (typeof PROOF_SIDES)[number];

/** charge.category — a party→business due (Module 5, bidirectional ledger). */
export const CHARGE_CATEGORIES = ["platform_fee", "ai_check", "adjustment", "other"] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

/** expense.category — one table, many flavors (Module 6, §3.5/§8). */
export const EXPENSE_CATEGORIES = ["subscription", "salary", "promo", "loss", "event", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** task.state — capture-first board (Module 6, §8). */
export const TASK_STATES = ["open", "done", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** file_object.kind — small evidentiary files; large files are links (SCHEMA G, spec §1). */
export const FILE_KINDS = ["brief", "solution", "proof", "receipt", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * Module keys for the feature-flag registry (spec §11/§12, CLAUDE.md §2/§5).
 * Each NestJS module is gated by one of these.
 */
export const MODULES = [
  "platform", // module 0 — tenancy / identity / access / audit (always on)
  "reference", // module 1
  "work", // module 2
  "rules", // module 3
  "capture", // module 4
  "billing", // module 5
  "expenses", // module 6
] as const;
export type ModuleKey = (typeof MODULES)[number];
