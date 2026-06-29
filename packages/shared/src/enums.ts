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
  "platform_fee", // a % the party owes the business → generates a charge (§4.4)
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

/** Currency code for a subscription amount — recorded as entered, no FX (§8). */
export const CURRENCIES = ["BDT", "USD", "GBP", "EUR", "AUD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** task.state — capture-first board (Module 6, §8). */
export const TASK_STATES = ["open", "done", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** file_object.kind — small evidentiary files; large files are links (SCHEMA G, spec §1). */
export const FILE_KINDS = ["brief", "solution", "proof", "receipt", "knowledge", "cover_sheet", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** work_outcome.revision_fault — whose fault a revision was (§8, SCHEMA G). */
export const REVISION_FAULTS = ["writer", "brief_change", "client"] as const;
export type RevisionFault = (typeof REVISION_FAULTS)[number];

/** work_outcome.satisfaction — coarse client satisfaction (§8). */
export const SATISFACTION_LEVELS = ["high", "neutral", "low"] as const;
export type SatisfactionLevel = (typeof SATISFACTION_LEVELS)[number];

/** party.availability — the writer-capacity surface (§8; load is derived). */
export const AVAILABILITY_STATES = ["available", "limited", "unavailable"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

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
  "outcomes", // module 7 — per-work outcomes + derived reputation + writer capacity (§8)
  "credential_vault", // module 8 — encrypted tool/portal credentials + per-item sharing (§8)
  "knowledge", // module 9 — knowledge base (docs/prompt packs/blogs) + cover-sheet templates (§7/§8)
  "checks", // module 10 — AI/plagiarism check service mini-business (§8)
  "referrers", // module 11 — referral income as a claimant leg; referrer sees own slice (§4/§8)
  "custom_fields", // module 12 — admin-defined structured fields on records (§2 #10, §8)
  "dashboard", // module 13 — role-scoped "my numbers" + owner analytics (§8, §10)
  "personal_finance", // module 14 — the SEPARATE, sellable personal-finance plane (§11)
  "ai_capture", // module 15 — AI capture assistant: unstructured input → proposed drafts (§10/§2)
] as const;
export type ModuleKey = (typeof MODULES)[number];

/** custom_field_def.field_type (SCHEMA §G, spec §2 #10). */
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "bool"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** custom_field_def.target_entity — the records that carry a custom_json (0023). */
export const CUSTOM_FIELD_TARGETS = ["work_item", "party", "project"] as const;
export type CustomFieldTarget = (typeof CUSTOM_FIELD_TARGETS)[number];

/**
 * deal_term.basis for a referral_pct term (§4/§8). The referral agreement is a
 * SUGGESTION: revenue = % of the job's top client price, margin = % of post-writer
 * margin, fixed = a set amount (value is the amount, not a pct). An admin can
 * always override the resulting leg amount.
 */
export const REFERRAL_BASES = ["revenue", "margin", "fixed"] as const;
export type ReferralBasis = (typeof REFERRAL_BASES)[number];

/** check_batch.status — claim→confirm governance (§8). */
export const CHECK_BATCH_STATES = ["proposed", "confirmed"] as const;
export type CheckBatchState = (typeof CHECK_BATCH_STATES)[number];

/** knowledge_article.type — docs / prompt packs / blogs (§8). */
export const KNOWLEDGE_TYPES = ["doc", "prompt_pack", "blog"] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/** credential_vault_item.type — what kind of login an item holds (§8). */
export const CREDENTIAL_TYPES = ["portal", "google", "github", "aws", "tool", "other"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

// ────────────────────────────────────────────────────────────────────────────
// Personal Finance plane (§11) — a SEPARATE, independently-sellable service.
// Categories are USER-DEFINED data (these are only the kind tags + seeded defaults
// the UI suggests); enums below are the small fixed dimensions of the model.
// ────────────────────────────────────────────────────────────────────────────

/** pf_category.kind — a user-defined category is for income or expense. */
export const PF_CATEGORY_KINDS = ["income", "expense"] as const;
export type PfCategoryKind = (typeof PF_CATEGORY_KINDS)[number];

/** pf_income.source — where an income row came from (business_payout = via the one-way bridge). */
export const PF_INCOME_SOURCES = ["manual", "business_payout"] as const;
export type PfIncomeSource = (typeof PF_INCOME_SOURCES)[number];

/** pf_loan.direction — money the user GAVE out vs TOOK on. */
export const PF_LOAN_DIRECTIONS = ["given", "taken"] as const;
export type PfLoanDirection = (typeof PF_LOAN_DIRECTIONS)[number];

/** pf_loan_event.kind — movements against a loan (outstanding is derived). */
export const PF_LOAN_EVENT_KINDS = ["repayment", "disbursement", "adjustment"] as const;
export type PfLoanEventKind = (typeof PF_LOAN_EVENT_KINDS)[number];

/** pf_saving_event.kind — movements in a savings pot (balance is derived). */
export const PF_SAVING_EVENT_KINDS = ["deposit", "withdraw"] as const;
export type PfSavingEventKind = (typeof PF_SAVING_EVENT_KINDS)[number];

/** pf_target.kind — a budget cap, an income goal, or a savings target (progress derived). */
export const PF_TARGET_KINDS = ["budget_cap", "income_goal", "savings_target"] as const;
export type PfTargetKind = (typeof PF_TARGET_KINDS)[number];

/** pf_target.period — the window a target measures over. */
export const PF_TARGET_PERIODS = ["month", "year"] as const;
export type PfTargetPeriod = (typeof PF_TARGET_PERIODS)[number];

/** Seeded default categories on PF account creation (user can add/rename/archive freely). */
export const PF_DEFAULT_INCOME_CATEGORIES = ["Salary", "Freelance", "Business payout", "Gift", "Other"] as const;
export const PF_DEFAULT_EXPENSE_CATEGORIES = ["Food", "Rent", "Transport", "Bills", "Shopping", "Health", "Other"] as const;

/** pf_note.color — a small fixed palette for visual organisation of notes (§11 personal plane). */
export const NOTE_COLORS = ["default", "yellow", "green", "blue", "pink", "gray"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

// ────────────────────────────────────────────────────────────────────────────
// AI capture assistant (§10/§2) — unstructured input → PROPOSED drafts. The AI
// only proposes; a human accepts (the governance "confirm"). Nothing auto-commits.
// ────────────────────────────────────────────────────────────────────────────

/** ai_capture.kind — how the input arrived. */
export const AI_CAPTURE_KINDS = ["text", "whatsapp", "image", "voice"] as const;
export type AiCaptureKind = (typeof AI_CAPTURE_KINDS)[number];

/** ai_proposal.target_type — the kind of draft record a proposal would create. */
export const AI_PROPOSAL_TARGETS = ["client", "job", "payment", "expense"] as const;
export type AiProposalTarget = (typeof AI_PROPOSAL_TARGETS)[number];

/** ai_proposal.status — pending review → accepted (created) | rejected. */
export const AI_PROPOSAL_STATUSES = ["pending", "accepted", "rejected"] as const;
export type AiProposalStatus = (typeof AI_PROPOSAL_STATUSES)[number];
