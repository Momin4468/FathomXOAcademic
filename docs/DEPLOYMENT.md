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

---

# APPENDIX — Full execution detail (for a Claude-web-guided, terminal-by-hand deploy)
> This appendix exists because the deploy is being driven via Claude web (which cannot touch this repo). It gives the exact commands, code specs, and SQL so a human can execute every stage by hand. **Still honor the guardrail: no business-logic/visibility changes.** After writing any code, BUILD and run the relevant tests before trusting it. If anything here fights reality, the code is the source of truth — read the cited files.

## A. Exact commands (run from the repo root unless noted; `.env` points at Supabase for Stages 1–2)
```bash
pnpm install                                   # once
pnpm build                                     # builds shared → db → api → web → marketing
pnpm --filter @business-os/db migrate          # Stage 1: create app_user + apply 0000–0034 (reads DATABASE_URL_ADMIN)
pnpm --filter @business-os/db seed             # Stage 2: applies 0002_seed + 0005_seed_reference
# Stage 2 visibility gate — DB suite, then HTTP suites ONE FILE PER PROCESS:
pnpm --filter @business-os/db test
cd apps/api && node --import tsx --test test/billing-http.test.ts        # leg opacity
node --import tsx --test test/referrers-http.test.ts                     # leg opacity (referrer)
node --import tsx --test test/channels-http.test.ts                      # §4.4 partner-margin guards
node --import tsx --test test/pf-isolation.test.ts                       # PF plane isolation + cross-token 401
node --import tsx --test test/client-portal-http.test.ts                 # client scoping
node --import tsx --test test/auth-http.test.ts                          # regression (2FA test is time-flaky; re-run if it trips)
node --import tsx --test test/pf-core.test.ts                            # regression
```
The HTTP suites spawn `apps/api/dist/main.js`, which loads the repo-root `.env` — so `.env` must hold the full prod-ish config (both DB URLs, `JWT_SECRET`, all `FEATURE_*`, a valid `PUBLIC_LEAD_ORG_ID`, etc.). "All pass" against Supabase = the visibility model holds → proceed. **Any fail → STOP.**

## B. Code-change specs (Stages 3, 5, 8 — not yet written)
Each is infra/adapter only. Build + test after.

### B1. Supabase Storage adapter (Stage 3)
- **Today:** `apps/api/src/common/storage/storage.service.ts` is one concrete local-disk class with methods `put(buffer:Buffer)→Promise<string key>`, `readStream(key)→ReadStream`, `size(key)→Promise<number>`, `remove(key)→Promise<void>`; keys are UUIDs (path-traversal guard `^[0-9a-f-]{36}$`).
- **Change:** introduce a `STORAGE_ADAPTER` env switch (default `local`). Keep the local impl; add a `supabase` impl with the **same four methods**. Wire selection in the module/provider that constructs `StorageService` (or make `StorageService` delegate to an adapter chosen at construction by `process.env.STORAGE_ADAPTER`).
- **Supabase impl** (dep: `@supabase/supabase-js`): `const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`.
  - `put`: `key = randomUUID(); await sb.storage.from(BUCKET).upload(key, buffer, { contentType: 'application/octet-stream' }); return key;`
  - `readStream`: `const { data } = await sb.storage.from(BUCKET).download(key); return Readable.from(Buffer.from(await data.arrayBuffer()));` — **GOTCHA:** widen the method's return type from node's `ReadStream` to `import('node:stream').Readable` so both adapters satisfy it (callers only `.pipe()`); the local adapter's `createReadStream` is already a `Readable`. Update the type at the call sites (the files controller download).
  - `size`: the byte size is already persisted on `file_object` at upload, so prefer reading it there; if the interface must answer, use the storage metadata (`.info`/`.list`) — do **not** rely on re-downloading in prod.
  - `remove`: `await sb.storage.from(BUCKET).remove([key]);`
- **Env:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only — never `NEXT_PUBLIC`), `SUPABASE_STORAGE_BUCKET`. Create a **private** bucket in Supabase first.
- **Verify:** upload a file through the API (a brief on a public quote, or a vault/knowledge file) → object appears in the bucket; download streams back.

