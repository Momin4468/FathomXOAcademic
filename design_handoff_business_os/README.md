# Handoff: X-Factor AS — Business OS

## Overview
An internal operations + finance platform for an academic-writing agency. It replaces a
sprawl of Excel sheets with one role-aware app covering: work intake (tasks, courses,
theses, projects), a client-centric money flow (client ledgers → invoices → a single
cashbook), a relationship/split-terms engine (Momin ↔ Emon ↔ vendors ↔ writers ↔
partners), governance via an approvals queue, and supporting modules (credential vault,
knowledge base, payroll, settings, and a private personal-finance plane).

The product identity is **X-Factor AS**: a dark ink-navy sidebar with a gold "X + scholar's
star" mark; light content canvas; Fraunces (serif display) + Inter (UI) type.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype
that shows the intended look, information architecture, and behavior. **They are not
production code to copy directly.**

- `Business OS v5.dc.html` is authored as a "Design Component" (a custom `<x-dc>` runtime
  with `{{ }}` template bindings and a `class Component` logic block). It depends on
  `support.js` (the prototype runtime). **Do not port `support.js` or the `.dc.html`
  wrapper into production** — they exist only to make the prototype run in a browser.
- Your task: **recreate these screens in the target codebase's environment** (React +
  TypeScript assumed, or whatever the app uses) with its established component library,
  router, data layer, and styling system. Build the backend from `reference/SCHEMA.md`.
- Treat the HTML as the **source of truth for layout, copy, colors, spacing, and interaction
  intent**. The logic class (state shape, derived values, role gating) is a faithful
  description of intended behavior — read it as a spec, not code to keep.

## How to read the prototype
Open `Business OS v5.dc.html` in a browser (loads Google fonts + `support.js` locally). Use
the **"Signed in as" switcher** at the top of the sidebar to change role (Momin / Emon /
Writer / Partner / Vendor / Client / Employee) — the nav and every screen re-scope to that
role. The whole app is one file: the `<x-dc>` template is the markup; the
`class Component extends DCLogic` block near the bottom holds all state + logic.

## Fidelity
**High-fidelity.** Colors, typography, spacing, density, and interactions are intentional.
Recreate closely using the codebase's libraries. You may refine individual screens where a
real data layer or framework affordance makes something better (real date pickers,
virtualized tables, server-driven pagination), but **keep the information architecture, the
role model, the money model, and the visual language intact.** When in doubt, match the
prototype. Flag any deviation from the IA or money model before proceeding.

## Design Tokens
**Colors**
- Ink navy (sidebar / dark surfaces): `#0B1020`; sidebar hover `#141B33`; sidebar border `#1C2542`; muted sidebar text `#5A6584` / `#AEB7CD` / `#9AA4BD`.
- Canvas background: `#F6F7F9`. Card surface: `#FFFFFF`. Card border: `#E2E6EC`. Hairline row border: `#F3F5F8` / `#EEF1F5`. Row hover: `#FAFBFC`.
- Primary text: `#0E1524`; secondary `#45506A`; tertiary/muted `#667085` / `#8A93A6`.
- **Gold accent (brand / primary action):** `#E8B64C`; hover `#F0D08C`; deep gold text/links `#B6822A` → `#8A5F1D`; gold gradient logo `#F6E2B3 → #E8B64C → #B6822A`.
- Semantic: success green `#157F3D` (bg `#E4F3EA`); danger red `#B42318` (bg `#FBE9E7`); warning amber `#8A5F1D` (bg `#FCF6E8` / `#FCF1DC`); info blue `#3353C4` (bg `#E8EDFB`); purple (cut/partner/loan) `#6D3FC4` (bg `#F0E9FB`).
- **Personal-Finance plane** uses a distinct private teal: `#0B3B33 → #0E5C50` gradient, accent `#7FE3CE`, `#0E7C6B`; account-type tints — mobile `#FCE9D6`/`#B4691A`, bank `#E8EDFB`/`#3353C4`, cash `#E4F3EA`/`#157F3D`, crypto `#EDE7FB`/`#6D3FC4`.
- Momin's private columns use a warm parchment: bg `#FBF7EC` / `#FFFDF6`, border `#EAD9AE`.

**Typography**
- Display / headings: **Fraunces** (serif), weights 500/600. Page titles ~24–26px/600.
- UI / body: **Inter**, weights 400/500/600/700. Base 13px; table cells 12.5px; uppercase eyebrows 10–11px with `letter-spacing: 0.06–0.14em`.
- Monospace for codes/IDs/trx: `ui-monospace, monospace`, ~11.5–12px/600.
- Numbers use `font-variant-numeric: tabular-nums` everywhere money/counts appear.

**Spacing / shape**
- Card radius 12px; pills/badges 999px; inputs/buttons 7–9px; modals 14–16px.
- Card padding 13–16px; table cells ~7–10px vertical / 10–16px horizontal.
- Shadows soft: `0 12px 32px rgba(11,16,32,0.16)` (popovers), `0 24px 64px rgba(11,16,32,0.35)` (modals).
- Currency BDT, formatted `৳12,345.00` (tabular). Dates **dd/mm/yyyy**.

