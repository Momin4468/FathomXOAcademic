# apps/web UI Audit — against `docs/ui-reference-sheet.md`

**Date:** 2026-07-07 · **Scope:** the data-heavy app-side screens (invoices, payments, settlement, expenses, work items, clients, personal-finance). **Method:** each page read in full and checked against the reference sheet's field-level rules, data-table rules, form rules, and audit-trail rule. **Read-only audit — no code changed.**

> Note: the brief referenced `docs/reusable-deployment-playbook.md`, which does not exist in the repo. The governing reference is **`docs/ui-reference-sheet.md`** (the "Web / App UI Reference Sheet"), used here as the rubric.

Impact tags: **[High]** = causes data-entry error, silent data loss, a money-formatting/compliance failure, a destructive action with no real confirm, or free-typed dates. **[Medium]** = slows work or scannability (missing sort/filter/search/bulk/export/totals/pagination/sticky header, unsectioned forms, no inline validation). **[Low]** = polish (density toggle, monospace IDs, skeletons, breadcrumbs).

---

## 0. App-wide root causes (read this first)

The app-side UI is thin because **~8 shared primitives don't exist**, so every page re-implements a degraded version. Roughly 150 individual findings below collapse into these. Fix these once in `components/ui.tsx` and the bulk of the per-page gaps close.

| # | Missing primitive | Consequence (rubric rule broken) | Impact |
|---|---|---|---|
| R1 | **Money input control** (right-aligned, ৳ symbol, thousand separators, 2 decimals, no spinners) | Every money-entry field is a raw `<input type="number">` → spinner arrows, no separators, locale-parse risk. ≥13 fields: payments (record+allocate), settlement (transfer+fee), expenses (amount+split %), PF (income/expense, loans×2, savings×2, targets, subscriptions). | **High** |
| R2 | **DataTable** (sticky header, sortable cols, per-column filters, global search, row-checkbox bulk actions, pagination + total count, money column **totals**, CSV/Excel/PDF **export**, density toggle) | Every list is a plain `<ul>` of cards/links with none of these. This is the single biggest gap for a finance/ERP app. | **High/Med** |
| R3 | **ConfirmDialog / Modal** | Destructive/irreversible actions either have **no** guard (invoice supersede, move-line, work-state confirm, bill-to-invoice, PF archive on targets/subscriptions/categories) or use `window.prompt`/`window.confirm`, which do not properly gate the action (payment & settlement **reversals**). | **High** |
| R4 | **Unsaved-changes guard** (warn before leaving / `beforeunload` + route guard) | Every form silently discards entered data when its toggle is closed or the user navigates away. Violates the reference sheet's "**Never lose the user's work**." | **High/Med** |
| R5 | **Audit-trail display** (created-by / created-at / updated-by / confirmed-by) | The *person* is never shown on invoices, payments, settlement transfers, clients, or work items (only `created_at`/`confirmed_at` partially). Breaks the sheet's finance/HR audit rule **and** CLAUDE.md §4 provenance. | **High** |
| R6 | **Toast / Snackbar** | All success/error feedback is inline text; no consistent "instant feedback" channel. | **Med/Low** |
| R7 | **Money display consistency** | Two different formatters (`formatMoney` ৳ vs PF `pfMoney`), both `minimumFractionDigits: 0` → **2 decimals not forced** (`৳1,500`, not `৳1,500.00`); negatives/outflows **never** shown red or in parentheses; not consistently right-aligned in columns. | **Med** |
| R8 | **Layout & navigation shell** | Body is a narrow `max-w-3xl` (cramped for wide money tables); nav is a ~20-link horizontal overflow-scroll bar with no grouping, active state, or sidebar. No breadcrumbs anywhere. | **Med** |
| R9 | **In-app notification system** (bell + unread badge + panel + mark-read + pop-ups) | There is **no** notification UI *or* backend anywhere (verified in `BUSINESS_MODEL_AUDIT.md` §3.15 — no `notification` table/service, no bell/unread/toast in `apps/web`). This is both the UI half of the business requirement for an **admin broadcast → everyone / a custom set / a whole role**, and the natural home for the R6 Toast channel. Net-new: notifications module + `notification` table + bell/panel/pop-up UI. | **Med** |

> **Cross-reference (added 2026-07-07):** R6 (no Toast) and R9 (no notification system) reinforce each other and a business requirement — see `docs/BUSINESS_MODEL_AUDIT.md` §3.15 and P1 item 7. Building the notification system delivers both the in-app feedback channel (R6) and the admin-broadcast feature in one module.

