# PROGRESS.md

> The build agent's cross-session memory. **Update this after completing any task or migration** (per CLAUDE.md §1) — move items between sections, and always note where you stopped if mid-task. Read this first when resuming.

**Last updated:** 2026-06-27
**Current phase:** Phase 1 — Capture & core ledger (see DESIGN_SPEC.md §12)
**Build state:** Foundation up and verified. Monorepo scaffolded; Postgres (Docker) + Schema A–F migrated with RLS; seed loaded; RLS/append-only/tenant tests green; NestJS API boots and `whoami` proves the access layer end-to-end. Not in a broken state.

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
- **API skeleton**: NestJS module 0 (`platform`) with `GET /health` and `GET /platform/whoami` (stub header auth). Verified: `whoami` returns context, `dbSeesContext` (read back via `current_setting`), and the resolved party — they match for Momin/Emon/superadmin. Feature-flag registry in `apps/api/src/feature-flags.ts`.

## 🔨 In progress
- (nothing — foundation is at a clean stopping point)

## ⏭️ Next (Phase 1, suggested order)
1. **Module 0 depth**: real auth (replace the stub header context in `apps/api/src/common/rls/rls-context.ts`), the permission engine (read `permission` rows for module/field gating), provenance helpers (`created_by/updated_by`), audit_log writer wired into mutations.
2. **Module 1 — reference + directory**: `ref_entity`/`ref_alias` fuzzy-in/canonical-out, provisional→confirmed governance, party/client directory.
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
