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

### 2026-06-27 · Module 2 money model: read only from legs (RLS), margins derived
All money (prices, pay, margins) is read from the `leg` chain, which is RLS-enforced (a non-party gets zero rows; only System SuperAdmin bypasses). `deriveMargins` (in `@business-os/shared`) computes margin = inbound − outbound from ONLY the legs the caller can see, and reports a node only when both its sides are visible — so a middle party sees just their own slice and cannot reconstruct the top client price; SuperAdmin sees all nodes. Nothing is stored: no profit/margin column, line amounts computed via `computeLineAmount`. Legs are append-only (insert/select grant only); corrections are reversing legs. Legs are inserted with client-side UUIDs and **no RETURNING**, because an admin building the chain isn't a party to every leg and reading the row back would (correctly) trip the leg SELECT policy.

### 2026-06-27 · Module 2 work_line money + consumer identity redacted to work:approve
`work_line` has only tenant RLS (admins must manage all lines, and they aren't a "party" on consumer rows), so column-level money protection is done in the API: `mapLine` returns the work spec to everyone but withholds `client_rate`/`writer_rate`/`fixed_amount`/computed amount AND the consumer (client) party id unless the caller is System SuperAdmin or holds `work:approve`. This applies on every line-returning path (detail, list, and the `addLine` response). The authoritative, DB-enforced money boundary remains the legs. INTERIM: the `work:approve` gate is coarse; per-field visibility via `permission.scope_json` (SCHEMA §A) is the eventual model (deferred). Full column-level DB security on `work_line` also deferred.

### 2026-06-27 · Module 2 copy fan-out = 1 producer line → N consumer lines
The writer's single "5 copies @ my rate" entry is one producer `work_line` (writer side, `unit_count = N`); the admin's fan-out creates N independent consumer `work_line`s (each its own `consumer_party_id` + `client_rate`/state), each linked back via `source_line_id`. Producer and consumer are never the same row (a line is one side XOR the other; enforced in `addLine`). Legs are created explicitly now; auto-deriving leg amounts from deal terms is Module 3 (`leg.deal_term_id` stays nullable).

### 2026-06-27 · Module 3 effective-dating: half-open windows + supersede (value never mutated)
Rules are date-versioned with half-open windows `[effective_from, effective_to)`. Renegotiation **supersedes**: within one tx, close the prior open version (`UPDATE … SET effective_to = newFrom` — the only sanctioned mutation, allowed by the SELECT/INSERT/UPDATE grant) and INSERT a new version; the prior `value`/`rate` is never changed. So a March job resolved as-of March still hits the March window even after a June renegotiation. `isEffectiveOn`: `effective_from <= asOf AND (effective_to IS NULL OR asOf < effective_to)`. Supersede refuses an already-closed version (no overlapping windows). Resolution filters the window in SQL and the pure ranker re-checks — expired rules can never win.

### 2026-06-27 · Module 3 precedence (most-specific → default)
`resolveDealTerm` scores candidates: specific party-pair (+10) over global null-pair (+0); `applies_to` client (+3) > jobtype (+2) > default (+1); a non-matching client/jobtype rule is excluded; ties break to latest `effective_from`, then latest `created_at`. `resolveCompRule`: party-specific (+10) beats role-level (+1). Pure functions in `@business-os/shared/rules.ts` (unit-tested) so precedence/dating is provable without a DB. `applies_to` follows the SCHEMA text convention (`default` | `client:<uuid>` | `jobtype:<x>`). KNOWN GAP (deferred): jobtype is exact-match free text, so a typo silently no-ops — a canonical-jobtype (ref_entity) tie-in is the eventual fix.

### 2026-06-27 · Module 3 gating + comp_rule provenance (migration 0008)
Deal terms / comp rules are gated by `rules:*` (Admin + System SuperAdmin hold it; Writers don't → money rules don't leak). Party-scoped "own terms" reads (a writer seeing their per-word rate) deferred, consistent with Modules 1/2. SCHEMA §E omitted provenance on `comp_rule` though they are money-defining; migration **0008** additively adds `created_by`/`created_at` (set from the signed-token principal) — a small spine gap closed, not a redesign. Resolution-only this module; auto-applying resolved terms to legs is Module 5. The Module 1 `ReferenceService.merge` was extended here to also repoint `work_item.course_ref_id`/`assignment_type_ref_id` onto the survivor.

### 2026-06-27 · Module 4 web auth: BFF proxy + httpOnly cookies (tokens never in JS)
The browser never holds tokens. It talks only to same-origin Next route handlers (`/api/auth/*`, `/api/proxy/[...path]`); login stores the access+refresh JWTs as **httpOnly, SameSite=Lax** cookies (secure in prod), and the proxy attaches the Bearer from the cookie and refreshes once on 401. A **single-flight** dedupes concurrent refreshes so the rotating refresh token isn't double-spent (which would trip reuse-detection) — per-process (note for multi-instance deploys). The NestJS API remains the real authority (RLS + guards + redaction); the BFF is plumbing. Chosen over client-side token storage (XSS exposure).

### 2026-06-27 · Module 4 CSRF: same-origin required for state-changing proxy calls
Because SameSite=Lax still allows cross-site top-level form POSTs, the proxy rejects unsafe methods (POST/PUT/PATCH/DELETE) unless the request is same-origin (verified via `Sec-Fetch-Site: same-origin`, else a strict `Origin` match). Verified: a cross-site POST → 403. The proxy also rejects traversal path segments (SSRF) and forces `content-type: application/json` to the API. Guards extracted to `src/lib/proxy-guard.ts` and unit-tested.

### 2026-06-27 · Module 4 money-safety: UI renders only what the (redacted) API returns
The DB/API is the money authority (legs RLS + `work_line` redaction). The UI's rule: render money **only when the field is present** — `<Money>`/`formatMoney` return nothing for absent/empty/NaN (never a `0`/`—` that implies a hidden figure), and no client code derives a margin/price or requests an unredacted endpoint. Proven end-to-end: a Writer's job-detail payload lacks `clientRate`/amount, shows only their own leg, no margin. Belt over the server guarantee. SWR + a thin fetch wrapper for reads; a restrained Tailwind primitive set (`src/components/ui.tsx`); shadcn/full visual language still deferred. Deadline/tz-urgency display deferred until a `work_item` deadline field lands with the task board (Module 6).

### 2026-06-28 · Module 5 invoicing + balances: live grouping, derive don't store
Invoices are a **live grouping** of a client's billable lines: a line auto-attaches to the client's open invoice (`ensureOpenInvoice`), lines move between invoices, and an estimate is **superseded by a final** (`supersedes_invoice_id`) with the estimate set `status='void'` but retained (never deleted). All balances are **derived** from `payment_allocation` sums (SCHEMA §I — `invoice_line.paid_amount` is left dormant, never written/read); the only maintained status is `work_item.money_state` (`recomputeMoneyState`: unbilled→invoiced→partial→settled), which is **independent of `work_state`** — the two parallel closes. Payments are events; allocation is the link, supporting partial-within-job and bulk-across-jobs in one call (cap-checked). Money tables (`payment`, `payment_allocation`, `payment_proof`, `charge`) stay INSERT+SELECT only; corrections are **reversing entries** (negative mirrors): a payment reversal carries `reverses_payment_id` and refuses double/over-reversal; `SELECT FOR UPDATE` can't be used to lock (append-only grant withholds UPDATE) so a concurrent-allocation lock (advisory) is deferred.

### 2026-06-28 · Module 5 bidirectional charge ledger (party→business dues)
Legs carry **business→party earnings**; a new append-only `charge` table carries **party→business dues** (platform fee now, AI-check etc. later), itemized as "amount to be paid", settled via `payment_allocation.charge_id`. Each party has a **two-way balance**: `derivePosition` nets earnings-outstanding (legs to them − payouts) against charges-outstanding (their charges − settlements) into a position; a platform fee surfaces as a due on the writer's `/billing/balance/me` (available to any authenticated party; computed under their own RLS). `charge` has **leg-style party-scoped RLS** (a party sees only their own dues). Because an admin isn't a party to a charge, `createCharge` uses client-side id + no RETURNING (like `leg.appendLegs`), and validating/reversing a charge goes through `charge_summary()` (SECURITY DEFINER, EXECUTE to app_user only) so the source party/amount/already-reversed are read server-side, never trusted from the client. Invoices/payments are `billing:*`-gated admin ops; cross-party/business-wide balances are the settlement layer (Phase 2) / SuperAdmin.
