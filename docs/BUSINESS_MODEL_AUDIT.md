# Business Model Audit — `business-user-stories-v1.md` vs. the built system

**Date:** 2026-07-07 · **Method:** every role (§1), workflow (§3.1–3.15), spreadsheet pattern (§4), and decision (§5) in `docs/business-user-stories-v1.md` was checked against the **actual schema and application code** — not `docs/SCHEMA.md` (known to have drifted), not the DECISIONS log's prose. Verification used the production-introspected `docs/data-dictionary.csv` / `fk-relationships.csv` for the schema, and direct reads of `packages/db/src/schema/*.ts`, `apps/api/src/modules/*`, and `packages/shared/src/*.ts` for behaviour. Every classification cites the table/column/file it rests on. **Read-only — no code, schema, migration, or RLS was changed.**

## Classification key
- **[Fully]** — the requirement is met by a named table/column/module today.
- **[Partial]** — works today but needs a concrete extension (stated exactly).
- **[Not built]** — needs new schema and/or code (described concretely).
- **[Blocked]** — genuinely open in §5, or in tension with a load-bearing built invariant; needs a **business decision first**. Not invented here.

## TL;DR — the system is far more complete than "the app UI is garbage" implies
The **data/domain model is mature**: modules 0–18 are built (identity/RLS/audit, party+reference, work/lines/legs, deal-terms/comp-rules, invoicing/payments/settlement, expenses, projects/milestones, outcomes, vault, knowledge, checks, referrers, custom-fields, personal-finance, analytics, AI-capture, import/export, **N-way channels/profit-share**, client-portal). Most of the narrative is **[Fully]** supported. The real gaps cluster into **~8 concrete items**, and several trace to **one root cause**: the cost-attribution enum hardcodes partner *identities* (`momin`/`emon`) instead of referencing party rows. The biggest genuinely-absent capabilities are **business-side multi-currency + the FX-incentive income line**, **per-partner settlement balances**, **in-app notifications/broadcast**, and **client auto-provisioning**.

---

# Section 1 — Roles

**[Fully] SuperAdmin (System) & Business SuperAdmin.** Two SuperAdmins exist exactly as designed: System SuperAdmin is the leg-visibility break-glass (`app_is_superadmin` GUC, granted only to the System SuperAdmin role), Business SuperAdmin gets aggregated/settlement views with **no** leg bypass (`DECISIONS` 2026-06-27; enforced in `leg_visibility` RLS + `settlement_legs`/`dashboard_*` definers). **✅ Resolved (2026-07-08):** the story previously said SuperAdmin should see *"literally everything, including personal finance"* — the built PF plane **structurally denies this**, and the decision confirmed keeping PF private even from SuperAdmin (the privacy guarantee is the product being sold). The built system already enforces this correctly, so **no code change is needed**. Was [Blocked]; now decided. See §3.14.

**[Fully] Admin — Momin / Admin — Emon (separate identities).** Separate `party` + `user_account`, own scoped visibility via RLS + §4.4 opacity (`settlement_legs`, `my_profit_share`). **Caveat worth noting:** the two admins are hardcoded as literal enum values `"momin"`/`"emon"` in `COST_BEARERS` (`packages/shared/src/enums.ts:122`) — identities-as-enum, not party refs. Works for exactly two admins; does not scale to a renamed/added/third admin (see the cross-cutting root cause below).

**[Fully] Writer.** `party_type` includes `writer`; own-rate visibility via `work_line` money redaction + leg RLS; aggregate writer balance (`BalanceService`). Take-home < true price is the structural leg model (§3.1).

**[Fully] Writer-who-also-sources (broker writer).** `party.party_type` is a **`text[]` array** (`a-tenancy.ts:27`) → genuinely multi-hat; `work_item.source_party_id` is independent of the doer, and multi-hop chains with hidden per-hop margins are the core leg design (the Emon→Imu→writers case). Khalid sources *and* writes with no conflict.

**[Fully] Vendor.** `vendor` party type; own-slice leg visibility; flat handoff = a leg. **[Partial]** the *dedicated vendor self-service invoicing surface* (DESIGN_SPEC §8) isn't a distinct built screen — the scoping mechanism exists, the vendor-facing UI does not.

