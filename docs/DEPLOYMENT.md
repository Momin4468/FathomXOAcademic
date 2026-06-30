# DEPLOYMENT.md — Production deployment runbook & context

> **Status:** living doc, updated as stages complete. This is the single source of
> truth for taking Business OS to production. It is self-contained: a fresh Claude
> Code session (or Claude web) can read only this file + the repo and have full
> context. **It contains NO secret values** — only placeholders.

## 0. How to use this document
- **Future Claude Code sessions:** read this top-to-bottom before touching deploy/config. Honor the guardrail in §1. Update §4 (status) as stages complete.
- **Claude web (for a more detailed walkthrough):** paste this whole file and ask: *"I'm deploying this system. Walk me through the CURRENT stage (see §4 status) in detailed, click-by-click steps for a deployment-rusty operator; don't change business logic."* Everything Claude web needs (stack, invariants, topology, decisions, env, the staged plan, gotchas) is below.
- **Guardrail (non-negotiable):** this is **deployment & configuration only — no business-logic or visibility-rule changes.** Allowed code changes are strictly infra/hardening/adapters behind existing interfaces (server bootstrap, rate-limit pre-checks, storage/email adapters, captcha verification). Never touch money/leg/RLS-policy/permission logic.

---

## 1. The system in one screen
A multi-tenant, role-scoped, append-only **ledger for an academic-work brokerage** (FathomXO / X-Factor Academic Solutions). Modular monolith, `org_id` on every table, "sell module-by-module" via feature flags. Phases 1–3 complete (Modules 0–18); migrations 0000–0034.

