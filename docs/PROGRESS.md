# PROGRESS.md

> The build agent's cross-session memory. **Update this after completing any task or migration** (per CLAUDE.md §1) — move items between sections, and always note where you stopped if mid-task. Read this first when resuming.

**Last updated:** 2026-06-27
**Current phase:** Phase 1 — Capture & core ledger (see DESIGN_SPEC.md §12)
**Build state:** Foundation + **Module 0 depth (real auth + permission engine + audit)** done and verified. Postgres (Docker) + Schema A–F + auth migration (0003) applied; seed + dev passwords loaded; 37 tests green (22 DB + 15 HTTP); identity proven server-trusted (forged headers ignored). Not in a broken state. On branch `module0-auth-authz-audit`.

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

## ⏭️ Next (Phase 1, suggested order)
1. **Module 1 — reference + directory**: `ref_entity`/`ref_alias` fuzzy-in/canonical-out, provisional→confirmed governance, party/client directory.
3. **Module 2 — work + legs**: work_item/line capture incl. copy fan-out; derived-margin read model (margin = inbound − outbound, computed, never stored).
4. Capture-first "my open loops" screen + add-a-job + job detail hub (web).
5. Billing/payments (open-item: partial-within-job + bulk-across-jobs) + writer-aggregate balances.

## 🧱 Blocked / waiting on owner
- (nothing)

## 📝 Notes / where I stopped
- **Run it:** `docker compose up -d` → `pnpm --filter @business-os/db migrate` → `... seed` → `... test`. API: `pnpm --filter @business-os/api build` then `node apps/api/dist/main.js` (or `pnpm --filter @business-os/api dev`). `pnpm db:reset` rebuilds from scratch.
- **Port:** host Postgres conflict pushed the container to **5433** — if a future machine is clean, 5432 also works (update `.env`).
- **API runtime model:** compiled with `tsc` (not tsx) because esbuild/tsx drops `emitDecoratorMetadata` that Nest DI needs. Build before run.
- **`web` not yet run** (`next build`/`dev` untested this session); files scaffolded and typecheck-ready. shadcn/ui components deferred (visual language is a later round per spec §10).
- **Drizzle schema is a typed mirror**; the raw SQL in `packages/db/migrations` is the DDL source of truth.
