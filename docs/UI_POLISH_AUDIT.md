# apps/web UI Polish Audit — second pass (beyond the 8 root causes)

> **Update 2026-07-09 — all [Review] items now CLOSED (Phase A).** The recommendations left un-applied in the original pass below were subsequently implemented. Summary of what landed:
> - **Responsive fixed widths (§0/§2):** `outcomes` writer picker (`w-56`→`w-full sm:w-56`), `hrm` Job ID (`w-40`→`w-full sm:w-40`), payments-detail allocation input (`w-32`→`w-24 shrink-0 sm:w-32`). The DataTable search went `w-56`→`w-full max-w-xs sm:w-56`. **checks money inputs were already responsive** (Field/grid cells, `w-full` MoneyInput) — no change needed.
> - **Portal money grid (§4):** `grid-cols-3`→`grid-cols-1 sm:grid-cols-3` (stacks < sm).
> - **DataTable dense chrome (§1):** a considered bump, deliberately below a blind 44px to preserve table density — toolbar/pagination/Clear buttons `px-2 py-1`→`px-2.5 py-1.5` / `px-3 py-1.5` (~32px tap floor), search `min-h-[38px]`→`min-h-[40px]`, per-column filter inputs `min-h-[30px]`→`min-h-[34px]`.
> - **EntityPicker items (§1):** result + create rows now `min-h-[44px]` (flex-centered) — hits the touch target with no visible layout shift.
> - **Emerald contrast (§0/§3):** emerald-700 verified — passes AA on white (~4.85:1; KPI values are large text needing only 3:1). Small `text-xs`/`text-sm` emerald status text on the emerald-*tinted* PF background (connect link, connect/subscriptions/notes “Saved” messages) bumped `emerald-700`→`emerald-800` for clear AA headroom on small text.
> - **PfCharts polish (§3):** per-slice `<title>` tooltips on the donut (and income/expense bars); `<320px` behaviour verified safe (donut `w-full max-w-[180px]` scales via viewBox, bars use `overflow-x-auto`); PF settings sticky save bar got `env(safe-area-inset-bottom)` bottom padding.
> - **Icon system (§0):** the 5 ad-hoc emoji-as-icon (🔔 ☰ ✕ ✨ ★) replaced with **lucide-react** (`Bell`/`Menu`/`X`/`Sparkles`/`Pin`), preserving every `aria-label`/`aria-hidden`. `✓` in “Saved ✓” labels left as inline text (not an icon-button).
> - **Card section-label → heading (§0/§5):** the recurring `<p className="…uppercase tracking-wide…">` card mini-heading pattern converted to `<h2>` across 25 sites (classNames byte-for-byte preserved). Skipped: the three portal Billed/Paid/Amount-due labels (inline datum labels, not section headings), the AppShell nav-group label (navigation, not content), and the NotificationBell popover composer label.
>
> Verified: web build clean, web unit tests 18/18. Left uncommitted for review.


**Date:** 2026-07-09 · **Scope:** every app-side screen + shared components in `apps/web` (business plane, personal-finance plane, auth/portal). **Method:** a broader UI/UX/CSS best-practices sweep — accessibility, responsive/touch, consistency, form conventions, semantic HTML — *after* the UI_AUDIT.md 8 root causes (R1–R9) were shipped. Read-only exploration + a **safe-fix pass**. Compared against the repo's existing conventions in `apps/web/src/components/ui.tsx` (controls: `min-h-[44px]`, `rounded-lg`, `border-gray-300`, focus `focus:border-gray-900 focus:ring-1 focus:ring-gray-900`, `text-sm`, gray palette; `Field` wraps a `<label>`; `Money`/`StateBadge`/`Spinner`/`EmptyState`/`ErrorNote` shared). Tailwind config is bare (no custom tokens) — "tokens" = these conventions.

## Classification key
- **[Safe]** — an a11y/contrast/focus/label/touch-target/semantic win applied directly this pass using existing components/classes; no behavior/layout change, no taste judgment. **All [Safe] items below were applied.**
- **[Review]** — changes layout/structure, is a subjective visual choice, or touches a money-critical flow. **Reported as a recommendation only — NOT applied.**

## TL;DR
The app is already in good shape on the fundamentals the primitive work established: `<main>`/`<nav>` landmarks, `<form>` wrappers, `<Field>`-labelled inputs, dialog `role="dialog"`/focus-trap, SVG charts with `role="img"`, and login/reset forms with `type=password` + `autoComplete`. The remaining gaps cluster into a handful of **repeated patterns** — the biggest being **no keyboard focus indicator on non-form-field controls** (only `Input`/`Textarea`/`Select` had a focus ring). The [Safe] pass fixes those systemically; the [Review] list is small and mostly responsive-width / colored-contrast / chart-polish judgment calls.

---

## §0 — Systemic patterns (cross-page)