**What already works (keep it):** `DateInput`/`DateTimeTzInput` are real native pickers (tasks deadline with timezone is exemplary); `StateBadge` is correctly color-coded (paid=green, void=red, draft=gray) and used on work/invoice/money states; `EntityPicker` (pick-don't-type) is used in work/new; `Money` is redaction-safe (absent ⇒ renders nothing, RLS-safe); `EmptyState` is used widely.

---

## 1. Invoices

### `invoices/page.tsx` (list + create)
- **[High]** The list (`<ul>`, lines ~101–120) shows **no money at all** — no invoice total, paid, or due column — only client name + date + status. A finance invoice index you can't scan for amounts.
- **[Medium]** No table affordances (R2): no sticky header, no sortable columns, no per-column filters, no column totals, no pagination + total count.
- **[Medium]** No global search — only two coarse filters (client picker + status select). No Export button (R2).
- **[Medium]** No row checkboxes / bulk actions (R2).
- **[Medium]** Create form (lines ~64–76) is not grouped into fieldsets, no inline/on-blur validation, no required `*` on the Client field; `isEstimate` is a raw `<input type="checkbox">` rather than a shared control.
- **[Low]** Loading is text-only `Spinner` (no skeleton rows); no breadcrumbs; invoice IDs never shown (no monospace reference).

### `invoices/[id]/page.tsx` (detail)
- **[High]** No audit trail (R5): shows only `created {date}` (+ optional `issued`); no created-by / updated-by / confirmed-by on a financial record.
- **[High]** "Create final from estimate" (`supersede`) is irreversible with **no confirmation** — it POSTs and navigates away on one click.
- **[High]** "Move" line action moves a billable money line between invoices on a single `<select> onChange` with **no confirm** — an accidental selection moves money with no undo.
- **[Medium]** Invoice lines are read-only `Card`s, **not an editable line-item table**; no add/edit/remove, no right-aligned money columns, and **no grand total / total paid / total due** even though each line carries amount/paid/due (R2 totals).
- **[Medium]** Money values laid out in a wrapping flex row, not right-aligned in aligned columns (R7).
- **[Low]** No breadcrumb (only a back-link); invoice ID not shown as monospace; no skeleton.

---

## 2. Payments

### `payments/page.tsx` (list + record)
- **[High]** Amount captured via `<input type="number" step="0.01">` (line ~86) — spinner arrows, no separators, no right-align, no ৳ (R1).
- **[Medium]** Payments list is a plain `<ul>` (lines ~130–156): no sticky header, no sortable columns, no per-column filters, no global search, no row-checkbox bulk actions, no pagination/count, **no column total** for the amount column, no Export (R2). Only a single counterparty filter + empty state exist.
- **[Medium]** Amounts sit in a `justify-between` flex row, not column-aligned/tabular, and have no running total (R7).
- **[Medium]** Record form is one flat block — no grouped sections; no on-blur validation; no required `*`; no unsaved-changes warning (form dismissable via toggle, discards input) (R4).
- **[Low]** ✅ Date uses `DateInput` with a today default; direction uses a color-coded `Badge`. "Paid on" has no format hint.

### `payments/[id]/page.tsx` (detail + allocate)
- **[High]** **Reverse payment** (append-only ledger reversal) is gated only by `window.prompt` for a reason (line ~146) — cancelling the prompt does not clearly abort; no real confirm/cancel gate (R3).
- **[High]** Allocation amount inputs are `<input type="number">` (lines ~224–227) — spinner arrows on money (R1).
- **[High]** No audit trail on the payment record (amount/direction/counterparty/date/medium/trxId shown, but no created-by/created-at) (R5).
- **[Medium]** Allocation targets are individual `Card`s, not a table; amounts aren't column-aligned and — critically — **the entered allocations are not summed/totalled** (only a header "remaining to allocate" is shown) (R2/R7).
- **[Low]** ✅ Allocate button disabled when over-allocated / empty, clamps to due on blur; the split-across-jobs hint supports bulk allocation intent.

---

## 3. Settlement

### `settlement/page.tsx`
- **[High]** Transfer amount is `<input type="number" step="0.01">` (line ~157) — spinner arrows on money (R1).
- **[High]** **Reverse transfer** (irreversible ledger action) gated only by `window.prompt` — same non-gating defect as payment reversal (R3).
- **[High]** No audit trail on transfer records (from→to/date/medium/amount shown, no created-by/created-at) (R5).
- **[Medium]** Transfers list is a plain `<ul>`: no sticky header, no sort, no filters, no search, no bulk, no pagination/count, **no column total** of transfer amounts, no Export (R2).
- **[Medium]** The Position card's money figures (pool, net, per-party accrual) are left-aligned under labels, not right-aligned for numeric comparison (R7).
- **[Medium]** Record-transfer and apply-fee forms have no on-blur validation, no required `*`, and no unsaved-changes guard (partner-pair change silently resets in-progress entry via `key`) (R4). Two simultaneous submit buttons blur the single-primary-action rule.
- **[Low]** ✅ Dates use `DateInput` (today default); settled/owes uses a color-coded `Badge`. Currency symbol hard-coded in the label rather than an input adornment.

---

## 4. Expenses & Work items

### `expenses/page.tsx`
- **[High]** Expense amount is `<input type="number">` (line ~119) — spinner arrows, no ৳/separators on the primary money-entry field (R1).
- **[High]** Split percentages (`splitMomin`/`splitEmon`) are `<input type="number">` with **no validation that the split sums to 100** — an invalid 60/60 split can be submitted.
- **[High]** No unsaved-changes guard — the form toggle "Close" discards an in-progress expense; no discard confirm (R4).
- **[Medium]** Expenses list (`<ul>`, lines ~176–195): no sticky header, no sort, no filters, no global search, no bulk, no pagination/count, **no column totals** (only one header aggregate that mixes currencies), no Export (R2).
- **[Medium]** Amount rendering is inconsistent between currencies: BDT rows use `<Money>` (tabular), non-BDT rows use a different `formatMoney(x.amount,"")` path — different alignment/format guarantees (R7).
- **[Medium]** No on-blur validation; only `disabled={!form.amount}`; conditional fields (campaignTag, nextDueDate) not required-enforced.
- **[Low]** No required `*` marks; fields in one flat grid rather than labeled fieldsets.

### `components/WorkList.tsx` (work item list)
- **[Medium]** Plain `<ul>` of links (lines ~20–31): no sticky header, no sortable columns, no filters, no global search, no bulk, no pagination (R2). Count shown but no money totals, no Export.
- **[Low]** Rows show only title + work-state badge; money-state and created-by/at not surfaced in the list. ✅ `StateBadge` used correctly.

### `work/new/page.tsx` (create)
- **[High]** **Deadline is free-typed** into the "Detail" textarea (placeholder "due Fri") — unstructured, no timezone — instead of `DateInput`/`DateTimeTzInput` (R2/dates rule).
- **[High]** No editable **line-item** entry — work "is composed of lines" (copies / mixed-rate / multi-writer splits, CLAUDE.md rule #6) but the form captures only header fields; lines can't be entered.
- **[High]** No unsaved-changes guard — "Cancel" calls `router.back()` and discards title/details/picked entities (R4).
- **[Medium]** Long single-column form, no grouped fieldsets ("Classification" vs "Parties"), no stepper; on-blur validation only on Title.
- **[Low]** ✅ Uses `EntityPicker` for course/type/client/writer (pick-don't-type). No required `*` on Title.

### `work/[id]/page.tsx` (detail)
- **[High]** "Bill to invoice" is a money-mutating action with **no confirmation** — one click posts the line to the client's open invoice irreversibly (R3).
- **[High]** State transitions incl. **Confirm** (governance draft→pending→confirmed→delivered) fire on one click with no confirm (R3).
- **[Medium]** Audit trail partial (R5): created-at/confirmed-at shown, but **created-by / confirmed-by (the person)** not — governance needs the actor.
- **[Medium]** Lines are read-only cards; no add/edit/delete line surface, no destructive-delete confirm (R2).
- **[Low]** ✅ `StateBadge` for both work- and money-state; `Money` right-aligned and RLS-safe (renders only when present).

### `tasks/page.tsx`
- **[Medium]** Task list is urgency-bucketed cards: no sticky header, no sort, no filters, no global search, no bulk, no pagination, no Export (R2) — though bucketing gives some structure.
- **[Low]** No unsaved-changes guard on the add-task form; no required `*` on Title. ✅ **Exemplary**: deadline uses `DateTimeTzInput` with a format hint and renders due time in the viewer's timezone with the original zone annotated (the dates rule done right); urgency via color-coded `Badge`.

---

## 5. Clients

### `clients/page.tsx` (directory)
- **[Medium]** Only a single free-text **name** search (`&q=`); no filters by status/type/university and no global search across fields (R2).
- **[Medium]** No result/total count shown; no pagination or load-more — `parties?type=client` is fetched unbounded and all rows rendered.
- **[Medium]** Status not shown while scanning — rows render only `partyType` via a generic gray `Badge`, not a color-coded status badge (active/lead/invited).
- **[Low]** Info-poor card rows (name + type only; no balance/status column); no "New client" create entry point on the directory (capture-first gap); search has no debounce/clear; bare empty state with no CTA.

### `clients/[id]/page.tsx` (client 360)
- **[High]** No audit trail on the client record (R5): displayName/types/university/programme/referredBy shown, but no created-by / created-at / updated-by / modified-on.
- **[High]** View-only with **no edit/deactivate** and **no create/edit-client form anywhere** on the client surface — so the entire forms rubric (fieldsets, inline validation, required `*`, unsaved-changes guard, single primary action, confirm-on-destructive, EntityPicker for university/course) is unmet for clients.
- **[Medium]** Money format delegated to `BalanceView`/`Money`; per the systemic R7, that path is not forced to 2 decimals and has no red/paren negatives.
- **[Medium]** University/programme shown as free-text canonical strings with no link to the reference entity and no picker anywhere.
- **[Medium]** The client's invoice rows show only date + status — **no invoice number and no amount** — a poor AR view.
- **[Low]** ✅ Cross-module links present (→`/work/{id}`, →`/invoices/{id}`, →Vault). ✅ Credentials shown as metadata-only with "reveal in Vault" (visibility-safe). Outcomes fetched unscoped then filtered client-side (perf polish).

---

## 6. Personal finance

`income/page.tsx` and `expenses/page.tsx` are 11-line wrappers around `PfEntryManager`; all findings live in the components below. This module is meant to feel like a polished budget app (fast entry first), so it's judged harder.

### `components/PfEntryManager.tsx` (income + expense entry & list)
- **[High]** Amount + converted-amount are `<input type="number">` (lines ~83, ~94) — spinner arrows, locale-parse risk (R1).
- **[High]** Money not right-aligned — amounts in a `justify-between` flex row with `tabular-nums` but no shared right edge; rows don't align for scanning (R7).
- **[High]** Delete actually **reverses** (append-only) but the button is labeled "delete" and gated only by `window.confirm` — confusing + no in-app confirm (R3).
- **[Medium]** 2 decimals not forced (`pfMoney` `minimumFractionDigits: 0`) → `৳1,500` not `৳1,500.00` (R7).
- **[Medium]** Outflows not shown red/parenthesised — only a hue tint distinguishes expense from income; no sign (R7).
- **[Medium]** List is a `<ul>` — no column headers, no sticky, no sort, no filters (category/date/currency), no search, no bulk, no pagination/count, **no period total**, no Export (R2).
- **[Medium]** Entry form is a flat grid — no big amount field, no quick category **chips** (category is a plain `<select>`), not keyboard-first; capture-first goals unmet.
- **[Medium]** No on-blur validation / required marks beyond `required` on amount.
- **[Low]** No unsaved-changes guard; multi-currency original-vs-converted only weakly distinguished; no created-by/at surfaced.

### `loans/page.tsx`
- **[High]** Principal (line ~72) and event Amount (line ~156) are `<input type="number">` (R1).
- **[High]** `reverse` uses `window.confirm` only; no in-app ConfirmDialog on the destructive "reverse" link (R3).
- **[Medium]** Outstanding/principal not forced to 2 decimals (R7); card `<ul>`, not a table — no sort (by outstanding/due), no filter (given vs taken/overdue), no search by counterparty.
- **[Medium]** No totals (total lent / borrowed / net outstanding), no pagination/count, no bulk, no Export (R2). Add-loan form flat/unsectioned, no on-blur validation / `*`.
- **[Low]** Lent vs borrowed not color-signed (only a badge); no unsaved-changes guard.

### `savings/page.tsx`
- **[High]** Target amount (line ~57) and movement Amount (line ~140) are `<input type="number">` (R1).
- **[High]** `reverse` movement gated only by `window.confirm`; no in-app confirm (R3).
- **[Medium]** Balance/target not forced to 2 decimals; withdrawals not red/parenthesised (only a badge) (R7). Card `<ul>`, not a table — no sort/filter/search.
- **[Medium]** No "total saved across pots" total, no pagination/count, no bulk, no Export (R2); forms flat, no on-blur validation / `*`.
- **[Low]** No unsaved-changes guard.

### `targets/page.tsx`
- **[High]** Amount (line ~84) is `<input type="number">` on a budget-cap field (R1).
- **[High]** **Archive** fires immediately on click with **no confirmation at all** (not even `window.confirm`) (R3).
- **[High]** Percentage rule failure — progress shows `{pct}%` as plain text; there is no right-aligned, `%`-suffixed percent field/column anywhere (reference sheet wants % suffix + right-align for targets).
- **[Medium]** Target money not forced to 2 decimals; over-budget shown as "· over!" text + a rose bar rather than a red remaining number (R7). Card `<ul>` — no sort, no filter by kind/period, no search, no totals row, no pagination/count, no bulk, no Export (R2). Add form flat, no on-blur validation / `*`.
- **[Low]** No unsaved-changes guard.

### `subscriptions/page.tsx`
- **[High]** Amount (line ~73) is `<input type="number">` (R1).
- **[High]** **Archive** fires immediately with **no confirmation** (R3).
- **[Medium]** Amount not forced to 2 decimals (`৳9.9` not `৳9.90`) and not right-aligned into a column (R7). Bordered `<ul>`, not a table — no sort (amount/next-due), no filter (active/archived/due-soon), no search, no **monthly-spend total**, no pagination/count, no bulk, no Export (R2). Add form flat, no on-blur validation.
- **[Low]** No true status badge (active/paused/cancelled) — only a "due …" amber badge; reminder result is ephemeral inline text (no Toast).

### `categories/page.tsx`
- **[High]** **Archive** fires immediately with **no confirmation** — archiving a category can orphan/relabel entries (R3).
- **[Medium]** No search/filter over categories (fine at small counts, unscalable).
- **[Low]** Add form no on-blur validation (button gates on `!name.trim()`, adequate); free-typed category names are by-design for user-owned personal categories (not a violation).

---

## 7. Prioritized backlog (whole app)

Ordered by impact-per-effort. Because most findings are the same ~8 root causes repeated, **fixing the shared primitives (P0/P1) closes the majority of the ~150 line-items at once.**

### P0 — money correctness, data loss, destructive-action safety (High, do first)
1. **R1 — Build a `MoneyInput` control** (right-aligned, ৳ adornment, thousand separators, forces 2 decimals, **no spinners**, string-safe parse) and replace every `<input type="number">` money field (payments, settlement, expenses, all PF pages, split %). ~13 fields.
2. **R3 — Build a `ConfirmDialog`** and gate every destructive/irreversible action: payment & settlement **reversals** (replace `window.prompt`), invoice supersede & move-line, work-state **Confirm** + bill-to-invoice, PF **archive** (targets/subscriptions/categories) and reversals. 
3. **R4 — Add an unsaved-changes guard** (`beforeunload` + in-app route guard hook) and wire it into every create/edit form. "Never lose the user's work."
4. **R5 — Surface the audit trail** (created-by / created-at / updated-by / confirmed-by) on invoices, payments, settlement transfers, work items, and clients. Data already exists per CLAUDE.md §4; it's just not rendered.

### P1 — scannability & throughput (High/Medium)
5. **R2 — Build a `DataTable`** (sticky header, sortable columns, per-column filters, global search, row-checkbox bulk actions, pagination + total count, money **column totals**, **CSV/Excel/PDF export**, density toggle) and adopt it on: invoices, payments, settlement, expenses, work list, clients, and all PF lists. Add money **totals** to invoice detail (grand/paid/due) and payment allocation (sum of allocations).
6. **Editable line-item tables** where the domain is line-based: invoice lines, work lines (create + detail — CLAUDE.md rule #6), payment allocations.
7. **R7 — Unify money display**: one formatter, force 2 decimals, render negatives/outflows in red or parentheses, right-align in every column. Fold `pfMoney` and `formatMoney` into one.
8. **Fix `work/new` deadline** — replace the free-typed "due Fri" note with `DateTimeTzInput` (structured date + timezone).

### P2 — structure, consistency, polish (Medium/Low)
9. **R8 — Layout & nav shell**: widen the data-table pages beyond `max-w-3xl`; replace the 20-link overflow nav with a grouped sidebar + active state; add breadcrumbs.
10. **Sectioned forms + inline (on-blur) validation + required `*`** across every form; single clear primary action.
11. **PF capture-first entry**: big amount field + quick category **chips** + keyboard-first flow in `PfEntryManager`; subscription status badges; percent field (`%` suffix, right-align) for targets.
12. **R6 — Toast/Snackbar** for consistent success/error feedback; skeleton loaders in place of text `Spinner`; monospace IDs; client directory: status badge, result count, "New client" CTA, filters.

### Tally
Raw counts across the seven page groups (many are the same systemic issue repeated): **~38 High · ~74 Medium · ~42 Low**. De-duplicated, they are the **8 root causes** in §0 — the P0/P1 items above are the highest-leverage fixes.
