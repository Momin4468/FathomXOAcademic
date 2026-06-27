# DECISIONS.md

> Append-only architectural decision log. **Append (never edit/delete) an entry whenever a foundational decision is made** (per CLAUDE.md §1). Newest at the bottom. Format: date · decision · why. This is the "why things are the way they are" record — read before changing anything structural.

---

### 2026-06 · Stack: PostgreSQL + TypeScript + NestJS + Next.js + embedded Metabase
Postgres chosen over MySQL for native row-level security, JSONB (custom fields), and ledger/analytics strength — all core requirements. TS end-to-end for one-language maintainability. Modular monolith.

### 2026-06 · Profit is derived from legs, never stored
Margins/splits/commission computed at read time from the leg chain so they stay correct as date-versioned deal terms change. No profit/margin column anywhere.

### 2026-06 · Visibility enforced at the database (RLS), not just UI
A user may read a money leg only if SuperAdmin or their party is on it. Enforced by Postgres RLS so a UI bug cannot leak a price.

### 2026-06 · Personal Finance is a separable service, linked not merged
Own identity/data/subscription; one-way income API from business payouts; business cannot read into it; deactivating a brokerage account does not disable it.

### 2026-06 · Two parallel closes per job
Work-state (draft→pending→confirmed→delivered) and money-state (unbilled→invoiced→partial→settled) are independent.

<!-- New entries below this line -->

### 2026-06-27 · Monorepo tooling: pnpm workspaces + Turborepo
TS end-to-end across `apps/{api,web}` + `packages/{db,shared}`. Boring, mainstream, well-documented (CLAUDE.md §5). pnpm installed via `npm i -g pnpm` (corepack enable failed with EPERM writing to Program Files).

### 2026-06-27 · Data layer: Drizzle ORM + hand-written raw-SQL migrations
Drizzle for typed app queries; DDL + RLS policies + grants are hand-authored SQL in `packages/db/migrations`, applied by a tiny migrator with a `schema_migrations` ledger. Chosen over Prisma because the spine is RLS/ledger-heavy (CLAUDE.md §2). The raw SQL is the source of truth; the Drizzle TS schema is a typed mirror.

### 2026-06-27 · RLS context via per-transaction session GUCs + dedicated app role
The API connects as a non-superuser, non-owner role `app_user` (so RLS binds). Each request runs in a transaction that first sets transaction-local GUCs `app.org_id` / `app.current_party_id` / `app.is_superadmin`; policies read them via `current_setting`. The reusable `withRlsTransaction()` is the single access layer. Alternative (one Postgres role per user) rejected as pooling-hostile.

### 2026-06-27 · Append-only enforced by GRANTs, not just convention
The immutable set (leg, payment, payment_allocation, payment_proof, audit_log) is granted INSERT+SELECT only to `app_user` — no UPDATE/DELETE privilege, so corrections must be reversing entries (CLAUDE.md §3.4). Invoices/rules are mutable-but-no-hard-delete (SELECT/INSERT/UPDATE). Verified by tests.

### 2026-06-27 · A–F dependency tables created early
SCHEMA A–F transitively FK to `ref_entity` (B), `milestone_template(_item)` (H, minimal), `file_object` (G); `audit_log` (G) added too since the access layer needs it. Created now following SCHEMA conventions so the first migration is self-consistent. Other G/H tables deferred.

### 2026-06-27 · Local Postgres on host port 5433
A pre-existing host Postgres occupies 5432 (caused 28P01 auth failures); the Docker container publishes to 5433 and `.env` connection strings use it. Cosmetic/local only — clean machines can use 5432.

### 2026-06-27 · API compiled with tsc (not tsx/esbuild)
NestJS DI relies on `emitDecoratorMetadata`, which esbuild/tsx do not emit. The API is built with `tsc` to ESM and run via `node dist/main.js`. Auth is currently a header stub in `rls-context.ts`, to be replaced by the real auth module.