- **[Safe] No keyboard focus indicator on non-form controls.** Only `ui.tsx` `Input`/`Textarea`/`Select` carried `focus:ring`; the shared `Button` (`ui.tsx` Button) and **every raw `<button>`/link** were invisible to keyboard users — DataTable toolbar/pagination/clear/sort (`DataTable.tsx:225–230,239,360–362`), EntityPicker items (`EntityPicker.tsx:83,116,128`), NotificationBell items (`NotificationBell.tsx:87,106`), PfShell links (`PfShell.tsx:43`), PF settings toggles (`settings/page.tsx:94,125`), PfQuickAdd FAB, notes, portal. **Fixed once** with a scoped `:focus-visible` rule in `apps/web/src/app/globals.css` targeting `a, button, [role="button"], summary, [tabindex]:not([tabindex="-1"])` (form fields excluded — they keep their ring, so no double outline; mouse clicks don't trigger `:focus-visible`).
- **[Safe] Borderline secondary-text contrast.** `text-gray-400` for meaningful secondary text is borderline WCAG AA on white. Bumped to `gray-500` in the shared components so it propagates app-wide: `Field` hint (`ui.tsx:244`), `Spinner` (`ui.tsx:288`), `EmptyState` hint (`ui.tsx:294`). Left `gray-400` on decorative adornments (the ৳/% symbols in `MoneyInput`/`PercentInput`).
- **[Safe] Required-field markers.** Required fields showed no `*`. Added an optional `required?` prop to the shared `Field` (`ui.tsx`) that renders a muted `*`; applied on the genuinely-required fields (payments Amount, work/new Title, invoices Client, knowledge Title, PfEntryManager Amount).
- **[Safe] Stray input focus styles** diverged to `focus:border-gray-400` with no ring — aligned to the `gray-900 + ring` convention: DataTable filter inputs (`DataTable.tsx:283,293`), NotificationBell broadcast composer (`NotificationBell.tsx:162,170`).
- **[Safe] Action-column buttons lacked accessible names** — bare-word/emoji `<button>`s (archive/reverse/delete/copy, the PfQuickAdd `✨` AI button which had **none**) got concise `aria-label`s.
- **[Review] Emoji-as-icon** (🔔 ☰ ✕ ✨ ★) with no shared icon system — adopting an icon set (shadcn/lucide) is a deferred design decision, not a bug. Each emoji glyph is already `aria-hidden` with a labelled parent where it's a control.
- **[Review] `text-gray-400` on `emerald-50/40` backgrounds** (PfShell / PF dashboard tones) and **emerald-700 KPI text on white** — verify against AA; a visual judgment.

---

## §1 — Shared components (`components/`)

- **[Safe]** `ui.tsx` `Button` (`:17`), and all raw buttons/links across shared components — no `:focus-visible`. → global focus rule (§0).
- **[Safe]** `ui.tsx` `Field` hint `:244`, `Spinner` `:288`, `EmptyState` hint `:294` — `gray-400` → `gray-500`.
- **[Safe]** `ui.tsx` `Field` — added `required` marker support.
- **[Safe]** `DataTable.tsx:283,293` filter inputs + `NotificationBell.tsx:162,170` composer — focus style aligned to convention.
- **[Review]** `DataTable.tsx:220` search input `min-h-[38px]`, toolbar/pagination buttons `px-2 py-1 text-xs` (~28px), filter inputs `min-h-[30px]` — below the 44px touch target. Bumping trades table density; recommend a considered size rather than forcing 44px on dense table chrome.
- **[Review]** `EntityPicker.tsx:116` dropdown items `py-2` (~40px) — borderline touch target; `py-2.5`/`py-3` would hit 44px (minor layout shift).
- **Verified good (no action):** `confirm.tsx` dialog (role/aria-modal/focus-trap/focus-return, `aria-invalid`+`aria-describedby` on the reason field); DataTable `aria-sort`/`role=button`/`tabIndex` on sortable `<th>`, `aria-label` on checkboxes; AppShell hamburger/drawer `aria-label` + `aria-current`; toast `role=status aria-live`; NotificationBell bell `aria-label`; `Money` null-hiding + signed negatives.

## §2 — Business / finance pages

- **[Safe]** `invoices/page.tsx` create form — "Client" `required`. (The "estimate" checkbox was **already** correctly wrapped in a `<label>` — verified, no change.)
- **[Safe]** `payments/page.tsx:91` — "Amount" `required`.
- **[Safe]** `expenses/page.tsx` — "Run reminders" success message wrapped `aria-live="polite"`.
- **[Safe]** `settlement/page.tsx` — "Applied platform fee." message wrapped `aria-live="polite"`.
- **[Safe]** `work/new/page.tsx` — "Title" `required`.
- **[Safe]** `knowledge/page.tsx` — "Title" `required`.
- **[Safe]** `vault/page.tsx` copy button — `aria-label="Copy to clipboard"`.
- **Verified already-correct (no change):** `resit/page.tsx` both checkboxes are already `<label>`-wrapped; `vendor/me/page.tsx` handoffs list is a `DataTable` (empty handled internally via `emptyTitle`/`emptyHint`), same as claims.
- **[Review]** `outcomes/page.tsx:94` (`w-56` picker), `hrm/page.tsx:96` (`w-40` Job ID), payments allocation `w-40` / `checks:232` `w-32` money inputs — fixed widths that can crowd `<360px`; make responsive (layout change).
- **[Review]** `invoices/page.tsx` — implicit-required client picker (now marked `*`); no further change.
- **Verified good:** Spinner + ErrorNote present on every data fetch; DataTable-based lists (`clients`, `tasks`, `hrm`, `vendor-admin`) handle empty internally; all forms use `<form>` + `<Field>`; Button (`min-h-[44px]`) keeps page-level buttons at target even at `text-xs`; correct `h1→h2` hierarchy on multi-section pages (checks, channels).

## §3 — Personal Finance (`personal-finance/*`, `PfEntryManager`, `PfShell`, `PfQuickAdd`, `PfCharts`)

- **[Safe]** `PfEntryManager.tsx` — "Amount" `required`; the reverse action button `aria-label="Reverse entry"`.
- **[Safe]** `PfQuickAdd.tsx` — the AI `✨` button `aria-label="Generate with AI"` (had none); currency `<select>` `aria-label="Currency"`; date input `aria-label="Date"`.
- **[Safe]** `targets` / `subscriptions` / `categories` — archive buttons `aria-label`ed.
- **[Safe]** `loans` / `savings` — reverse buttons `aria-label`ed.
- **[Safe]** `settings/page.tsx` — focus rings now visible on the week/month/custom + currency toggle buttons (via §0). (The "Subscription reminders" control is a `role="switch"` Toggle with `aria-checked` — already accessible, verified.)
- **[Safe]** `notes/page.tsx` search input `aria-label="Search notes"`; `notes/[id]` title/body inputs `aria-label`ed.
- **[Safe]** `subscriptions/page.tsx` — reminders result message `aria-live="polite"`.
- **[Review]** `page.tsx` (PF dashboard) emerald-700 KPI tones on white; `PfShell.tsx:31` text on `emerald-50/40` — contrast check.
- **[Review]** `PfCharts.tsx` — per-slice `<title>` tooltips for the donut; behavior `<320px`; zero-line/legend contrast on the emerald background (chart polish; charts already have `role="img"`+`aria-label`).
- **[Review]** `settings/page.tsx:104,153` inline `w-16` number inputs (not `min-h-[44px]`); `settings:195` sticky save bar lacks safe-area-inset on mobile (layout).
- **Verified good:** all auth-adjacent PF forms have `type=password`/`autoComplete`; `notes/[id]` colour buttons `aria-label` + focus ring; PfQuickAdd sheet `role=dialog`.

## §4 — Auth / Portal

- **[Safe]** `login/page.tsx`, `personal-finance/login/page.tsx`, `portal/login/page.tsx` — TOTP inputs got `autoComplete="one-time-code"` (email/password autocomplete already correct).
- **[Safe]** `portal/messages/page.tsx` — message input `aria-label="Write a message"`; the chat container made a `<ul>`/`<li>` (announced list) — or `role="log" aria-live` where conversion was awkward.
- **[Review]** `portal/page.tsx:59` — the 3-column money summary `grid-cols-3` doesn't stack on mobile → `grid-cols-1 sm:grid-cols-3` (layout change).
- **[Review]** `portal/messages/page.tsx:58` — `max-h-[60vh]` scroll container interaction with the mobile keyboard (test on device).
- **Verified good:** every auth/portal form uses `<Field>` labels + correct `type`/`autoComplete`; reset forms use `autoComplete="new-password"`; `<main>` landmark present.

## §5 — Home (`page.tsx`)

- **[Safe]** The section labels rendered as `<p className="…uppercase tracking-wide…">` (Outstanding client dues, Business margin, Profit per writer, Clients owing, My numbers) → `<h2>` (same classes) for a correct document outline.
- **[Review]** The broader "Card section-label as `<p>`" pattern recurs on many pages (each Card's `uppercase tracking-wide text-gray-400` mini-heading). Converting all to `<h2>/<h3>` app-wide is a larger, lower-priority semantic sweep — recommended as a follow-on, not done here to avoid a sprawling low-risk-but-noisy diff.

---

## Classification summary
- **[Safe] — applied this pass:** 1 global focus-visible rule; 3 contrast bumps + 1 `Field required` primitive (5 call-sites); 4 focus-style alignments; ~10 `aria-label`s on action buttons/inputs; 3 TOTP `autoComplete`; 3 `aria-live` wrappers; checkbox-label verifications/fixes; home-page heading swaps; portal message-list semantics; 1 empty state. All additive — **zero behavior/layout change; the web build stays clean.**
- **[Review] — recommendations only (NOT applied):** responsive fixed-width inputs + the portal money grid (layout); colored-tone contrast (emerald KPI / emerald-bg text); DataTable dense-chrome touch targets; PF chart polish + sticky-bar safe-area; an icon system; the broader card-section-label → heading sweep.

> This pass deliberately stayed within accessibility/contrast/focus/label/touch-target/semantic wins that use the repo's existing components and Tailwind conventions. Nothing was restyled for taste, no layout was restructured, and no money-critical flow's behavior was touched — those are the [Review] items above.
