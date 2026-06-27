# PROGRESS.md

> The build agent's cross-session memory. **Update this after completing any task or migration** (per CLAUDE.md §1) — move items between sections, and always note where you stopped if mid-task. Read this first when resuming.

**Last updated:** 2026-06-27
**Current phase:** Phase 1 — Capture & core ledger (see DESIGN_SPEC.md §12)
**Build state:** Foundation + Modules 0–2 + **Module 3 (deal terms + comp rules — effective-dated rules engine)** done and verified, all on `main`. Postgres (Docker) + migrations 0000–0008 applied; seed + dev passwords loaded; **198 tests green (107 DB + 91 HTTP)**; leg-leak + effective-dating guarantees proven. Not in a broken state. (Commit directly to `main`, no feature branches — user preference.) NOTE: a pre-existing flake in the auth-http bizadmin test can surface once under concurrent file load; passes on rerun.

---

## ✅ Done
- Design spec, schema, CLAUDE.md, and permission settings authored (pre-build).
- **Monorepo skeleton** (pnpm + Turborepo, TS end-to-end): `apps/api` (NestJS), `apps/web` (Next.js + Tailwind), `packages/db` (Drizzle + raw-SQL migrations), `packages/shared` (enums + RLS context types). Root `tsconfig.base.json`, `turbo.json`, `.gitignore`, `.env.example`.
- **Docker Compose**: `postgres:16` + Adminer, volume-persisted. NOTE: host published on **port 5433** (a pre-existing host Postgres occupies 5432). Connection strings in `.env` use 5433.
- **First migration — SCHEMA.md A–F + dependencies**, implemented exactly as written (only create-order changed to resolve forward refs). Tables: A (org, party, user_account, role, permission, user_role), B (ref_entity, ref_alias), C (project, milestone, milestone_template(_item), work_item, work_line), D (leg), E (deal_term, comp_rule), F (invoice, invoice_line, payment, payment_allocation, payment_proof). Dependencies pulled in early: `file_object`, `audit_log`. Files: `packages/db/migrations/0000_init.sql`.
- **Row-level security** (`0001_rls.sql`): context accessors (`app_current_org/party`, `app_is_superadmin`) over per-tx GUCs; `ENABLE + FORCE` RLS on every table; tenant-isolation policy everywhere; **leg-visibility policy** (SuperAdmin OR party-on-leg); tiered grants to non-owner `app_user` encoding append-only (leg/payment/payment_allocation/payment_proof/audit_log = INSERT+SELECT only).
- **Seed** (`0002_seed.sql`): one org, 9 default roles (spec §4.3), representative permissions, Momin/Emon parties, 4 user accounts (sysadmin/bizadmin/momin/emon) linked-not-merged. Fixed UUIDs.
- **Access layer**: `withRlsTransaction()` in `packages/db/src/client.ts` (reused by API `DbService` and tests). Migrator with a `schema_migrations` ledger + `ensureAppRole` (creates non-superuser role from env).
- **Tests green** (`packages/db/test/rls.test.ts`, 9/9): leg structural opacity (Emon can't see the true client price), writer sees only final leg, SuperAdmin sees all, tenant isolation, append-only UPDATE/DELETE rejected on payment/leg/audit_log. Plus `guard:no-stored-profit` passes.
- **API skeleton**: NestJS module 0 (`platform`) with `GET /health` and `GET /platform/whoami`. Feature-flag registry in `apps/api/src/feature-flags.ts`.
- **Module 0 depth — real auth + permission engine + audit** (branch `module0-auth-authz-audit`):
  - **Auth** (`apps/api/src/common/auth/`): JWT access (30m) + refresh (sliding 10-day, per-device, hashed in `auth_refresh_token`, rotation revokes old + reuse-detection kills the family, logout revokes server-side); bcryptjs passwords; opt-in TOTP 2FA (otplib). `AuthGuard` (global) sets `req.principal` from the **signed token**. Endpoints: `POST /auth/{login,refresh,logout,2fa/enroll,2fa/enable}`, `GET /auth/me`. **JWT_SECRET must be ≥32 chars or the API refuses to boot; HS256 pinned.**
  - **Permission engine** (`apps/api/src/common/authz/`): roles-as-data; `PermissionService.loadEffective` (user_role→permission); `@RequirePermission(module,action)` + global `PermissionGuard` (fail-closed; System SuperAdmin short-circuits).
  - **Audit** (`apps/api/src/common/audit/`): append-only `audit_log` writes wired into login/login_failed/logout/token_refreshed/refresh_reuse_detected/2fa_enabled and the admin actions.
  - **RLS context now from the principal, not headers** (`rls-context.ts` rewritten; header path deleted). `app.is_superadmin` GUC = **System SuperAdmin only** (§4.4); Business SuperAdmin gets no leg bypass.
  - **Migration `0003_auth.sql`**: `app_auth_lookup(email)` SECURITY DEFINER (the only sanctioned RLS bypass, for org-less login lookup) + `auth_refresh_token` (RLS + grants). Drizzle mirror `packages/db/src/schema/h-auth.ts`.
  - **Admin surface** (`modules/platform/admin.controller.ts`): `POST /platform/users`, `POST/DELETE /platform/users/:id/roles`, `GET /platform/permissions/me` — each permission-gated + audited. (Admins lack the `platform` module by seed → no self-promotion.)
  - **Dev credentials** (via `pnpm --filter @business-os/api seed:auth`): sysadmin/bizadmin/momin/emon `@fathomxo.local` / `Password123!`. NOTE: bizadmin has 2FA enabled (left by a verification probe).
  - **Tests**: `packages/db/test/auth-security.test.ts` (13) + `apps/api/test/auth-http.test.ts` (15) + helpers. Reviewed by security-reviewer; **fixed B1** (JWT secret hard-fail + HS256) and **S1** (atomic rotation + reuse detection).

## 🔨 In progress
- (nothing — Module 0 is at a clean stopping point)

## 🔐 Security follow-ups (from security-reviewer, deferred — not blockers)
- **S4 rate-limiting** on `/auth/*` (login/refresh/2fa) — add `@nestjs/throttler`; cap TOTP attempts.
- **S5 2FA step-up** — require password/current-TOTP reconfirmation to enroll/enable/replace 2FA; audit enroll/disable.
- **S6 unknown-email login** currently logs to app logger only (no org to scope an audit row) — route to a system/org-less audit sink.
- **S3** — add an explicit `org_id` predicate in `permission.service.loadEffective` as defense-in-depth (RLS already enforces it).

## ✅ Done — Module 1 (reference data + directory; DESIGN_SPEC §7)
- **Migration 0004 + seed 0005**: pg_trgm; additive cols `ref_entity.archived_at`, `ref_entity.merged_into_id`, `party.referred_by_party_id`; trigram GIN indexes; `unique(org_id, ref_id, normalized)` on ref_alias. Seed: **Data Steward** role (`reference:view`+`approve`, UUID `…aa`) + demo university `…e1` / course "ICT 701" `…e2` (aliases ict701, 701).
- **Shared** `normalize()` (`packages/shared/src/reference.ts`): lowercase + strip non-alphanumerics; used by API and (future) web type-ahead.
- **API module** at `apps/api/src/modules/refdata/` (folder named **refdata**, NOT reference — `.claude/settings.json` has an over-broad `Edit(reference/**)` deny that blocks a `reference/` source dir; routes are still `/reference` + `/parties`). Endpoints, all `@RequirePermission('reference', …)` + audited:
  - `GET /reference?kind=&q=` (view, type-ahead: exact-normalized → trigram), `GET /reference/:id`, `POST /reference/resolve` (create; resolve-or-create provisional, capture-first), `POST /reference/:id/aliases` (edit), `POST /reference/:id/confirm` (approve), `POST /reference/merge` (approve; moves aliases, keeps old name resolving, repoints `party.university_id`, archives source→`merged_into_id`).
  - `GET /parties?q=&type=` (view), `GET /parties/:id` (view; +universityCanonical +referredByName), `POST /parties` (create; `universityRaw` auto-resolves), `PATCH /parties/:id` (edit).
- Feature-flagged: `FEATURE_REFERENCE=true` in `.env`; wired into app.module via `isModuleEnabled('reference')`.
- **Tests**: `packages/db/test/reference.test.ts` (16) + `apps/api/test/reference-http.test.ts` (22). Reviewed by security-reviewer (no blockers); fixed #1 (boundary-validate `kind`/`type` query params via DTOs) and added merge tombstone guards.
- **Deferred (tracked):** merge currently repoints only `party.university_id` — extend when Module 2 adds `work_item.course_ref_id`/`assignment_type_ref_id` (else those refs orphan on merge). Field-masking within reference-viewers still deferred (Writers lack `reference:*` so contact isn't exposed).

## ✅ Done — Module 2 (work + lines + leg chain; DESIGN_SPEC §3, SCHEMA §C/§D)
- **Migration 0006** (additive): `work_line.source_line_id` (fan-out: consumer line → its one producer line) + indexes on `leg(work_item_id,seq)`, `work_line(work_item_id)`, `work_line(source_line_id)`. Tables + leg-visibility RLS already existed (0000/0001).
- **Shared** `packages/shared/src/work.ts`: `computeLineAmount` (fixed ?? rate×count) and `deriveMargins` (margin = inbound − outbound, computed ONLY from the legs the caller can see — one-sided-safe; never stored).
- **API module** `apps/api/src/modules/work/` (feature-flagged `FEATURE_WORK`), all `@RequirePermission('work', …)` + audited:
  - `POST /work` (create) · `GET /work` (list) · `GET /work/:id` (detail hub) · `PATCH /work/:id` (edit)
  - `POST /work/:id/transition` (edit; **→confirmed requires work:approve**, governance — stamps confirmed_by/at; work-state machine draft→pending→confirmed→delivered, adjacent-forward only)
  - `POST /work/:id/lines` (create) · `POST /work/:id/fan-out` (create; **copy fan-out**: 1 producer line + N independent consumer lines) · `POST /work/:id/legs` (**approve**; append-only money chain) · `GET /work/:id/legs` (view; RLS-filtered legs + derived margins)
- **Money model**: read ONLY from `leg` (RLS — non-party gets zero rows); `work_line` money columns AND consumer identity are redacted unless caller is System SuperAdmin or holds `work:approve`. Legs are append-only; corrections are reversing legs; legs inserted with client-side ids + no RETURNING (an admin isn't a party to every leg).
- **Tests: 125 green (65 DB + 60 HTTP)**, up from 75. Leg-leak guarantee proven at DB + HTTP (the true client price never reaches a downstream party). security-reviewer: fixed **B2** (redact `addLine` response), **S1** (redact consumer identity from non-money callers), **S2** (validate legs: no from===to / both-null / cross-item work_line), **S5** (audit per-leg figures). Deferred: **S3** (money-field visibility via `permission.scope_json` rather than the coarse `work:approve` gate), **S4** (explicit org_id predicate on spine reads — RLS already covers), and a DB unique index on `(work_item_id, seq)`.
- **Cross-module follow-up**: handled in Module 3 — `ReferenceService.merge` now also repoints `work_item.course_ref_id`/`assignment_type_ref_id`.

## ✅ Done — Module 3 (deal terms + comp rules; DESIGN_SPEC §3.4–3.5)
- **Migration 0007** (resolution indexes) + **0008** (additive `comp_rule.created_by`/`created_at` — provenance gap, comp rules are money-defining). Tables/grants already existed (SELECT/INSERT/UPDATE = supersede pattern).
- **Shared** `packages/shared/src/rules.ts` (pure, unit-tested): `isEffectiveOn` (half-open `[from,to)`), `parseAppliesTo`, `resolveDealTerm` (precedence: specific pair +10 vs global; applies_to client +3 / jobtype +2 / default +1; tie-break latest effective_from then created_at), `resolveCompRule` (party-specific beats role-level).
- **API module** `apps/api/src/modules/rules/` (feature-flagged `FEATURE_RULES`), all `@RequirePermission('rules', …)` + audited: `POST/GET /deal-terms`, `POST /deal-terms/supersede`, `GET /deal-terms/resolve`; same for `/comp-rules`; `GET /rules/preview-legs/:workItemId` (read-only — resolves source→doer terms + doer comp as-of the job date, writes NO leg).
- **Effective-dating**: renegotiation = **supersede** (close prior `effective_to`, insert new version; value/rate never mutated). A March job resolves to March's terms after a June renegotiation — proven at DB + HTTP. Legs stay explicit; auto-deriving leg amounts from terms is Module 5 (`leg.deal_term_id` nullable for now).
- **Tests: 198 green (107 DB + 91 HTTP)**, up from 125 (+42 pure/DB, +31 HTTP). security-reviewer: fixed **#2** (supersede refuses an already-closed version → no overlapping windows), **#5** (comp supersede audits old/new rate + cost-bearer), **#6** (comp_rule provenance, migration 0008), **#8** (strict client UUID regex). Deferred: **#3** (assert prior is the *latest* open version — mitigated by #2), **#7** (jobtype is exact-match free text → a typo silently no-ops; canonical-jobtype tie-in later), and party-scoped term visibility (only `rules:*` holders see terms; Writers don't → no leak).

## ⏭️ Next (Phase 1, suggested order)
1. Capture-first "my open loops" screen + add-a-job + job detail hub (web, Module 4).
2. Billing/payments (open-item: partial-within-job + bulk-across-jobs) + writer-aggregate balances (Module 5) — incl. auto-deriving leg amounts from resolved deal terms (`leg.deal_term_id`).

## 🧱 Blocked / waiting on owner
- (nothing)

## 📝 Notes / where I stopped
- **Run it:** `docker compose up -d` → `pnpm --filter @business-os/db migrate` → `... seed` → `... test`. API: `pnpm --filter @business-os/api build` then `node apps/api/dist/main.js` (or `pnpm --filter @business-os/api dev`). `pnpm db:reset` rebuilds from scratch.
- **Port:** host Postgres conflict pushed the container to **5433** — if a future machine is clean, 5432 also works (update `.env`).
- **API runtime model:** compiled with `tsc` (not tsx) because esbuild/tsx drops `emitDecoratorMetadata` that Nest DI needs. Build before run.
- **`web` not yet run** (`next build`/`dev` untested this session); files scaffolded and typecheck-ready. shadcn/ui components deferred (visual language is a later round per spec §10).
- **Drizzle schema is a typed mirror**; the raw SQL in `packages/db/migrations` is the DDL source of truth.