## Global Frame
- **Left sidebar (224px, ink navy, collapsible):** brand lockup; "Signed in as" role switcher (popover); role-scoped nav **grouped by section** (every role, not just admin); footer note describing the role's visibility.
- **Top bar:** collapse toggle, global search, notification bell (dropdown + unread badge), gold **"+ New"** quick-add popover (task / client). ⌘K opens quick-add.
- **Content area:** max-width ~1160–1240px, screens fade in (`@keyframes rise`).
- **Toast:** bottom-center dark pill for confirmations.

## Roles & Visibility (core model — preserve exactly)
Seven roles, each with its own grouped nav and scoped data:
- **Momin (SuperAdmin/owner):** everything, plus **two private gold columns on Tasks** — the *real* client charge and *his extra margin* — invisible to Emon and the pool.
- **Emon (Admin):** his own clients/writers; sees the shared client price, never Momin's real price.
- **Writer:** own tasks + earnings; never sees client prices or margins.
- **Partner:** own profit-share + running balance only.
- **Vendor:** a mini-admin — brings work, has their own clients directory + statement; can't see our writer price or change our rate.
- **Client:** portal — their own account page only.
- **Employee:** salaried; logs work, no prices.

Visibility is **structural**, not cosmetic: intended production enforcement is Postgres
Row-Level Security (see `reference/SCHEMA.md`). Money figures (margins, balances, shares) are
**always derived at read time, never stored**. Money ledgers are **append-only** (corrections
are reversing entries). Everything money-affecting is attributable + audit-logged.

## Screens / Views
Each is a `<sc-if>` block keyed by `screen`; the logic's `renderVals()` computes its data.
Recreate each as a route/page.