### B2. Resend email adapter (Stage 3)
- **Today:** `apps/api/src/common/email/email.service.ts` switches on `EMAIL_ADAPTER` (only `dev`; throws for unknown). Interface: `send({to,subject,text,html?})`.
- **Change:** add an `EMAIL_ADAPTER==='resend'` branch (dep: `resend`): `await new Resend(process.env.RESEND_API_KEY).emails.send({ from: EMAIL_FROM, to, subject, text, html })`. Preserve **envelope-only logging** (log to/subject, never the body). Throw a clear error if `RESEND_API_KEY` is missing.
- **Env:** `EMAIL_ADAPTER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on the **Resend-verified domain** (e.g. `no-reply@xfactoras.com`).
- **Verify:** trigger a password-reset for a real address → email arrives.

### B3. Auth-endpoint rate limiting (Stage 5)
- Reuse `SlidingWindowRateLimiter` (`apps/api/src/common/ratelimit/sliding-window.ts`) + `clientIpOf` (`apps/api/src/common/auth/client-ip.ts`) — **same pattern as `password-reset.service.ts`** (study it).
- Add limits (per-IP; for the login routes also per-IP+identifier) returning **429** before the handler runs, on: `POST /auth/login`, `/auth/refresh`; `/pf/auth/login`, `/pf/auth/refresh`, `/pf/auth/register`; `/client/auth/login`, `/client/auth/refresh`. Controllers: `apps/api/src/common/auth/auth.controller.ts`, `.../modules/personal-finance/auth/pf-auth.controller.ts`, `.../modules/client-portal/auth/client-auth.controller.ts`. Inject `@Req()` for the IP. Do NOT change the auth logic itself.

### B4. Cloudflare Turnstile on the quote form (Stage 5)
- **Marketing widget:** the quote form (`apps/marketing` — the QuoteForm component) renders the Turnstile widget using `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (only when that key is set) and copies the resulting `cf-turnstile-response` token into a cleanly-named `turnstileToken` field in the POST to `/api/quote`.
- **Verification is server-side at the API** (`apps/api/src/modules/client-portal/public-intake.service.ts`, `PublicIntakeService.submitQuote`), matching the authoritative-intake convention (the API — not the BFF — owns the real checks; the BFF only does best-effort honeypot + soft rate limit and forwards the multipart verbatim, so the token rides along). Before rate-limiting or any write, `submitQuote` POSTs the token to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `{ secret: TURNSTILE_SECRET_KEY, response: token, remoteip }`; on `success:false` (or a missing token, or any transport error) it rejects with a **generic 400** and never leaks Cloudflare's `error-codes`. When `TURNSTILE_SECRET_KEY` is unset (dev), verification is skipped entirely (parity with `AI_CAPTURE_PROVIDER=dev`). The BFF should still send the `x-intake-proxy: <PUBLIC_INTAKE_PROXY_SECRET>` header when forwarding.
- **API hardening** (`apps/api/src/modules/client-portal/public-intake.controller.ts`): when `NODE_ENV==='production'` and `PUBLIC_INTAKE_PROXY_SECRET` is set, **require** a matching `x-intake-proxy` header — reject (403) if absent/mismatched — so the captcha can't be bypassed by calling `/public/quote` directly. (Today it only uses that header to decide XFF trust.)

### B5. Blank-env defensive fix (Stage 5)
- Add a helper `envOr(name, fallback)` returning `fallback` when the var is missing **or empty/whitespace**, and use it where code reads config with `?? default` — especially `PUBLIC_LEAD_ORG_ID` in `public-intake.service.ts`. Prevents the `invalid uuid ""` class of failure (flag #10).

### B6. pg_dump backup (Stage 8)
- A scheduled GitHub Actions workflow `.github/workflows/db-backup.yml` (daily cron). Steps: `pg_dump "$SESSION_POOLER_URL" --no-owner --no-privileges | gzip | gpg --symmetric --batch --passphrase "$BACKUP_PASSPHRASE"` → upload as an artifact (or to an external bucket). Store `SESSION_POOLER_URL` + `BACKUP_PASSPHRASE` as GitHub repo secrets. Document the restore (`gpg -d | gunzip | psql`) and the between-runs data-loss window (Supabase free has no PITR).

## C. Seed & admin bootstrap (Stage 2 — exact, and safety-critical)
**What `pnpm db:seed` inserts (0002 + 0005):** the org `…0001` "FathomXO — Academic"; 9 system roles; representative permissions; **two real-partner parties Momin (`…c1`) + Emon (`…c2`)**; **four user accounts** (`sysadmin@`, `bizadmin@`, `momin@`, `emon@` `…fathomxo.local`) with placeholder hashes (`SEED_PLACEHOLDER_NOT_A_REAL_HASH` → **cannot log in** until a real password is set — fail-closed, safe); their role assignments; the **Data Steward** role; and **demo reference rows** "University of Example" (`…e1`) + "ICT 701" (`…e2`) + aliases.

**For THIS deployment** (the business *is* Momin + Emon), keep the org/roles/permissions, the Momin/Emon parties, the user accounts, and Data Steward. Only the demo reference rows are throwaway.

1. Run `pnpm db:seed`.
2. **Delete the demo reference data** (admin/owner connection):
   ```sql
   delete from ref_alias  where ref_id in ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2');
   delete from ref_entity where id     in ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2');
   ```
3. **DO NOT run `pnpm --filter @business-os/api seed:auth`** (it sets the well-known dev password `Password123!`).
4. **Set real admin identities + passwords without ever storing a known password:**
   - Point the seeded admin accounts at real emails (admin/owner SQL), e.g.:
     ```sql
     update user_account set email='YOU@yourdomain.com'     where id='00000000-0000-4000-8000-0000000000d1'; -- System SuperAdmin
     update user_account set email='partner@yourdomain.com' where id='00000000-0000-4000-8000-0000000000d3'; -- Momin / Admin
     -- (bizadmin …d2, emon …d4 likewise if used)
     ```
   - After Resend is live (Stage 3) and the API is reachable, use the **forgot-password flow** for each real email (`POST /auth/request-reset`) → click the emailed link → set the password. `status` defaults to `active`, so login is enabled. No human-known password is ever persisted by us.
   - (Alternative if you must set a password before email works: copy `seed-auth.ts` to a one-off script, swap `DEV_PASSWORD` for a strong generated value and target only your real email — then change it immediately via forgot-password once email works.)

## D. Stage 2 pass criteria (the trust gate)
Run §A's test block against Supabase on the **empty** DB (before §C seeding, or accept that the tests self-clean their own fixtures). Every suite must report `# fail 0`. The ones that prove visibility — `billing-http`/`referrers-http` (a party can't read a non-owned leg), `channels-http` (a partner can't be granted a margin-revealing share), `pf-isolation` (one PF account can't read another; a business token gets 401 on PF), `client-portal-http` (a client sees only their own status/AR, never writer/margin/chain) — are the gate. If any fails on Supabase, the production DB does **not** reproduce the model — STOP and diagnose (almost always a missing extension, a role/owner mismatch, or an unapplied migration), do not load real data.