**[Fully / Partial] Referral / Profit-share Partner (Lemon; Antu/Shohan/Mohsin).** N-way profit-share is **[Fully]** built (channels module 17): any number of beneficiaries, each an effective-dated `deal_term term_type='profit_share'` keyed on `to_party_id`, with per-beneficiary `basis ∈ {pct_of_net, pct_after_writer, pct_of_channel, fixed}` (`enums.ts:98`), derived at read time (`deriveProfitShares`). A **flat per-job cut** = `basis='fixed'` (`profit-share.ts:164`), so "flat rate × job count" is a running total. Partner opacity holds (§4.4). **[Partial] two gaps** (detailed in §4.3 / §3.6): (a) no **per-partner running balance** (accrual − transfers) — the netting view is hardcoded to a *pair* and only nets split/commission; (b) **cost attribution to a partner** (e.g. a cost borne by Antu) is blocked by the fixed cost-bearer enum.

**[Partial] Future: Employees (HRM).** The data model already absorbs ~70%: `employee` party type exists; `comp_rule.basis` allows `monthly|weekly|contractual` (`enums.ts:106`); `comp_rule.rate` is nullable and can target a `role_id` (so a no-money role that just logs work is expressible); a `salary` expense category exists (`enums.ts:153`); cadence field present. **Missing:** (a) *"salary owned/managed by whichever partner sources them"* — blocked by the same fixed `COST_BEARERS` enum (can't attribute a salary to partner X); (b) any employee-specific work-logging/HRM surface. Deferred by design, but the attribution gap must be fixed for it to model cleanly.

**[Partial] Future: Client.** Client-portal (module 18) is built but off: `client_account` (login, 1:1 to a client party), scoped/redacted reads, inbound draft requests, lead lifecycle + promote-on-confirm, in-portal messaging + WhatsApp deep-link. **Missing three things the story now asks for:** (1) **[Not built]** username+password **auto-derived from student ID + name** — today `loginId`/`password` are admin-typed free-form (`client-portal/dto.ts:17`) or a public-intake random unusable password; nothing reads `party.external_ref`/`display_name` to derive credentials, and there's no forced-reset-on-first-login flag. (2) **[Partial]** email-notify on a new quote exists but is *unconfigured* (`PUBLIC_QUOTE_NOTIFY_EMAIL`); (3) **[Not built]** automatic **WhatsApp push** on a new quote. In-system messaging is built but explicitly "not needed right now."

---

# Section 3 — Workflows

**3.1 Task intake & recording — [Fully].** `work_item` draft-first capture, `source_party_id` distinct from doer and client, canonical reference (`ref_entity` + aliases), custom fields, "record whatever is known, whenever known" (no required price to save; §3.7 below). Source/referral tag = `source_party_id` (+ `party.referred_by_party_id`).

**3.2 Pricing & discounts — [Partial].**
- Per-instance pricing anchored to precedent — **[Fully]**: `deal_term` precedence + effective-dating (`resolveDealTerm`); explicit amount overrides a resolved term.
- **Ask-price vs settled-price correction — [Partial].** No first-class "ask vs settled" concept (grep: no `ask`/`quoted` column; `work_line` holds one price per side, `c-work.ts:114`). Correcting the price is **clean only before any leg is posted** (a `work_line` rate is an ordinary `UPDATE`; the job sits `draft`/`unbilled`). **After legs are posted the append-only ledger bites**: `leg` has **no `reverses_leg_id`** (unlike `payment`/`charge`), so a correction must be a hand-posted **negative-amount leg** that nets the chain (the mechanism `resit.service.ts` uses). Not a true invariant *violation* (reversing entries are the sanctioned pattern), but the "overwrite in place" mental model has no first-class primitive.
- **Discounts two ways — [Partial].** (b) lower per-word rate = **[Fully]** (just a lower `clientRate`). (a) explicit negative "Discount −3000" line = **[Not built]** — all amount DTOs are `@Min(0)` (`work/dto.ts:74-91`, `billing/dto.ts`), and `LINE_KINDS` has no `discount`/`adjustment` kind (`enums.ts:65`).
- **Writer notified their fee was cut due to a client discount — [Not built].** No `fee_adjusted` flag/note wired to the writer; `work_line.note` is free text nobody sets or surfaces on a rate change.

**3.3 Course/Thesis/Project (multi-task) — [Partial].** Project container (estimate→derived-actual) = **[Fully]** for a formal commitment (`project.estimate_amount` + `Σ billable children`). Group-inside-bulk (track which copy/member with no per-copy price) = **[Fully]** via copy fan-out. **Bulk-price several loose tasks as one sum** = **[Partial]** — only via the ৳0-sibling convention (put the combined `fixedAmount` on one line, others at 0); no first-class "these lines share one price" grouping. Thesis **per-line profit** = **[Not built] as a surfaced figure** (see 3.6 / §4.2).

**3.4 Client invoicing — [Partial].** Live-grouping invoice (job auto-attaches, lines move, estimate superseded by final) = **[Fully]** (`ensureOpenInvoice`, `supersedes_invoice_id`). Emon invoicing *his* client by summary without knowing identity = **[Fully]** (client identity is optional; recording client collection is never mandatory). Group-cohort per-student + ৳0 shared item = **[Fully]** (§4.1). **Previous-due carryforward = [Not built] as a modeled opening balance** — balances are always derived fresh from `payment_allocation`; prior due *persists implicitly* as unsettled lines but is never surfaced as a "brought-forward" opening line on the new invoice (no `previous_due`/`opening_balance` column). Retroactive writer-fee adjust on volume discount + notify = **[Partial]** (adjust yes via rate edit pre-leg; notify no).

**3.5 Writer payment — [Fully].** Writer ledger is aggregate and fully independent of client collection (`BalanceService`; two independent ledgers). Tool/subscription cost deducted from a *specific* writer's earnings = supported via a `charge` (party→business due) that nets in the writer's position — note it's the generic charge mechanism, not a dedicated "tool cost" concept.

**3.6 Multi-party chains & profit-share — [Fully], one [Partial].** Direct / cross-admin commission (per-task %) / multi-hop hidden margins / source-based splits / >2 simultaneous parties are all built (legs + `deal_term` + N-way `profit_share` + `source:<partyId>` routing via channels). **[Partial]:** the *running settlement balance per partner* — see §4.3.

**3.7 Vendor / referral handling — [Fully].** Pure vendor flat handoff (a leg, zero further visibility) vs. profit-share partner (% of profit + own visibility) are distinct and both built (vendor leg scoping; referrer/channels self-view).

**3.8 Expenses & tool-cost deduction — [Fully] (within the two-admin world).** Shared/business-level recurring cost deducted before the split (`expense` + `settlement_legs` shared-cost subtraction) and per-writer tool cost (`cost_bearer='writer'` or a writer `charge`) are both supported. **Caveat:** attributing a shared cost to a *third partner* (not momin/emon/split/writer) is **[Not built]** — same cost-bearer enum limit.

**3.9 Personal finance — [Fully].** The PF plane (modules 14, migrations 0027/0035) covers private expenses, **loans given/taken to many named individuals with partial/staged repayment and running per-pair balances**, savings, targets, subscriptions, notes — all walled off from the business (RLS omits the superadmin bypass), joined only by the one-way income bridge. Multi-currency **is** handled here (`pf_income.currency` + `converted_amount`), unlike the business side.

**3.10 Task / reminder tracking — [Fully].** Task board + tz-aware deadlines + milestones give reminder granularity down to a sub-deliverable inside a bulk course (`milestone` per deliverable; `task` board; `due_at`+`due_tz`).

**3.11 Credential vault / partial sharing — [Fully].** Per-item, per-holder sharing (writer A sees 2 of 5), encrypted at rest, 2FA-gated reveal.

**3.12 Knowledge base — [Fully].** Open authoring; blog-style docs; **video links only, no video files** (file rule enforced).

**3.13 Commercialized checks — [Fully].** Checks module (channel × day batches, propose→confirm, derived P&L, credit top-ups, per-file comp).

**3.14 Permissions — [Fully]; the PF exception is now [Resolved].** Roles-as-data (role × module × action × scope), multi-hat, separate admin identities = **[Fully]**. **✅ SuperAdmin-sees-personal-finance — resolved (2026-07-08):** decided to **keep PF private, including from SuperAdmin** — the built PF plane deliberately excludes even SuperAdmin (a load-bearing privacy invariant *and* the PF product's selling promise), and that guarantee is kept intact. The story has been updated (§1 SuperAdmin row, §3.14, and §5 item 7) to reflect this as decided rather than a tension. **The system already enforces this correctly — no code change needed.**

**3.15 Admin broadcast & notifications — [Not built].** There is **no** notification table, service, or UI anywhere (grep of the whole repo for `notification|broadcast|bell|unread` hits only docs). What exists is `@Cron`+email reminders and the immutable `audit_log`. Needs net-new: a `notification` table (recipient, kind, title, body, `read_at`, broadcast audience), a notifications module (fan-out to everyone / a custom user-set / a whole role — role targeting can reuse `user_role`; create/list/unread-count/mark-read/broadcast endpoints), a transport (poll or realtime), and web UI (bell + unread badge + panel + pop-ups). **This reinforces the UI_AUDIT "no Toast/in-app feedback channel" finding (R6) — see the UI_AUDIT update.**

---

# Section 4 — Spreadsheet-only patterns

**4.1 Group-cohort per-student pricing + one member pays the group's shared item — [Fully].** Copy fan-out (`fanOutCopies`, `line.service.ts:96`) = 1 producer line → N consumer lines each with its own `consumer_party_id` + `client_rate`; `@Min(0)` allows a ৳0 line for the non-paying members. *Minor:* a ৳0 line is indistinguishable from "not yet priced" (no "intentionally free / paid-by-member" marker).

**4.2 Per-line negative profit within an overall-profitable relationship — [Not built] as a flag.** Job-level loss **is** flagged (`deriveJobPnl.isLoss`, `work.ts:65`). **Per-line** margin is never even computed: a `work_line` is producer **XOR** consumer (`line.service.ts:60`), so no read-model holds *both* the client fee and writer fee for one deliverable. §5.4 explicitly **decided** to flag negative-margin lines — this is unbuilt (and needs the producer↔consumer amounts joined via `source_line_id` first).

**4.3 Genuinely multi-party profit-share settlement ledger (Antu/Shohan/Mohsin) — [Partial]. (Priority tension.)** Two mechanisms exist but don't meet:
- `settlement_transfer` (dated partial transfers) is **fully N-party** — `from_party_id`/`to_party_id` are arbitrary party FKs; a transfer can target Antu/Shohan/Mohsin (`j-settlement.ts`, `settlement.service.ts:79`).
- The **netted running-balance view is hardcoded to a *pair*** and only nets `split_pct`/`commission_pct` (`deriveSettlement` takes `{partyA, partyB}`; `SettlementService.summary` loads only those two term types, `settlement.service.ts:46`). It **ignores `profit_share`** entirely.
- **Missing:** a per-partner running receivable = (Σ `profit_share` accrued to that partner via `my_profit_share`) − (Σ `settlement_transfer` to them). Nothing joins those today. So each partner *accrues* correctly and *can be paid* correctly, but the system can't tell you "Antu is owed ৳X right now."

**4.4 Loans to a wider set (writers, vendors, others) — [Not built] (decided 2026-07-08 as business-side).** The **PF plane** loan ledger fully supports arbitrary counterparties + running balances — but that's *private personal finance*. **✅ Decided:** loans/advances to **writers and vendors are a business-side concern** — tracked as ordinary business paid/receivable/payable amounts, **not** personal finance; **purely personal loans stay in the private PF plane as already built** (story §4 loan bullet + §5 item 8). There is currently **no business-plane loan/advance ledger** (today a writer advance would have to be shoehorned into a `charge`), so this is now a real, unblocked backlog item: a business-plane advance/loan ledger (counterparty party, principal, running balance from append-only events, offsettable against earnings). Was [Partial]/decision-pending; now **decided + [Not built]** → see the backlog (P1).

**4.5 Real multi-currency (USDT rate, GBP via an agent) — [Not built] on the business side.** `payment` has **no** `currency`/`fx_rate`/`converted_amount` column (`f-billing.ts`), and the income bridge hardcodes `"BDT"` (`payment.service.ts:134,215`). `medium` is `@IsIn(["DBBL","Bank","bkash","Nagad","Sonali","cash"])` — **USDT/GBP/MTB are rejected at the API** (`enums.ts:134`), and even if allowed, `medium` carries no amount/rate. A foreign receipt can only be entered by pre-converting to BDT off-system, losing the original amount + rate. The pattern already exists in PF (`pf_income.currency`+`converted_amount`) and just needs porting to `payment`.

**4.6 "Previous Due" carrying forward — [Not built] as modeled** (see 3.4).

**4.7 Delivered-but-unpriced — [Fully].** Two independent closes: `work_state` reaches `delivered` with `money_state='unbilled'` and zero legs; nothing requires a price to advance work-state (`work.service.ts:146`, `recomputeMoneyState` never reads `work_state`).

**4.8 Manual duplicate/overlap detection ("FLAG…") — [Not built].** §5.6 leaves the *approach* to implementation, but nothing is built. Reference **canonicalization** dedups *ref entities* (ICT701=701), but there is no duplicate/overlap detection on **work/invoice entries** (the actual "may overlap existing block" pain). Deferred by decision, but a real, self-reported pain point.

**4.9 One-sheet-per-client ceiling — [Fully] solved.** The unified party/client directory + work model + client-360 replaces the ~40-tab master index. This is the whole system's reason for being, and it's built.

---

# Section 5 — Decisions & open items

**5.1 Resits / fails / clawbacks (situational) — [Fully] (mechanism).** Built (`resit.service.ts`, migration 0022): same-writer resit on the same `work_item` (no fee reversal), different-writer/never-paid handled by a controlled reduction (negative reversing leg + `adjustment` clawback charge, disjoint so money is never double-counted), truthful derived net loss. The "case-by-case judgment" is inherently a manual admin decision by design — the machinery supports whichever call is made.

**5.2 The 10%/40% `OVERALL` split — [Blocked] (business decision, code-ready).** **Nothing is hardcoded** (grep for the names/percentages across `apps/api`, `packages` = zero business-logic hits). Any such share is an ordinary `profit_share` `deal_term` row and appears as a cut/residual in `deriveProfitShares`. So the open-ness is purely the *business* not having decided the arrangement — the code needs no change to represent it once decided. **Do not model a fixed rule until the partner arrangement is settled** (per the story).

**5.3 Partner eligibility (anyone who sources; flat or %; strict isolation) — [Fully].** Channels/profit-share: any party can be a beneficiary, flat (`fixed`) or percentage basis, effective-dated, with §4.4 opacity (`my_profit_share` caller-guard + `setProfitShareTerm` base-leak guard). *Note (risk):* opacity is enforced at the **derivation/definer layer**, not by RLS on `deal_term` (that table is tenant-readable) — so any *new* code path that selects `profit_share` terms directly and returns them to a partner would leak. Worth an RLS backstop or a lint rule.

**5.4 Negative-margin lines should be flagged — [Not built].** Decided requirement; unbuilt at the line grain (see §4.2).

**5.5 Multi-currency + government FX incentive — [Not built] (two parts).** (a) Multi-currency medium on the business ledger — see §4.5. (b) **Government FX incentive as its own income line** — there is **no** concept of business "other income" / non-client income anywhere (the money surface is exhausted by `leg` client→writer, `charge` party→business, `payment` events; the only income *table* is `pf_income` in the private plane). Needs a **new append-only business income table** (`other_income`: amount, currency, optional fx_rate/converted, `category='govt_fx_incentive'`, optional provenance link to the originating foreign `payment`) that is **never linked to an `invoice_line`** — so it's reported as its own line and can never offset a client's dues (the story's hard rule). BDT-as-base is correctly honored today; the incentive + non-BDT recording are the gaps.

**5.6 Duplicate/overlap detection — [Not built] (deferred by decision).** Left to implementation judgment; nothing built (see §4.8).

---

# Cross-cutting: the one root cause behind several gaps

**`COST_BEARERS = ["momin","emon","split","writer"]` (`packages/shared/src/enums.ts:122`) hardcodes partner *identities* as enum values.** The DB columns (`expense.cost_bearer`, `comp_rule.cost_bearer`) are flexible `text` and the enum comment even says *"modeled as text so it can extend to a party ref later"* — but every write path validates `@IsIn(COST_BEARERS)`, and `cost_bearer_split_json` keys are never consumed into an actual per-party deduction. This single limitation blocks:
- attributing a **cost to a third partner** (Antu/Shohan/Mohsin) — §3.8 / §4.3;
- **HRM salary "owned by whichever partner"** — §1 Employees;
- cleanly **renaming or adding an admin** beyond momin/emon.

Fixing it once (cost_bearer → a nullable `party_id` ref, or a `bearer_party_id` alongside a slimmed enum, + the split-json consumption + the settlement/expense branches that switch on `momin`/`emon`) unblocks all three.

---

# Prioritized backlog (P0/P1/P2)

Priority = (decided requirement that makes the *books wrong or impossible* today) → (decided-but-deferred) → (future/aspirational). These are **business-model gaps for review**, not a build order — nothing is implemented from this until we go through it together.

### P0 — decided requirements needed for the books to be correct now
1. **Business-side multi-currency + FX-incentive income line** (§4.5, §5.5). Real USDT/GBP receipts happen now and can't be recorded truthfully. Add `currency`(+`fx_rate`/`converted_amount`) to `payment`; widen the `medium` list; add an append-only `other_income` table (never linked to `invoice_line`) for the govt incentive. *Pattern already exists in PF — port it.*
2. **Cost-bearer → party ref** (the root cause above). Unblocks partner cost attribution, HRM salary ownership, and >2 admins in one change.
3. **Per-partner running settlement balance** (§4.3). Net each partner's `profit_share` accrual against their `settlement_transfer`s so "Antu is owed ৳X" exists. Antu/Shohan/Mohsin have real live balances.
4. **Previous-due carryforward surfacing** (§3.4/§4.6). Repeat clients need a brought-forward opening line on the new invoice (the due already persists; it's just not surfaced).

### P1 — decided/high-value, not blocking correctness today
5. **Negative-margin line flag** (§4.2/§5.4) — first compute per-line margin (join producer↔consumer via `source_line_id`), then surface a flag.
6. **First-class price-correction + discount lines** (§3.2) — a `reverses_leg_id` (or a re-price endpoint) for post-leg corrections; a `discount`/`adjustment` line kind that permits negative amounts; a writer "fee adjusted" note/flag.
7. **In-app notification + admin broadcast system** (§3.15) — table + module + bell/unread/panel/pop-up UI; also delivers the UI_AUDIT R6 (Toast/feedback) gap.
8. **Client auto-provisioning from student ID + name** (§1 Client) — derive `login_id`/initial password from `external_ref`+`display_name`, minimal-click create, forced-reset-on-first-login; plus configure the quote-notify email and add the WhatsApp push.
9. **Ad-hoc bulk-price container** (§3.3) — a first-class "these N tasks share one combined price" grouping (beyond the ৳0-sibling convention).
10. **Duplicate/overlap detection** (§4.8/§5.6) — a self-reported pain point, deferred only on *approach*.
11. **Business-plane loan/advance ledger for writers/vendors** (§4.4) — **decided 2026-07-08** as a business-side concern (was a P2 open question, now unblocked). Build an advance/loan ledger: counterparty party, principal, running balance from append-only events, offsettable against earnings. Purely personal loans stay in the PF plane as built.

### P2 — future / aspirational / needs a business decision first
12. **HRM/Employee surface** (§1) — the data model absorbs ~70% once P0-2 lands; needs a work-logging/no-price role surface + salary-owner attribution.
13. **Vendor self-service invoicing surface** (§3.7 / DESIGN_SPEC §8) — mechanism exists, UI doesn't.
14. **Client portal turn-on** (§1) — infra built; decide when to enable + wire WhatsApp notify.
15. **⛔ Resolve the 10%/40% partner arrangement** (§5.2) — blocked on the *business* deciding the deal; code is already ready to represent it as a `deal_term`.

**✅ Resolved (2026-07-08), no backlog action:** SuperAdmin-vs-PF privacy (§3.14) — decided to **keep PF private, including from SuperAdmin**; the system already enforces this correctly, so **no code change is needed**. (Formerly a P2 "needs a decision" item.)

### Also hardening (from the verification, not in the story)
- **RLS backstop on `deal_term`** (§5.3 note) — profit-share opacity currently relies on callers using the guarded definers; the table itself is tenant-readable. A per-party RLS policy or a lint rule would make the §4.4 guarantee defence-in-depth rather than convention.