1. **Dashboard** — role-shaped KPI cards + "due & overdue" list + "needs attention" panel.
2. **Pending** — quick due-task view (whiteboard killer); quick self/random task add.
3. **Tasks** — the core grid. Entry form has two modes: **Log a task** (single) and **Add course / thesis / project** (a parent bundle with sub-lines priced by parts + combined). Columns are role-dependent (writer sees fee only; admins see client ৳ + margin; Momin also sees private actual ৳ + extra). Per-row actions: assign clients, other-party cut, edit, delete. Bulk-select bar (invoice / mark paid / mark done / delete). Submission type **Individual/Group** at line level; group lines carry members + who-pays (each / one-pays-all / custom) + collect-as-one. **Discounts** (admin-only): amount or %, scope line/bulk, optional explicit writer-fee reduction (notifies writer), posts as its own ledger line. Optional per-task outcome fields (grade / on-time / revisions / complaint / AI %). Course/thesis/project saves as one expandable parent row (badges: COURSE/THESIS/PROJECT + GROUP + DISC).
4. **Completed** — done tasks (split from Tasks so lists scale to hundreds).
5. **Approvals** — multi-category queue (task / cash / client-balance / cut-change / knowledge) with filter chips, select-all, per-row + bulk approve/reject. Admin-approved = final.
6. **AI capture** — paste WhatsApp text → proposed records → human Accept (stamped "added by AI").
7. **Cashbook** — the single money ledger: in/out (dropdown), category (dropdown, admin-editable), counterparty, medium (dropdown; **Bank** reveals a bank-name field), optional Trx ID, amount, note. KPIs: Total in / Total out / Net in hand. Client payments recorded on a client page flow in automatically. Non-admin entries route to Approvals.
8. **Opening balances** — migration seam: any party (client/writer/vendor/partner/admin) with a direction (they-owe-us / we-owe-them). Admin-only.
9. **Checks** — plagiarism/AI checks logged + sold as a service (units, revenue, cost, account).
10. **Clients (directory)** — shared; name·university·student ID visible to all; **contact masked** unless admin/owner/granted; **"Added by"** column (admin-only); rows filtered to own+granted for non-admins; client **name links** to Client 360; SuperAdmin "add on behalf of" dropdown.
11. **Client 360** — Total/Paid/Remaining, ledger auto-pulled from the task pool, record-payment panel, **screenshot-ready invoice popup** built from selected ledger lines (replaces a separate invoices tab).
12. **Team & partners** — people directory; derived **balance**; row opens a **party detail page** (derived earned/paid/owed + reverse/edit/delete).
13. **Academic directory** — the academic source of truth: University · Program · Code · Reference format · Cover sheet. Powers task auto-fill + inline-create when logging work.
14. **Analytics** — KPIs, 6-month revenue-vs-payout bars, revenue-by-channel (leg split), top clients, writer leaderboard.
15. **Data** — Import / Export: working CSV export per ledger; import + backup controls.
16. **Knowledge** — blog-style articles; any user can submit → Approvals (knowledge) → admin publishes + sets audience.
17. **Vault** — credential store: Tool · Account · **Password (reveal eye + copy)** · Seats · **Shared with (admin-only)** · Note. Writers see only granted rows and never the shared-with list.
18. **Payroll (HRM)** — salaried staff, monthly runs; paying settles via the Cashbook (Salary category).
19. **Referrers** — standalone; row opens a read-only detail (referred works + owed); referrers don't log work.
20. **Channels** — web / facebook / partner sources; the split each triggers lives in Settings › Split terms.
21. **Settings (SuperAdmin)** — hub with tabs: Categories, Statuses, Mediums, **Split terms** (per party/relationship, effective-dated), Custom fields. The future-proofing layer.
22. **Users** — accounts (distinct from parties); invite / resend / reset-password / 2FA / deactivate.
23. **Roles** — role → module × action × scope permission matrix (roles are data, not an enum).
24. **Personal Finance** — a walled-off private plane (teal identity), invisible even to SuperAdmin. Tabs:
    - **Overview:** net-worth header, per-account balance cards, 6-month income-vs-spend chart, spending-by-category breakdown, loans mini-panel.
    - **Accounts:** one card per account (Bkash / Nagad / bank / cash / USDT…) with **initial balance**, a **live balance auto-computed from entries**, type, and **last-updated**; add / edit / remove; a **Reconcile** action (enter today's actual balance → the difference is booked as income "found" or expense "missing").
    - **Transactions:** full ledger with type badges (income/expense/transfer/loan), signed BDT amounts, edit + delete.
    - **Loans:** owed-to-me / I-owe summary + table (direction, party, lump-sum or monthly repayment + instalment + next due).
    - **Settings:** CRUD for accounts, account types (mobile/bank/cash/crypto), income & expense categories, loan parties.
    - **Add entry** (one modal for all four types): amount + **any currency with a rate → stored in BDT** (live preview); account picker (+ to-account for transfers); category (income/expense); loan fields (direction/party/repayment); **date defaults to today, editable**; every entry editable/deletable. All balances and totals are BDT.
25. **Profile & security** — profile fields + password management.

## Reusable "generic grid"
Most CRUD screens are driven by one config-driven table (`C[table]` configs in the logic).
Each config: columns (`k` key, `l` label, `a` align, `kind` money/mono/badge/derived,
`e` editable, `adminOnly`), optional stats cards, add-form, per-row actions. Inline edit uses
selects for enum columns (option-lists come from an `OPTS` map that Settings feeds).
Recreate as one reusable `<DataGrid config={...}>` — it's the backbone of ~15 screens.

## Interactions & Behavior
- Role switch re-scopes nav + every screen (no reload).
- Quick-add (⌘K / "+ New") popover; entry forms keyboard-friendly (Enter saves).
- Append-only ledgers show a **Reverse** action instead of edit/delete.
- Approvals: non-admin create → pending item; admin approve = final, then only admin edits.
- Masked contact shows "🔒 masked — request access" for non-privileged viewers.
- Modals dismiss on backdrop click: assign-clients (checkbox list capped to copy count + inline create), other-party cut (%, notify/approve), invoice popup, PF add-entry / add-account / reconcile.
- Toasts confirm every mutation. Animations 0.15–0.25s ease-out; keep subtle.

## State Management
The prototype keeps everything in one component's `state`. For production, map to server data
(tasks, clients, people, cashbook, dir, vault, knowledge, payroll, settings/OPTS, approvals,
and the PF sub-state: pfAccounts, pfEntries, pfCategories, pfAcctTypes, pfLoanParties) plus a
little UI state (selected role, expanded parents, open modals, form drafts, current screen).
Derived values (margins, balances, remaining, combined totals, cashbook net, **PF account
balances = opening ± entries**, **PF net worth**, loan outstanding) must be **computed**, not
persisted — mirror `renderVals()`.

## Data model
`reference/SCHEMA.md` is the intended Postgres model (spine tables + RLS + derived
read-models). `reference/business-user-stories-v1.md` is the roles/workflows analysis the
design was built from. Build the backend from SCHEMA.md; use the prototype for how each
concept surfaces in the UI. Where they differ, prefer the schema for storage and the
prototype for presentation — and flag the diff.

## Assets
- Fonts: **Fraunces** + **Inter** (Google Fonts) — swap for the codebase's font pipeline.
- Logo: inline SVG "X + scholar's star" gold mark (sidebar + invoice modal) — reuse or replace with the real brand asset.
- Icons: inline single-path SVGs in the `ICONS()` map — replace with the codebase's icon set (Lucide/Heroicons etc.); names map 1:1 to intent.
- No raster images or third-party assets.

## Files
- `Business OS v5.dc.html` — the full high-fidelity prototype (all screens + PF plane). Primary reference.
- `support.js` — prototype runtime **(reference only; do not ship).**
- `reference/SCHEMA.md` — intended Postgres schema + RLS + derived read-models.
- `reference/business-user-stories-v1.md` — roles, workflows, requirements analysis.

## Suggested implementation order
1. App shell (sidebar + role switch + top bar) and the reusable DataGrid.
2. Academic directory + Clients + Tasks (single, then course/group, then discounts).
3. Cashbook + Client 360 (ledger + record payment + invoice popup).
4. Approvals + role gating + derived balances (Team/Referrer detail).
5. Settings/Split-terms engine + per-task cut + relationship-driven money legs.
6. Vault, Knowledge, Payroll, Analytics, Data.
7. Personal Finance plane (accounts + reconcile + entries + loans + PF settings).
