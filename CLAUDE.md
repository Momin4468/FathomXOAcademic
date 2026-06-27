# CLAUDE.md — Business OS
Company: FathomXO
Department: Academic
> Operating instructions for the build agent. **Read this every session.** This file is *how to work*; the design lives in `/docs/`. Keep this file short — when in doubt, put detail in `/docs/`, not here.

## 0. Before you do anything

1. Read `/docs/DESIGN_SPEC.md` (the business design — the source of truth).
2. Read `/docs/SCHEMA.md` (the data model — implement against it; do **not** invent schema).
3. Read `/docs/PROGRESS.md` (what's built, in-progress, next) to know where to resume.
4. Read `/docs/DECISIONS.md` (why things are the way they are) before changing anything foundational.
5. **Plan before coding.** Use planning mode; propose the plan, get approval, then implement.

## 1. End-of-session ritual (your cross-session memory)

You do not remember across sessions. The repo is your memory. **At the end of every working session you MUST:**
- Update `/docs/PROGRESS.md`: move items between Done / In-progress / Next; note anything half-finished and exactly where you stopped.
- Append to `/docs/DECISIONS.md` any decision made this session (date, decision, why).
- Never leave the build in a broken state without saying so explicitly in PROGRESS.md.
So, basically after completing any task or migration, immediately update PROGRESS.md before reporting done. After any foundational decision, append to DECISIONS.md in the same turn.

## 2. Stack

- **DB:** PostgreSQL (chosen for row-level security, JSONB custom-fields, ledger/analytics). **Not MySQL.**
- **Language:** TypeScript end-to-end.
- **Backend:** NestJS (modular — one module per business module, each behind a feature flag) over Postgres via Prisma or Drizzle (prefer Drizzle for the ledger/RLS-heavy parts).
- **Frontend:** Next.js + React + Tailwind + shadcn/ui. Mobile-friendly PWA from day one. Native app is Phase 4.
- **BI:** embedded Metabase against a read replica — do **not** hand-roll a charting/query engine.
- **Architecture:** modular monolith with clean seams. **Personal Finance is a separable service** joined by a one-way API (see spec §11) — design that seam now even if deployed together.

## 3. Non-negotiable rules (specific to this system — violating these is a defect)

1. **`org_id` on EVERY table.** Every query scoped through one access layer. Single-tenant is a special case of multi-tenant.
2. **Visibility is enforced at the DB** (Postgres row-level + field security), never only in the UI. **Never render a money leg to a party not on it.** A UI bug must not be able to leak a price. See spec §4.
3. **Profit / margin / split / commission is DERIVED FROM LEGS at read time, never stored** as a column. See spec §3, §11.
4. **Money is an append-only ledger.** Never edit or delete a posted money entry — correct with a reversing entry. Payment = event; allocation = link (supports partial-within-job and bulk-across-jobs).
5. **Effective-dated history** for deal terms, comp rules, pricing, reference data. Never mutate history in place — a March job settles on March's terms.
6. **A work item is composed of lines.** Copies, mixed-rate layers, and multi-writer splits are all the *same* line mechanism. Producer side (writer, one entry) and consumer side (clients, N fanned lines) are distinct and must not be conflated.
7. **Two parallel closes** per job: work-state (draft→pending→confirmed→delivered) and money-state (unbilled→invoiced→partial→settled). Independent.
8. **Governance pattern** (`propose → authorized-role confirm`) for writer-logged work, output-pay tallies, and new reference entities. A claim is not a fact until confirmed.
9. **Roles are data**, not hardcoded. Permission = module × action(view/create/edit/approve) × scope(rows + fields). A person is multi-hat (Khalid sources *and* writes).
10. **Personal-finance plane is private.** Business (even SuperAdmin) can NEVER read into it. Deactivating a brokerage account must NOT disable the person's personal finance. Link accounts, don't merge identities.
11. **Reference data is canonical with aliases.** Store once; fuzzy-in/canonical-out (ICT 701 = ICT701 = 701). New entries are provisional until a data-steward confirms/merges.
12. **Recording client collection is optional**, recording writer payables is independent of it. Never block a workflow because client money wasn't entered.

## 4. Standing engineering standards (apply everywhere, every time — do not wait to be told)

- **Validation at the boundary** (schema/DTO level), not just the form. Treat all client input as hostile. Reject early, fail clearly.
- **Comprehensive error & exception handling.** No silent catches; no unhandled rejections. User-facing errors are friendly; logs are detailed.
- **Edge cases by default:** empty states, partial data, concurrent edits (last-write-wins is not acceptable for money — use proper transactions), timezone correctness on every deadline (store absolute moment + tz; compute "time left" in viewer's zone).
- **Security baseline:** parameterized queries only; authz checked server-side on every request (never trust the client); secrets encrypted at rest (the credential vault is a secrets-manager pattern with per-item sharing); 2FA available for money/credential-holding roles; rate-limit auth; audit every sensitive action immutably.
- **Provenance on every record:** created_by, created_at, updated_by, confirmed_by, timestamps. Profile vs roles/terms are separate edit surfaces (no self-promotion).
- **UI/UX design language:** consistent components (shadcn/ui), breadcrumbs, clear states (loading/empty/error/success), badges for status, accessible, mobile-first, **capture-first** (few-clicks add, pick-don't-type from canonical reference, draft-now-complete-later). The detailed visual language is a later round — until then, stay consistent and restrained; don't invent divergent patterns per screen.
- **File handling:** small files (briefs, solutions, proofs) → object storage + in-system preview/download; large files → link only; DB stores metadata + reference, never blobs.
- **Tests:** cover the money math (legs, splits, allocation), the visibility rules (a party cannot read a non-owned leg), and validation paths. The ledger and the permission engine are the two things that must never silently break.

## 5. How to work

- Build **module by module**, Phase 1 first (see spec §12). Don't scaffold the whole vision at once.
- Prefer boring, mainstream, well-documented solutions — the maintainer may be a non-expert. No exotic dependencies.
- When a requirement isn't covered by the spec, **ask or log a decision** — don't silently invent business logic, especially around money or visibility.
- Keep modules behind feature flags so "sell module-by-module" stays configuration.
- Never put raw business spreadsheets in the source tree; `/reference/` (if present) is human backup only, not input.