**The money/visibility model (what deployment must NOT break):**
- Every job is a **chain of money `leg`s** (true client price → each intermediary → writer rate). **Profit/margin/split is derived from legs at read time, never stored.**
- **Visibility is enforced in Postgres (RLS + `SECURITY DEFINER` functions), not the UI.** A party sees only legs it's `from`/`to` on; System SuperAdmin (break-glass, audited) sees all.
- **§4.4 partner opacity:** partners see each other's *volume*, never each other's *margins*.
- **Three identity planes, disjoint by construction:** business (`user_account`, RLS by `app_current_org()` + leg membership), personal-finance (`pf_account`, own GUC `app_current_pf_account()`; business/SuperAdmin read **zero** PF rows), client portal (`client_account`, business RLS scoped to the client's party; reads go through caller-guarded definers — never the writer/margin/chain).
- **Why this matters for hosting:** the model only holds because the app connects as a **non-superuser, non-owner `app_user`** (RLS binds) while the migrator/owner role is separate. This must be reproduced exactly on the managed DB → **Stage 2 re-verifies the whole model on the production DB before any real data.**

**Stack:** pnpm@9.15 + Turborepo; Node ≥20. `apps/api` (NestJS 10), `apps/web` (Next.js 15, internal tool), `apps/marketing` (Next.js 15, public site), `packages/db` (Drizzle + raw-SQL migrations), `packages/shared`. Build order: shared → db → api (Turbo handles it).

---

## 2. Production topology & decisions
| Piece | Target | Domain | Notes |
|---|---|---|---|
| API (`apps/api`) | **Render** Web Service, **free** | `api.xfactoras.com` | `node apps/api/dist/main.js`; `/health` check; single instance. |
| Internal tool (`apps/web`) | **Vercel** project | `app.xfactoras.com` | root dir `apps/web`; needs `@business-os/shared`. |
| Marketing (`apps/marketing`) | **Vercel** project | apex `xfactoras.com` (+ `www`) | root dir `apps/marketing`. |
| Postgres + Storage | **Supabase**, **free** | — | Postgres = system of record; Supabase Storage replaces local disk. |
| Email | **Resend** | — | verify sending domain (DKIM/SPF/DMARC). |
| AI capture | **dev provider** | — | free default, no key, no spend. |
| BI / Metabase | **deferred** | — | `FEATURE_DASHBOARD` stays on; embed endpoint 404s until configured — fine. |
| Captcha | **Cloudflare Turnstile** | — | on the public quote form. |
| DNS / registrar | **Namecheap** | xfactoras.com | turn OFF the parking page + the apex→www redirect at cutover. |

**Decisions already made (with consequences):**
- **Render free** → the instance sleeps; the in-process `@Cron` reminders/lead-purge won't fire while asleep, and cold starts add latency. *Mitigation:* a free external uptime pinger (UptimeRobot/cron-job.org) hits `/health` every ~10 min to keep it warm so crons fire. Proper scheduler (Supabase pg_cron / Render Cron) is a later upgrade. Single instance also avoids cron double-fire and keeps the in-process rate-limiter coherent.
- **Supabase free** → no automated backups/PITR, and the project pauses after ~1 week idle (a live business keeps it active). *Mitigation:* self-managed scheduled `pg_dump` (Stage 8); accept the between-dumps data-loss window. Upgrade to Pro later for PITR.
- **No CORS needed** on the API: browsers only call same-origin BFF route handlers in each Next app; the BFFs call the API server-to-server.
- **`api.xfactoras.com`** (custom domain) so the apps' `API_URL` is stable across Render renames.

---

## 3. Connections to Supabase (the fiddly part)
- **Use the pooler, not "Direct connection"** — direct is IPv6-only; Render egress is IPv4. Supabase "Connect" dialog gives pooler strings on host `aws-0-<region>.pooler.supabase.com`, username `postgres.<project-ref>`.
- **Migrations/DDL + role creation →** the **Session pooler** (port **5432**) as `DATABASE_URL_ADMIN` (the `postgres` creds). Session mode = dedicated connection, so `CREATE ROLE` + DDL work.
- **The running API →** the **Transaction pooler** (port **6543**) as `DATABASE_URL`, using the **`app_user`** creds (username `app_user.<project-ref>`). Our access layer (`packages/db/src/client.ts`) wraps every request in a transaction whose first statement is `set_config('app.org_id', …, true)` (transaction-local GUC) → compatible with transaction-mode pooling.
- **SSL:** Supabase requires TLS. Append **`?sslmode=require`** to both URLs. Code already enables TLS for managed hosts (`pgSsl()` in `packages/db/src/client.ts`, applied in `createPool` + the migrator). `rejectUnauthorized:false` (encrypt, no CA pin) — hardening: pin Supabase's CA for `verify-full` later.
- **Region:** Singapore (`ap-southeast-1`) to match Render and minimize API↔DB latency for BD users.

---

## 4. CURRENT STATUS (update as you go)
- ✅ **Stage 0 — API hardening + ops config** — committed `3bde91d`. `main.ts`: bind `0.0.0.0`, `trust proxy=1`, `enableShutdownHooks`, `helmet`. `apps/api` `engines: node>=20` + `helmet` dep. `render.yaml` blueprint. Verified: builds; `auth-http` 15/15; `public-intake` 16/16 (with a valid `PUBLIC_LEAD_ORG_ID`).
- ✅ **Stage 1 prep — TLS for managed Postgres** — committed `ef300a2`. `pgSsl()` + `createPool`/migrator use it.
- 🔄 **Stage 1 — provision Supabase + migrate** — IN PROGRESS. Waiting on: create project, get pooler strings, set `.env` (see §6 Stage 1), then run `pnpm db:migrate`.
- ⏳ Stages 2–8 — pending (see §6). Stage code NOT yet written: auth rate-limiting (B), Supabase-Storage adapter (C), Resend adapter (D), Turnstile captcha (E).

---

## 5. Environment variables
Documented in full in the committed `.env.example` (root), `apps/web/.env.example`, `apps/marketing/.env.example`. Summary of what MUST be set vs. optional:

**Hard-required (API won't boot / migrations fail without):**
- `DATABASE_URL_ADMIN` (Supabase session pooler, `postgres`), `DATABASE_URL` (Supabase transaction pooler, `app_user`), `JWT_SECRET` (≥32 chars).

**Required when the feature is used (all on, so set them):**
- `VAULT_ENCRYPTION_KEY` (base64 32 bytes; **irreplaceable — back up off-repo**), `PUBLIC_INTAKE_PROXY_SECRET` (same on API + marketing), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_STORAGE_BUCKET` (storage), `RESEND_API_KEY` (email), `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` (captcha).

**Fixed values:** `PUBLIC_LEAD_ORG_ID=00000000-0000-4000-8000-000000000001`, `WEB_BASE_URL=https://app.xfactoras.com`, `EMAIL_ADAPTER=resend`, `STORAGE_ADAPTER=supabase`, `AI_CAPTURE_PROVIDER=dev`, `NODE_ENV=production`, all `FEATURE_*=true`.

**Marketing (Vercel):** `API_URL=https://api.xfactoras.com`, `PUBLIC_INTAKE_PROXY_SECRET`, `QUOTE_RATE_MAX`, `NEXT_PUBLIC_SITE_URL=https://xfactoras.com`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
**Web (Vercel):** `API_URL=https://api.xfactoras.com`.

> ⚠️ **Empty-string footgun:** an env line set to *empty* (e.g. `PUBLIC_LEAD_ORG_ID=`) overrides the code default with `""` because the code uses `?? default` (only catches missing, not blank). Either give a real value or **omit the line entirely**. (A defensive "treat blank as unset" fix is slated for Stage 5.)

**Secrets to generate (save in a password manager; never commit):**
```
JWT_SECRET                  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
VAULT_ENCRYPTION_KEY        node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BACK UP OFF-REPO, 2 places
PUBLIC_INTAKE_PROXY_SECRET  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_DB_PASSWORD             node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
> **`VAULT_ENCRYPTION_KEY` is the one irreplaceable secret:** once it has sealed vault items / 2FA secrets, losing it makes them permanently unrecoverable. JWT/others are rotatable; this is not.

---

## 6. Staged runbook (pause for operator approval at each stage)

### Stage 0 — DONE (see §4).

### Stage 1 — Provision Supabase + migrate
1. Create the Supabase project (region Singapore); save the DB password.
2. Generate the `app_user` password (§5).
3. From **Connect**, copy the **Session pooler** (5432) and **Transaction pooler** (6543) strings.
4. In local `.env` (temporary — points local at Supabase for Stages 1–2):
   - `DATABASE_URL_ADMIN=<session-pooler 5432, postgres creds>?sslmode=require`
   - `APP_DB_USER=app_user`, `APP_DB_PASSWORD=<generated>`
   - `DATABASE_URL=<transaction-pooler 6543, but username postgres.<ref>→app_user.<ref> + app_user password>?sslmode=require`
5. Run **`pnpm db:migrate`** → creates `app_user` (`nosuperuser nocreatedb nocreaterole`) + `analytics_ro`, applies 0000–0034 (tables, RLS `enable`+`force`, all definers).
6. **Verify:** `app_user` connects through the pooler; it's a non-superuser. Then **PAUSE**.

### Stage 2 — Verify the WHOLE visibility model on Supabase (BEFORE real data)
- Tests are **destructive** (create→DELETE their own fixtures) → run against the **freshly-migrated EMPTY Supabase DB**, which self-cleans, before loading real data.
- `pnpm build`, point `.env` at Supabase, run (one file per process for HTTP):
  1. `pnpm --filter @business-os/db test` (DB RLS suite).
  2. `apps/api` HTTP suites: `billing-http` + `referrers-http` (leg opacity), `channels-http` (§4.4 partner-margin guards), `pf-isolation` (PF isolation + cross-token 401), `client-portal-http` (client scoping), `auth-http`/`pf-core` (regressions).
- **GATE: all visibility tests must pass on Supabase or STOP.**
- Then bootstrap prod data: run the **essential** seed only (org + roles + permissions from `0002_seed.sql`); **skip demo reference** (`0005`'s "University of Example"/"ICT 701") and **do NOT run `seed:auth`** (dev password). Create real System SuperAdmin + Admin with random unusable passwords; each sets their own via the **forgot-password flow** (live after Stage 3). **PAUSE.**

### Stage 3 — Adapters: Supabase Storage + Resend (AI stays dev)
- Write `SupabaseStorageAdapter` (behind the `StorageService` port: `put/readStream/size/remove`), selected by `STORAGE_ADAPTER=supabase`; create a **private** bucket; set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_STORAGE_BUCKET`. (Render disk is ephemeral → this is required.)
- Write `ResendEmailAdapter` (behind the `EmailService` switch), `EMAIL_ADAPTER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on the **verified** domain; envelope-only logging preserved.
- Verify: upload→download a file via the API (lands in the bucket); trigger one real email (password-reset). security-reviewer + qa on the adapters. **PAUSE.**

### Stage 4 — Deploy (API→Render, apps→Vercel); secrets in dashboards only
- Render Web Service from repo: build `pnpm install --frozen-lockfile && pnpm build`, start `node apps/api/dist/main.js`, health `/health`, single instance, all env from `render.yaml` (secrets via dashboard). **Migrations run manually** against Supabase (free tier has no preDeploy).
- Vercel A (`apps/web`, root `apps/web`): `API_URL=https://api.xfactoras.com`.
- Vercel B (`apps/marketing`, root `apps/marketing`): `API_URL`, `PUBLIC_INTAKE_PROXY_SECRET` (=API's), `QUOTE_RATE_MAX`, `NEXT_PUBLIC_*`, Turnstile keys.
- Smoke-test on the default Vercel/Render URLs (login, a scoped read, a quote) **before** DNS.
- Add the free **keep-alive pinger** → `https://api.xfactoras.com/health` every ~10 min. **PAUSE.**

### Stage 5 — Auth rate-limiting + quote-form captcha
- Add per-IP (+ per-identifier on login) limits to `/auth/{login,refresh}`, `/pf/auth/{login,refresh,register}`, `/client/auth/{login,refresh}` reusing `SlidingWindowRateLimiter` + `clientIpOf` (same pattern as password-reset).
- Cloudflare Turnstile: widget on the marketing quote form; verify the token in the marketing BFF (`apps/marketing/src/app/api/quote/route.ts`) before forwarding; make the API's `@Public /public/quote` **require** `PUBLIC_INTAKE_PROXY_SECRET` in prod so captcha can't be bypassed by hitting the API directly.
- Also fold in the **blank-env-var defensive fix** (treat `""` as unset). Re-run auth + public-intake suites + security-reviewer. **PAUSE.**

### Stage 6 — Namecheap DNS cutover
- **First turn OFF** the parking page + the existing `xfactoras.com → www` redirect (+ default parking records).
- Records (confirm exact targets in each dashboard):
  - apex `xfactoras.com` → marketing (Vercel): `A @ 76.76.21.21` (or Namecheap ALIAS/flattening to the Vercel target).
  - `www` → marketing: `CNAME www cname.vercel-dns.com.`
  - `app` → web (Vercel): `CNAME app cname.vercel-dns.com.`
  - `api` → API (Render): `CNAME api <service>.onrender.com.`
  - Resend domain-verification records (from Stage 3).
- Add each custom domain in the matching Vercel project / Render service so certs issue. **PAUSE.**

### Stage 7 — HTTPS verification
- Valid TLS + auto-HTTPS-redirect on apex, `www`, `app`, `api`. Cookies `Secure` (driven by `NODE_ENV=production`). Full login + a quote end-to-end on the real domains. **PAUSE.**

### Stage 8 — Backups + vault-key confirmation
- Stand up a scheduled **`pg_dump`** (e.g., a GitHub Actions cron) against the session-pooler URL; encrypt + store off-site; document restore + the data-loss window. (Supabase free has no PITR.)
- Confirm `VAULT_ENCRYPTION_KEY` is backed up in ≥2 secure off-repo places; test a vault read in prod. Final go-live checklist + monitoring/alerting. **DONE.**

---

## 7. Production-readiness flags (status)
1. API bound localhost → **fixed** Stage 0 (`0.0.0.0`).
2. No `trust proxy` (rate-limiters mis-key IPs) → **fixed** Stage 0.
3. No helmet / graceful shutdown → **fixed** Stage 0.
4. No SSL on DB clients (Supabase needs it) → **fixed** Stage 1 prep (`pgSsl`).
5. No auth-endpoint rate-limiting → **pending** Stage 5 (brute-force exposure until then).
6. Ephemeral Render disk loses local files → **Supabase Storage** Stage 3.
7. In-process `@Cron` won't fire on a sleeping free instance / double-fires if multi-instance → single instance + keep-alive pinger Stage 4; proper scheduler later.
8. Seed has demo data + a dev-password path → prod gets org/roles/permissions only; demo + `seed:auth` excluded; admins via forgot-password Stage 2.
9. In-memory rate-limiter is per-process/best-effort → fine on a single free instance; needs a shared store if scaled out.
10. Blank-env-var overrides defaults (`?? default`) → defensive fix Stage 5; until then, never leave an env line blank.
11. `rejectUnauthorized:false` on DB TLS → encrypt without CA pin; pin Supabase CA for verify-full later.

## 8. Gotchas / troubleshooting
- **`invalid input syntax for type uuid: ""`** on `/public/quote` → `PUBLIC_LEAD_ORG_ID` is blank; set it or remove the line (flag #10).
- **DB connection hangs/fails from Render** → using the IPv6 direct connection; switch to the IPv4 **pooler** string.
- **`CREATE ROLE`/DDL errors during migrate** → `DATABASE_URL_ADMIN` is pointing at the **transaction** pooler (6543); use the **session** pooler (5432) for admin/migrate.
- **`no pg_hba.conf entry … no encryption` / SSL errors** → add `?sslmode=require` to the connection string.
- **TOTP/2FA HTTP test flakiness** → time-window boundary; re-run (not a real failure).
- **HTTP test suites flaky when run together** → run one file per process (port contention).
- **Migrations are idempotent** (`schema_migrations` table tracks applied files); safe to re-run.
