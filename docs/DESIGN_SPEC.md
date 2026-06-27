# Unified Business Operations System — Master Design Specification

**Version:** 0.2 (concept-complete; pre-build)
**Status:** Living document. This is the durable memory of the design. Hand this to Claude Code (or any new session) as the source of truth.
**Working name:** *Business OS* (rename freely)
**Changelog v0.1 → v0.2:** vendor self-service invoicing; transaction-capture model (medium, trx id, dual-side proof attachments); refined file-storage rule (small files in-system, large linked); Personal Finance as a **separate, independently-sellable service** joined by a one-way API; all four open decisions resolved; new §15 Engineering & quality standards (delegated to CLAUDE.md).

---

## 0. How to read this document

This spec was distilled from a long design conversation and from five real workbooks the business currently runs on (the X-MBA invoice file, `Book1`/`Book2` cohort & IT invoices, `Another_Book` P&L + settlement, and `Emon_Dashboard` writer ledgers) plus the WhatsApp operation underneath them. Wherever a rule appears below, it came from an actual case in that data — those cases are cited as examples so the logic stays concrete.

The **one-line spine**, to keep in mind throughout:

> A multi-tenant, role-scoped ledger where every job carries a **chain of money legs** (true client price → each intermediary's price → writer's rate) and every actor sees **only the legs they are party to**, while SuperAdmin sees the real margins end to end. Get the layered *job → lines → legs → visibility* model right and every other feature hangs off it.

The **product truth**, equally important:

> The system is a **personal work-queue and capture tool first, an accounting system second.** People open it to answer *"what's open and whose move is it?"* and to log/submit work in a few taps. Everything else — invoices, settlements, dashboards — is *generated from* well-captured jobs. If capture is frictionless, the data exists and the rest is automation. If capture is painful, nothing else matters.

---

## 1. What this system is

A **vertical ERP / PSA (professional-services-automation) tool for an academic-work brokerage**, with one defining twist ordinary ERPs lack: a **transfer-pricing-style opacity model** where each layer of the supply chain sees only its own slice of the money.

It unifies what currently lives across three workbook layers + WhatsApp:

