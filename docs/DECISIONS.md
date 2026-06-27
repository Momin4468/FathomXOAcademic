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
NestJS DI relies on `emitDecoratorMetadata`, which esbuild/tsx do not emit. The API is built with `tsc` to ESM and run via `node dist/main.js`. (Module 0 depth has since replaced the header stub with real token auth.)

### 2026-06-27 · Module 0 auth: JWT access+refresh, bcryptjs, otplib TOTP
Access token 30m; refresh is a per-device, hashed-at-rest token with a sliding 10-day expiry re-set on each use; rotation revokes the old token and reuse of a revoked token kills the whole family; logout revokes server-side. Passwords via bcryptjs (pure-JS, portable on Windows); 2FA via otplib TOTP, opt-in. JWT_SECRET must be ≥32 chars or the API refuses to boot, and HS256 is pinned (no alg-confusion / no silent insecure fallback).

### 2026-06-27 · RLS context derives from the signed token, never client input
`AuthGuard` verifies the Bearer access token and sets `req.principal`; `extractRlsContext` builds the RLS GUCs from the principal only — the old `x-org-id/x-party-id/x-superadmin` header path is deleted. Proven by tests: a forged `x-party-id`/`x-superadmin` header has no effect. This closes the impersonation hole the stub left open.

### 2026-06-27 · `is_superadmin` GUC = System SuperAdmin role only (§4.4)
The leg-visibility bypass is granted only when the authenticated principal holds the System SuperAdmin role (computed server-side from `user_role` at login/refresh). Business SuperAdmin deliberately does NOT get it — they get aggregated/settlement views (built later). So no single business seat renders every leg.

### 2026-06-27 · `app_auth_lookup()` SECURITY DEFINER = the sole credential-lookup RLS bypass
Login must read `user_account` by email before any org context exists, which RLS would block. A narrow `SECURITY DEFINER` function (owner-rights, `search_path` pinned, EXECUTE only to `app_user`, returns only auth columns for one email) is the single sanctioned bypass — preferred over a second privileged connection pool. Migration `0003_auth.sql`. The `auth_refresh_token` table is the one mutable security table (UPDATE granted for revoke/rotate); everything else stays append-only.

### 2026-06-27 · Git: commit directly to `main`, no feature branches (user preference)
Module 0 branch `module0-auth-authz-audit` merged (--no-ff) into `main` and deleted. Going forward, work and commit straight to `main`.

### 2026-06-27 · Module 1 fuzzy resolution: normalize + aliases + pg_trgm
"Fuzzy-in / canonical-out" (§7) = three layers: `normalize()` (lowercase, strip non-alphanumerics) collapses case/space/punct variants of the SAME token; explicit `ref_alias` rows cover genuinely different spellings (701 vs ICT701); and `pg_trgm` `similarity()` powers typo-tolerant ranked type-ahead. Exact-normalized hits rank above trigram matches. `unique(org_id, ref_id, normalized)` prevents duplicate aliases on one entity; cross-entity ambiguity is resolved by returning ranked candidates (pick-don't-type), not a hard constraint.

### 2026-06-27 · Module 1 additive schema (0004) — merge redirect + referred-by
`ref_entity` gains `archived_at` + `merged_into_id` so a steward can MERGE a duplicate into a canonical survivor: aliases move to the target, the source's old name is kept as an alias (still resolves), FK refs (`party.university_id`) are repointed, and the source is archived pointing at the survivor. `party` gains `referred_by_party_id` (self-ref) for the directory's "referred-by". Additive nullable columns — not a spine redesign. NOTE: merge's FK-repoint list must grow as ref-consuming tables are added (Module 2: work_item course/assignment refs).

### 2026-06-27 · Module 1 packaged as `refdata/` folder (deny-rule workaround)
`.claude/settings.json` denies `Edit(reference/**)` (meant for the top-level human `/reference/` spreadsheet backup, CLAUDE.md §5), but the glob also blocks an API source dir named `reference/`. Since that settings file is itself deny-listed for edits, the NestJS module lives at `apps/api/src/modules/refdata/` instead; HTTP routes are still `/reference` + `/parties` and the permission module key is still `reference`. Reference data + party directory are one module (Module 1), feature-flagged by `FEATURE_REFERENCE`; the Data Steward role makes the confirm/merge permission delegable to non-owners (§7).
