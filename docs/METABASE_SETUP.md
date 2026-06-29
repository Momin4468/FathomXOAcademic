# Metabase analytics setup (DESIGN_SPEC §8)

Embedded Metabase provides role-scoped dashboards + a SuperAdmin ad-hoc query/chart
builder. **It can never leak a figure a role can't see** because it reads the
database **only** as the read-only `analytics_ro` role over the redacted, aggregate
`analytics` schema of views (migration 0029) — never base tables, never the
GUC-scoped definers, never `pf_*`. Role-scoping is enforced by **locked
signed-embed parameters** the API mints (`GET /analytics/embed`), so a viewer can
never widen scope. This is the whole security model; everything below is wiring.

## 1. Bring up Metabase

```
docker compose up -d metabase
```

Open http://localhost:3000 and create the Metabase admin account (this is
Metabase's own user store, separate from Business OS logins). Metabase keeps its
own config in the bundled H2 DB (the `businessos_metabase` volume) for dev — use a
dedicated Postgres app-DB in production.

## 2. Add the business DB as a data source — as `analytics_ro` ONLY

Admin → Databases → Add database → PostgreSQL:

- Host `db` (in-compose) or your host, Port `5432`, Database `business_os`
- **User `analytics_ro`**, password = `ANALYTICS_RO_PASSWORD` (migrations create this
  role; default `analytics_ro_pw` — set a strong value in prod)
- This role can `SELECT` **only** the `analytics` schema views. It is denied every
  base table (`leg`, `payment`, `invoice`, `charge`, `pf_*`, `deal_term`,
  vault, …) — so even the ad-hoc query builder physically cannot reach a raw leg,
  a partner's private margin, or any personal-finance row.

Never connect Metabase as `postgres`, `app_user`, or any role with base-table
access.

## 3. Build the two dashboards on the `analytics.*` views

Available redacted views (all carry `org_id`; party-scoped ones also `party_id`).
**Money is exposed at the ORG level only** — per-party views carry no client
price / chain margin (a per-party money breakdown would reveal one partner the
other's private figure, since the views bypass RLS):

| View | Grain | Use |
|---|---|---|
| `analytics.org_net` | per **org** | revenue / writer_cost / net headline (org total) |
| `analytics.org_receivables` | per **org** | total invoiced / paid / due |
| `analytics.writer_cost` | per (org, writer) | jobs + writer **pay** (no revenue/net) |
| `analytics.settlement_position` | per (org, partner pair) | **shared** pool + transfers (never a private split) |
| `analytics.work_volume` | per (org, party) | job counts (no money) |
| `analytics.writer_reputation` | per (org, writer) | on-time/revision/fail/reliability (no money) |
| `analytics.expense_totals` | per (org, month, category, bearer) | spend |
| `analytics.party_balance` | per (org, party) | a party's own earnings/dues/net (**member dashboard only**) |

- **Owner dashboard** (`METABASE_DASHBOARD_OWNER`): org_net, org_receivables,
  writer_cost, settlement_position, expense_totals, work_volume,
  writer_reputation. Add a **Locked** filter `org_id` wired to **every** card.
- **Member dashboard** (`METABASE_DASHBOARD_MEMBER`): party_balance, work_volume,
  writer_reputation. Add **Locked** filters `org_id` **and** `party_id` wired to
  **every** card. A member sees only their own row. (Do NOT put `party_balance`
  on the owner dashboard — without a party lock it would list every party.)

For each dashboard: Sharing → Embed → set the `org_id`/`party_id` filters to
**Locked** → Publish. Copy the numeric dashboard ID from its URL.

> ⚠️ **A card published without its `org_id` (and, on the member dashboard,
> `party_id`) filter wired + Locked is a Sev-1 misconfiguration** — it would show
> cross-org (or cross-party) aggregates. The views deliberately carry no built-in
> org filter (the lock is the boundary), so every card MUST bind the locked param.

## 4. Enable signed embedding + set env

Admin → Settings → Embedding → enable **Static embedding**; the embedding secret
key is `MB_EMBEDDING_SECRET_KEY` (set in docker-compose from `METABASE_EMBED_SECRET`).

Set in `.env` (API + compose):

```
METABASE_SITE_URL=http://localhost:3000
METABASE_EMBED_SECRET=<the same >=32-char secret as MB_EMBEDDING_SECRET_KEY>
METABASE_DASHBOARD_OWNER=<owner dashboard id>
METABASE_DASHBOARD_MEMBER=<member dashboard id>
ANALYTICS_RO_USER=analytics_ro
ANALYTICS_RO_PASSWORD=<strong value, matches the Metabase data-source password>
```

Until these are set, `GET /analytics/embed` returns 404 and the web `/analytics`
page shows "Analytics isn't set up yet" — by design.

## 5. Ad-hoc explorer (System SuperAdmin)

The `/analytics` page shows an **Open ad-hoc explorer** button (System SuperAdmin
only) that links to the Metabase app, where the native query/chart builder runs
over the `analytics_ro` data source. Because that connection sees only the
redacted views, ad-hoc exploration is bounded by the same opacity guarantees — a
free-form SQL question still cannot reach a raw leg or a private split.

## Production: read replica

Point Metabase's data source at a streaming **read replica** instead of the
primary — using the **same `analytics_ro` role and `analytics` schema** (the
migration runs on the primary and replicates). No app/code change; the opacity
boundary is the role + views, identical on primary or replica.