| Today (fragmented) | Becomes (unified) |
|---|---|
| Per-client invoice sheets (client billing) | Client billing module |
| `Another_Book` (profit = client − writer, Emon↔Momin split & settlement, personal loans) | Margin ledger + partner settlement + personal-finance plane |
| `Emon_Dashboard` (writer task ledgers, Emon's own clients, expenses) | Writer-cost ledger + expenses |
| WhatsApp (the raw feed, the memory, the task list) | Capture + task board + client/reference directory |

**File-storage rule:** the system stores **small evidentiary and working files** (briefs, handbooks, solution files, payment/expense proof screenshots) — uploaded, previewed, downloaded in-system — but is **not a bulk document store**; anything large lives elsewhere and is **linked**. A size threshold enforces it. Payment/expense **proof attachments may be added from either or both sides** (payer and payee), each tagged with who attached it and which side.

**Non-goals / deliberate exclusions (for now):** no bulk document store (large files linked); clients are **not** users yet; no microservices (modular monolith — but Personal Finance is a separable service, see §11).

---

## 2. The core primitives

Across many rounds of stress-testing (opacity, commissions, multi-tier chains, referrers, vendors, white-label staff, volume pay, reputation, capacity, resale, dynamic fields, fuzzy search, projects, copies, mixed rates), **every requirement reduced to this small set**. New requirements should keep reducing to these; if one genuinely doesn't, that's a signal to extend the spine deliberately.

1. **Party** — any actor (client, writer, vendor, referrer, partner, employee). Typed. May or may not have a login.
2. **Relationship** — a typed link between two parties (writer-of, vendor-of, referred-by, partner-with). Carries deal terms.
3. **Work Item (Job)** — the unit of work. Composed of **Lines**. May belong to a **Project**.
4. **Work Line** — a component of a work item: a copy, a rate-layer, an "extra work" add-on, or a multi-writer part. Holds its own count, rate, and (on the consumer side) party. *This single idea makes copies, mixed-rate layers, and splits the same feature.*
5. **Leg** — one link in a job's money chain: from-party → to-party, amount, visible-to. Margin at any node = inbound leg − outbound leg.
6. **Deal Term** — a date-versioned rule attached to a relationship: split %, commission %, referral %, per-word rate, or fixed.
7. **Comp Rule** — how a party/role is paid: basis (per-word / per-task / per-file / monthly / weekly / contractual / commission), rate, **cost-bearer**, cadence.
8. **Expense (with cost-bearer)** — any cost; the cost-bearer field (Momin / Emon / split / writer) drives all profit deductions. Salaries, subscriptions, promo, losses are all this.
9. **State** — a status on a record (e.g., draft → pending → confirmed → delivered → settled). Verification and workflow are states, not notifications.
10. **Custom Field** — admin-defined, typed, scoped (global or by type/uni/client). The governed version of "add any column."
11. **Canonical Reference Entity** — university, course code, assignment type stored **once** with aliases; fuzzy-in / canonical-out.
12. **Note/Comment** — free-form, on anything. The ungoverned counterpart to custom fields.

**Two patterns recur everywhere and should be implemented once, reused everywhere:**

- **Governance pattern:** *anyone proposes → an authorized role confirms.* Applies to writer-logged work, output-pay tallies, new reference entities, and more.
- **Visibility rule:** *you see the legs/figures you are party to.* Applies identically to writers, vendors, referrers, and partners.

---

## 3. The money model (the crux)

### 3.1 Chain of legs

Model the money itself, not "roles → pages." Every work item carries an ordered chain of legs:

```
CLIENT ──(true client price)──▶ MOMIN ──(handoff)──▶ EMON ──(handoff)──▶ IMU ──(handoff)──▶ WRITER
         leg A                          leg B                 leg C               leg D
```

- Each leg is **owned by, and visible to, the two parties on it (and SuperAdmin)**.
- A party's **margin at a node = inbound leg − outbound leg**.
- Opacity is **structural**: a party simply has no data for legs they aren't on. Emon cannot see leg A (true client price) because he was never party to it — it isn't a permission toggle, it's data he doesn't have.

**Worked examples from real cases:**

- *Standard handoff:* Client pays 6,000 → Momin gives Emon 5,000 → Emon pays writer 3,000. Profit 2,000 (5,000−3,000) is split Emon/Momin per deal term. Momin's hidden 1,000 (6,000−5,000) is leg A, invisible to Emon.
- *Commission (Emon sources, Momin's work):* Momin dictates price, Emon collects, Emon takes **20%**, Momin keeps the rest. Two legs; the 20% is a deal term on the Emon→Momin relationship for Emon-sourced work.
- *Multi-tier (Imu civil):* Momin→Emon 5,000 → Emon→Imu 4,000 → Imu→writer 3,000. Emon/Momin profit = 5,000−4,000 = 1,000 (split). Imu's margin (4,000−3,000) is **invisible to Emon and Momin** — Imu sees only his slice. Momin's true client price is invisible to all of them.

### 3.2 Producer side vs consumer side (the copy fan-out)

A work item has **two faces** that must never be conflated:

- **Producer side (writer):** one entry. *"ICT 701 A3, 5 copies, my rate × 5"* → one payable to the writer.
- **Consumer side (client):** the same work fans out to **N billable lines**, each to a (possibly different) client, each its own price and payment state — exactly like Aditta's 5 copies billed to different people at different prices, some discounted.

The writer types it **once** ("5 copies"); an admin (or a rule) **expands** it into client lines. The writer never sees the client prices, and need not know the client identities (though they *may* attach a client from the directory if they happen to know — identity and price are separate permissions).

### 3.3 Lines: copies, layers, splits = one feature

A work item is **composed of lines**, not a single flat amount. The single-assignment job is just the **one-line case**. This unifies three things that look different:

- **Copies:** 5 lines, same spec, different consumer parties/prices (ICT701 A3 ×5).
- **Mixed-rate layers:** one task = 2,000 words @1.5 + 1,000 words @1.0; two lines, summed. Writer logs base work then ticks **"+ extra work"** to add a component (words, rate, note). Client side mirrors it.
- **Multi-writer parts:** several writers each own a line and are paid for their part; the lead still sees the whole.

### 3.4 Deal terms (date-versioned)

A deal term is a rule on a **relationship** (or party↔job-type), resolved by precedence: most-specific (this client, this pair) → least (default for pair → global default). **Versioned by effective date** — a March job settles on March's terms even after a June renegotiation. New partners = new rows, never new code.

| Field | Example |
|---|---|
| from-party → to-party | Momin → Emon |
| applies-to | default / specific client / job-type |
| term-type | profit-split % / commission % / referral % / per-word / fixed |
| value | 50% split / 20% commission / 10% referral / 1.5 per word |
| effective-from / -to | 2026-01-01 → (open) |

### 3.5 Comp rules (how people get paid)

Compensation is a property of **how a unit of work is paid**, not of a person. One mechanism, many bases:

| Basis | Example role |
|---|---|
| per-word | writer @ 0.8–1.0/word |
| per-task | check-worker, coordinator piece-rate |
| per-file | AI/plagiarism check-worker (e.g., 5/file) |
| per-copy | copy-based jobs |
| commission-on-revenue | marketer (e.g., 10% of work they bring), referrer |
| monthly / weekly / contractual | salaried coordinator, manager |

Each comp rule carries a **cost-bearer** (Momin / Emon / split / writer) — the *same* attribution field used for subscriptions, promo, and losses. **Do not build a payroll subsystem;** salary is one flavor of *expense-with-attribution*, and output-based pay is *computed* from work records (with a confirm step) rather than tallied by hand.

### 3.6 Defaults (variable, not fixed)

Charged ≈ **1.5–2.0/word**; writer paid **0.8–1.0/word**; IT/Science 50%-weight work ≈ **5,000–6,000**; varies by group/weight/relationship. These are **rules-engine defaults that auto-fill and can be overridden**, never hardcoded constants.

---

## 4. Visibility & permission model

### 4.1 Three planes

1. **Business plane** — the operation. SuperAdmin (business) can see across it; everyone else is leg-scoped.
2. **Personal-finance plane** — the inverse: each user is admin of their own; **business SuperAdmin sees none of it.** The only link is a **one-way income bridge** (a business payout pushes an income row into the user's private ledger; what they do with it is theirs). **This plane is a separate, independently-sellable product** (see §11) — joined to Business OS by a one-way API and **linked-but-separate accounts**, so deactivating someone's brokerage account never disables their personal finance, and the business can never read back into it.
3. **Payments plane** — money arrives randomly and is **allocated** to works/dues after the fact (open-item), not welded to one invoice.

### 4.2 Two SuperAdmins

- **System / Platform SuperAdmin** — technical break-glass (migrations, recovery, debugging, future tenant management). Backed by an **immutable audit log** it cannot quietly erase. Not a daily business seat.
- **Business SuperAdmin** — sees across the operation for management. **But cannot be a single person who sees every leg**, or the partner secret breaks (see 4.4).

### 4.3 Roles are data, not code

A role = a composition of **module permissions × actions (view/create/edit/approve) × scope (rows: which writers/clients; columns: which fields)**. Ship sensible defaults; compose the rest. Default/likely roles:

| Role | Sees money? | Scope | Notes |
|---|---|---|---|
| System SuperAdmin | all (break-glass) | everything | technical, audited |
| Business SuperAdmin | aggregated/settlement | everything | management view (see 4.4) |
| Admin (Momin) / Admin (Emon) | own legs + shared settlement | own operation | **separate** admin entities |
| Manager / Writer-Manager | usually no margins | scoped writers (row) | supervises a team |
| Coordinator / Dispatcher | no money | assigned jobs | capture & chase; adoption hero |
| Writer | own rate only | own jobs | may also be a source (Khalid) |
| QA / Check-worker | own tally only | own queue | per-file comp |
| Vendor (Toma, Imu) | own slice | own jobs | external; **kept**, to know earnings via them |
| Referrer (Mujib) | own referral income | referred jobs | login sees only their slice |
| Marketer / Promoter | targets & own attributed revenue | — | future, salaried + commission |
| Finance / Bookkeeper | money, maybe not ops detail | — | future |
| Knowledge Curator | knowledge base | — | sustainability lever |
| Client | — | — | **excluded for now** |

**A person is not one role.** Khalid sources *and* writes; Momin is admin *and* writer; Emon is admin *and* a downstream vendor when Momin hands him work. Roles bind **per-job context**, multi-hat — never one global role per user.

### 4.4 The partner-visibility problem (and its answer)

Momin and Emon each want to see the other's **work volume**, while each charging the client more than they tell the other. So **no human routinely holds a seat that renders every leg.**

> **"See the other's work volume" and "see the other's margins" are different permissions. The architecture exists to grant the first without ever granting the second.**

Realization, in order of preference:
1. **Designed asymmetry (default):** the schema hides non-owned legs, so even an "admin" view for Emon *structurally cannot* render Momin's private client leg — it's not a toggle, it's data he was never party to. A **shared settlement layer** shows only agreed figures (split profit on shared jobs, who-owes-whom, job counts/volume) both are entitled to.
2. **System SuperAdmin break-glass** — for genuine disputes only, audited.
3. **Neutral reconciliation report** both accept without seeing raw legs.

### 4.5 Visibility matrix (sensitive figure × role)

`R` = read, `W` = read+write, `—` = none, `agg` = aggregated/settlement-level only.

| Figure / data | Sys SuperAdmin | Biz SuperAdmin | Admin (owner) | Manager | Writer | QA | Vendor | Referrer |
|---|---|---|---|---|---|---|---|---|
| True client price (top leg) | R | agg | W (own) | — | — | — | — | — |
| Intermediate leg prices | R | agg | own legs | — | — | — | own leg | — |
| Writer rate / writer pay | R | agg | W | scoped R | own R | — | own slice | — |
| Job margin / profit | R | agg | own R | — | — | — | own slice | — |
| Partner split / commission | R | R (shared) | R (shared) | — | — | — | — | — |
| Other partner's private margin | R | — | — | — | — | — | — | — |
| Client identity (name/id/uni) | R | R | W | scoped R | optional R | — | — | own referred R |
| Client contact details | R | R | W | scoped | — | — | — | — |
| Work volume / job counts | R | R | R | scoped R | own R | own R | own R | own R |
| Referral income | R | agg | R | — | — | — | — | own R |
| Personal-finance plane | — | — | own only (W) | own only | own only | own only | own only | own only |
| Tool credentials | R | per-policy | per-policy W | — | shared items only | shared items only | — | — |
| Deal terms / comp rules | R | R (shared) | W (own rels) | — | own R | own R | own slice | own R |
| Audit log | R | R | R (scoped) | — | — | — | — | — |

*(This is the artifact most painful to retrofit; treat it as authoritative and expand it cell-by-cell as roles are added.)*

---

## 5. Work tracking vs billing (the project insight)

For most work, the **tracking unit = the billing unit** (one assignment, one line, done & invoiced). For **thesis / project / full-course** engagements they **come apart**:

- **Unit of progress** = recurring small items (weekly reflection, supervisor meeting, draft section, assignment 3 of 8).
- **Unit of billing** = milestones / deliverables (or each assignment, for a course).

**Model:** a **Project (engagement) container** holds child work items, each flagged **trackable / billable / both**. A weekly reflection is trackable-only; the final report is both. The progress board reads trackable children; billing reads billable children — same tree, two views. A plain single assignment is the **one-child case**, so ordinary jobs and projects use the **same machinery** (no separate "projects module").

- **Milestone templates** are reference data: per-uni/programme templates (e.g., *UWTSD MBA Thesis*: proposal → ethics → chapters → LR → data collection → final) that you **instantiate then add to**. Some unis are template-fixed, others fluid — support both.
- **Money rhythm on projects:** writer pay **mounts as items are logged** (accrue-and-pay); client gets a **rough/initial estimate that firms up at completion** (estimate → actual). Same client/writer asymmetry as everywhere. The estimate produces a **provisional invoice marked as estimate**; final billing **supersedes** it (the estimate is retained in history, never silently overwritten).

---

## 6. Invoices & payments

- **Invoice = a live grouping of billable lines**, not a frozen document. New job for a client → appears on their open invoice automatically; totals & status recompute; an admin can move lines between invoices or split a new one; **dates matter** (which job, which invoice, which period). A notification informs; the admin retains freedom. *(Mezbahul: invoice of 3 jobs → 4th added → invoice auto-updates to 4.)*
- **Client side = per-job (and finer):** each job line tracks paid/due; **partial payment within a single job** is allowed (6,000 job → 3,000 now / 3,000 later). Open-item AR with cash application; remainder ages as due.
- **Writer side = aggregate:** total due / total paid / running balance — **no per-task payment matching** (that's the WhatsApp-tallying hell being escaped).
- **A payment is an *event*; allocation is the *link*.** One received amount can be **partial within a job** (6,000 → 3,000 now / 3,000 later) **and/or spread across several jobs at once** (bulk cash application). The payment record holds: **amount, date, direction (in/out), medium (DBBL / Bank / bkash / Nagad / Sonali / cash), transaction id, counterparty, and one-or-more proof attachments** (each tagged with who attached it and which side — payer/payee). Structured trx-id + medium + date make later bank/bkash reconciliation possible; the screenshot is the human dispute-proof.
- **Recording client collection is always possible & encouraged, never mandatory.** A job is valid and can settle (writer paid, profit split) even if client-side money was never entered. If Emon/Toma choose not to log collection, the books simply don't know their margin — *their* loss of visibility, not a blocked workflow. **Client-receivable ledger and writer-payable ledger are independent.**
- **Two parallel closes:** every job has a **work-state** (draft → pending → confirmed → delivered/submitted) and an independent **money-state** (unbilled → invoiced → partial → settled). A job can be work-done but money-open for weeks. Reputation/quality key off work-state; dues/aging key off money-state.

---

## 7. Reference data & search (the quiet backbone)

At volume, **course code / assignment number / university are the keys.** If inconsistent, the dataset rots.

- **Canonical entities with aliases:** "ICT 701", "ICT701", "701" all resolve to one canonical course. Stored original may be whatever was typed; it **points at** the canonical. (Entity resolution.)
- **Fuzzy-in / canonical-out:** normalized search (strip case/space/punctuation) + alias lists + **type-ahead select from existing** as the default so people pick rather than retype.
- **New entries are claims until verified:** a writer typing a new code creates a *provisional* entity an authorized **data steward** (a delegable permission, not only the owners) promotes or **merges** into an existing one. The merge step is what kills duplicate sprawl.
- **Assignment types** (A1 / CW1 / Assessment-1) stored as singular canonical values → finally answer "how many CW1s this term."
- **Referencing style per uni+programme** stored as reference data (e.g., Victoria IT → IEEE, business → APA).
- Also store **client directory** (name / id / university / programme / contact / referred-by) so no more digging through WhatsApp, and lightweight **groups/cohorts** (a named set of parties, e.g., the 16-client Mujib cohort) — distinct from a free-text note, because "show everyone in the Mujib cohort" needs structure.

---

## 8. Supporting modules

- **Vendor / referrer self-service** — a vendor (Toma) or referrer can be given the **invoicing + record-tracking modules scoped to their own slice**: they invoice *their* clients and track *their* records inside the system, while what they charge their clients stays theirs and only the shared leg flows to the business. Same machinery, scoped — costs the business almost nothing, makes vendors stickier, and is a real **vendor-acquisition lever**. (This is the same "rent a scoped slice of one system to a party type" pattern as the Personal-Finance subscription.)
- **Expenses & deductions** — every cost carries a **cost-bearer**; subscriptions, salaries, promo (with optional **campaign tag** and optional **revenue link**), losses. Events/tours = a **cost center that can optionally link to attributable income** (mostly cost, sometimes contributes revenue) — reuses expense + task machinery, doesn't need a full P&L.
- **Credential vault** — tool accounts (e.g., AcademyCX ×5, Subscheap), **encrypted at rest**, **per-item sharing** (writer A sees 2 accounts, writer B sees 3), never plaintext. Secrets-manager pattern; 2FA for holders.
- **Knowledge base** — best-practice docs, prompt packs, blogs; **video links only (no video files)**. Open authoring (anyone can create what they find helpful). Owned/curated by a knowledge role.
- **Commercialized services** — AI/plagiarism checks as a service-sales mini-ledger: units sold / paid / checked (the *"Files Paid 100 / Checked 120 / 06 May 2026"* board), margin per check. AcademyCX appears **twice** — as a **cost** (vault + expense) and as **capacity/credits consumed** per check — so "are we making money on checks?" = check-revenue − allocated credit cost.
- **Task & reminder board** — replaces whiteboards/diaries. Due tracking, **timezone-aware deadlines** (store absolute moment + tz; users add clocks for UK / Melbourne / Sydney / Dhaka), and **computed urgency** ("time left in *my* zone") as a first-class signal on the queue. *(Real pain: the Arman "BD time 1 PM" scramble.)*
- **Reputation / outcomes** — per finished work, capture (cheap fields): on-time vs late (+ by how much), revision count (+ whose fault — writer vs changed brief), grade/mark when reported, marker feedback, complaint flag + reason, fail/resubmission flag, plagiarism/AI score, satisfaction, rework cost, disputed/refunded. **Reputation score is derived (read-model), never hand-edited.** Treat as aggregate signal, noisy on any single job. **Outcomes entered by admin or an admin-assigned role**, not self-reported by the writer.
- **Writer expertise / capacity** — profile: expertise tags, **course history (auto-accumulates from logged jobs)**, availability/load. Converges with reputation into **smart work-routing** later (match job subject ↔ proven expertise ↔ current load ↔ reliability). Capture now, build matching later.
- **Personal-finance plane (private)** — income bridge from business payouts, categorized expenses, loans given/taken, savings, targets ("earned 2 lakh this month → loans → expenses → savings"). **This is the subscription product** sold module-by-module. Strict privacy: business SuperAdmin sees none of it.
- **Analytics & BI** — role-scoped dashboards + **SuperAdmin ad-hoc query & chart builder** (PowerBI/Tableau-style). Use **embedded BI against a read replica** rather than hand-rolling a query engine.
- **Notifications & audit** — cross-cutting. Reminders via email/notification (gentle "you have N unfinished records" — **no hard blocking**; discipline is cultural, the daily-10-minutes habit). **Immutable audit: who entered/edited/confirmed what, when** — non-negotiable given the money and partner trust.

---

## 9. Field catalog (reverse-engineered from the current workbooks)

So nothing currently tracked is lost. These map onto the entities above.

**Work item / line (from all invoice sheets + Thesis/BBA/AUS):** client name(s), client ID, university, programme, course code, course name, assignment title/number (A1/CW1/Assessment-1), word/slide count (per copy), copy count, price per word/slide (client), price per copy, client-to-be-paid, writer name, writer rate per word, writer-to-be-paid, profit, company (e.g., 7006 MNC, 7025 presentation company), group/cohort, presentation group + role + slides, source/referrer ("Referral/Client/Student"), submission/deadline date (+ timezone), weighting %, individual/group, month, status, **note / additional note**.

**Invoice / payment:** invoice grouping, amount-to-be-paid, paid, remaining/due, payment date, paid amount, medium (DBBL / Bank / bkash / Nagad / Sonali), per-job vs aggregate, discount (per-assignment / chunk), settlement figures.

**Writer ledger (Emon_Dashboard):** referral/source, date, task name, total word count, corrections/other files, total payment expected, total payment due, monthly income, payment receive date, platform, payment received, university/category.

**Project (Thesis/Capstone):** milestone/deliverable list, per-week tasks, data-collection, ethics/risk form, proposal, drafts, final report, per-student SUMIF rollups, estimate vs actual.

**P&L / settlement (Another_Book OVERALL):** segment, client revenue, writer payment, profit, partner split (Emon/Momin), commission %, dated transfers (SENT…), loans, remaining balance, profit-share %.

**Expenses (Sheet5):** month, description/category, amount, cost-bearer.

**Reference:** university, course code (+ aliases), assignment type, referencing style per uni+programme, deal terms, comp rates.

---

## 10. Capture-first UX principles (the part that makes or breaks adoption)

- **Default landing screen for every role = "my open loops."** Writer: my pending works → *log new* / *mark submitted* (two taps, from any device). Admin/owner: delegated tasks, pending tasks, which clients are pending/owing, the **confirmation queue**, exceptions. Same philosophy, different scope.
- **Add-a-job is the most-optimized journey.** Few clicks; smart defaults auto-fill rate from the rules engine; **pick-don't-type** from canonical reference data; **draft now (course code + a detail), complete later.**
- **Verify, don't block.** Weekly/periodic verification pass; reminders nudge; nothing hard-blocks. Software's real job is to make completing a record so fast the discipline rarely needs enforcing.
- **Provenance everywhere:** who entered, who confirmed, when. Profile vs roles/terms are **separate surfaces** (a user edits their profile; only admins edit roles/terms — no self-promotion).
- **Job detail page = the hub:** click a job → every linked thing radiates out (writer side + fanned client lines + course/uni + legs/visibility + project milestones + components + tz-deadline + notes + provenance), each rendered through the viewer's scope.
- **Mobile-friendly from day one** (web first, native app later). Quick-add must work one-handed on a phone.
- **UI/UX design language** (breadcrumbs, search affordances, icons, badges, gears, banners, header/footer/navbar, pipelines, user journeys) is **intentionally deferred** to a later round — but reserved here so it attaches to this skeleton when we do it.

---

## 11. Architecture & tech direction

- **Modular monolith with clean seams.** One transactional data model, integrity across modules, one team — but internally **modular** (clear module boundaries, each behind a **feature flag**) so "sell module-by-module" and "template for other businesses" become configuration, not a rewrite. *Single-tenant is a special case of multi-tenant.*
- **`org_id` on every row + one access layer from day one.** This is the **one non-deferrable** decision — retrofitting tenant scoping later is the genuinely painful refactor. (Why not full SaaS now: it doubles the surface — billing, provisioning, isolation proofs, white-label, support — for customers who don't exist yet, while delaying the daily-ops value. Build internal-first, *design* multi-tenant.)
- **Double-entry-style, append-only ledger** as the financial backbone. Every money event is a balanced, immutable entry. With partners splitting profit, this is what keeps the books from drifting and makes the audit real. Single-entry sheets are exactly what's being escaped.
- **Open-item AR/AP + cash application** for the "everyone pays randomly" reality.
- **RBAC + ABAC + row/field security**, enforced at the database (e.g., **Postgres row-level security**) so a UI bug can't leak a price.
- **Secrets-manager pattern** for the vault (org-style item-level sharing; encrypted at rest).
- **Embedded BI** (e.g., Metabase) against a read replica for dashboards + ad-hoc querying.
- **Effective-dated, append-only history** for deal terms, comp rules, pricing, reference data — change the rule, old jobs keep old terms; nothing destroyed.
- **Domain-neutral core, domain-as-configuration.** Because resale is likely to **different businesses** (not just other brokerages): keep core entities generic (party, work, line, leg, term, expense, state, field); "academic brokerage" is the **first configuration**, not hardcoded reality. Don't bake "university"/"course code" into the spine — they're fields on a configurable work-type. *(Decision to make now; build the config UI later.)*
- **Personal Finance is a separable service, not a tab.** It has its own identity store, its own data, its own subscription, and is **sellable standalone to people who never touch the brokerage.** Business OS connects to it by a **one-way income API** (business payout → personal income row) and **linked-but-separate accounts** (a human may hold a brokerage membership *and* a personal-finance subscription, joined by a link, not by being the same record). Consequences: deactivating a brokerage account **does not** disable personal finance; the business (even SuperAdmin) **cannot read into** the personal plane; the API is a push, not a window. *Design the seam from day one (link-not-merge identity); physical split can come later, but the boundary must exist now.* Mental model: payroll deposits into your bank account — quitting the job doesn't close the account, and the employer can't see your spending.
- **Profit is computed, never stored.** Margins, splits, commission, per-writer profit are always derived from legs at read time (so they stay correct as date-versioned deal terms change). "Which writer generated how much profit" is a BI aggregation over `client-leg − writer-leg` grouped by writer — not a stored number.
- **File handling:** small files (briefs, solutions, proofs) stored in object storage with in-system preview/download; large files linked; a size threshold enforces the boundary. The DB stores metadata + reference, not blobs.
- **Build via Claude Code** with high-level intent; UI/UX & backend standards enforced through **subagents** + a `CLAUDE.md` standards file (see §15). Stack lives in `CLAUDE.md`, not here, so this spec survives a stack change.

---

## 12. Phasing (so 150–250 functions isn't built at once)

Full vision ≈ **15–16 modules, ~150–250 functions.** MVP ≈ **5–6 modules, ~40–60 functions.** Suggested order:

**Phase 1 — Capture & core ledger (MVP, internal):**
identity/roles/permissions (incl. visibility engine + audit) · party & client directory + canonical reference + fuzzy search · work item / lines / legs (incl. copy fan-out) · deal terms + comp rules · capture-first "my open loops" screens + job detail · basic invoicing (live grouping) + payments (open-item, client per-job, writer aggregate) · expenses with cost-bearer · task board + timezone deadlines.

**Phase 2 — Operate & manage:**
projects/milestones + templates · reputation/outcomes + expertise/capacity · partner settlement + profit split + commission · credential vault · knowledge base · commercialized check-service · referrers · role-scoped dashboards.

**Phase 3 — Personal & growth:**
personal-finance plane (the subscription product) · advanced BI / ad-hoc query builder · marketers/managers + targets · events/tours.

**Phase 4 — Productize (for resale):**
multi-tenant provisioning · per-module licensing & subscription billing · white-label / domain configuration · templating · mobile app.

---

**Production:** the business goes live on this system **after Phase 3** (full internal operation) — though Phase 1 alone is already usable in production for daily ops. Treat production as reached **early and iterated on**, not a finish line. **Phase 4 is only the "sell to outsiders" tax** and happens when real buyers exist; clean seams (§11) make it additive, not a rewrite.

---

## 13. Resolved decisions (were open in v0.1)

1. **Two parallel closes — RESOLVED:** work-state and money-state are separate and independent (see §6). A job can be delivered but unpaid; reputation keys off work-state, dues off money-state.
2. **Bulk payment across jobs — RESOLVED:** allowed. A payment is an event; allocation is the link. Supports partial-within-a-job *and* one payment spread across many jobs (§6).
3. **Estimate → actual — RESOLVED:** the estimate produces a **provisional invoice marked as estimate**, billable but **superseded** by the final bill; the estimate is retained in history (§5).
4. **Owner's headline number — design-time call:** landing view = *delegated tasks / pending tasks / which clients pending* (§10). The single anchor metric (e.g., total outstanding dues, or count of stalled jobs) is chosen when the owner dashboard is laid out.

*New genuinely-open items will accumulate in `/docs/DECISIONS.md` (the append-only decision log), not here.*

---

## 14. Why we believe the model is sound

Across ~10 rounds, every new case — opacity, 20% commission, multi-tier Imu chains, referrers, vendors, white-label staff, volume/per-file pay, reputation, capacity, expertise, optional client-recording, resale to other domains, dynamic fields, fuzzy canonical search, asymmetric payment tracking, auto-updating invoices, projects-vs-jobs, milestone templates, multi-copy fan-out, mixed-rate layers, the detail-page hub — **reduced to the same primitives** (§2) plus the two recurring patterns (governance: *propose → confirm*; visibility: *see only your legs*). The spine **bent once** (tracking ≠ billing → the Project container) and **extended once** (a work item is *lines*, not a flat amount). That a model absorbs this many distinct stresses without sprouting a subsystem per case is the engineering signal that it's ready to be built.

---

## 15. Engineering & quality standards (delegated to CLAUDE.md)

The build agent is expected to apply standard engineering hygiene **everywhere, consistently** — comprehensive input validation, error/exception handling, edge-case and try/error coverage, security measures, and a coherent UI/UX design language. Agents *know* these practices, but applied *implicitly* they come out **uneven** (validated here, forgotten there) and **generic** (default patterns instead of this system's rules). Therefore the standards are stated **once** in `CLAUDE.md` so they're applied without re-instruction each prompt. The non-negotiables that are *specific to this system* (and must be in `CLAUDE.md`):

- **`org_id` on every table; every query scoped through one access layer.** No exceptions.
- **Every money figure passes through the visibility layer** (§4) — never render a leg to a party not on it. Enforce at the DB (row/field security), not just the UI.
- **Profit/margin/split is always derived from legs, never stored** (§11).
- **Money mutations are append-only ledger entries** — never edit/delete a posted entry; correct with a reversing entry.
- **Deal terms / comp rules / pricing / reference data are effective-dated** — never mutate history in place.
- **Provenance on every record** (who created/edited/confirmed, when) + **immutable audit log**.
- **Validate at the boundary** (API/schema-level), not just the form; assume any client input is hostile.
- **Governance pattern reused** (`propose → authorized-role confirm`) for writer-logged work, output-pay tallies, and new reference entities.
- **Capture-first UX** (§10) is a requirement, not a nicety: few-clicks add, pick-don't-type, draft-now-complete-later, mobile-first.

---

*End of v0.2. Next artifacts (started alongside this doc): `CLAUDE.md` (agent operating instructions + standards + stack), `/docs/SCHEMA.md` (concrete tables/columns for §2 entities), `/docs/DECISIONS.md` (append-only decision log), `/docs/PROGRESS.md` (what's built / in-progress / next — the agent's cross-session memory). Later: expanded visibility matrix cell-by-cell, deal-terms & comp-rules seed data, Claude Code subagent definitions for UI/UX + backend standards.*
