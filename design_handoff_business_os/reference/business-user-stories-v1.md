# Business User Stories, Roles & Workflows — v1 (Independent Analysis)

## How this document was built, and how to use it

This is an independent synthesis, deliberately written **before** looking at
the current codebase again — per your instruction, so the audit that follows
compares "what the business actually needs" against "what's built," rather
than reverse-engineering the story from the schema.

Three sources were used:
1. **Your detailed written narrative** (the Writer user story message) — the
   primary source of truth for this document.
2. **Three real spreadsheets** — `Emon_Dashboard_V1.xlsx` (per-writer task +
   payment ledgers, an expense sheet, a capstone group-billing sheet),
   `X-MBA_Invoice_V2.xlsx` (client-facing invoice tracking across BBA/MBA/IT
   cohorts), `Another_Book.xlsx` (thesis line-level profit tracking, a
   business-wide OVERALL settlement ledger, and a client Master index).
   These surfaced real patterns your narrative didn't mention explicitly —
   flagged clearly in Section 4 below, not silently folded in as if they were
   always part of the story.
3. **`Finance_App_Prompt_V1.txt`** (your very first prompt) — used only as a
   **contradiction check** (Section 6), per your instruction, not as a
   source of requirements.

Everything money-related that the spreadsheets show happening in practice
but that isn't clearly *decided* (as opposed to just *observed*) is called
out explicitly in Section 5 as an open question — this document does not
invent business rules to fill gaps.

---

## In plain words — what this system actually is

Momin and Emon each used to run their own small academic-writing business
— sourcing work, doing it themselves or handing it to writers, and keeping
the difference as profit. They've since merged. Work can still arrive from
many directions — a paying client, a fellow writer who can't take a job
themselves, a vendor who just wants it done, or a partner who takes a cut
for bringing the work in — but however it arrives, it flows the same basic
way: someone sources it, a writer does it, the client pays, the writer
gets paid, and whatever's left over is profit, split between whoever's
entitled to a share of that particular job. Everyone in that chain only
needs to see their own piece of it — a writer doesn't need to know what
the client actually paid, and a partner higher up doesn't need to know
what a partner lower down quietly keeps for themselves.

Around that money engine sit the other things the business needs day to
day: proper invoices for clients who want them, task reminders so nothing
gets forgotten, a shared vault for tool logins, a place to keep useful
documents and know-how, and — kept entirely separate and private — each
person's own personal finances, which the business side of the system is
never allowed to see. The whole point of building this properly is to
replace what's currently done by hand across WhatsApp chats, whiteboards,
and a growing pile of separate Excel sheets — one sheet per client, one
per writer — with one system everyone actually uses.

---

## 1. Roles

| Role | Who | Notes from evidence |
|---|---|---|
| **SuperAdmin** | You (Momin), explicitly | "Backdoor" visibility into everything **except personal finance** — PF stays structurally private, even from SuperAdmin, by design: that privacy guarantee is the actual product being sold when PF becomes a paid feature for others, and it would be broken by any exception. Everywhere else (vendor-side margins, all business-plane data), SuperAdmin sees everything. On a day-to-day basis you said you'll mostly operate as Admin/Writer, not as SuperAdmin — SuperAdmin is a capability, not your default working mode. |
| **Admin — Momin** | You | A distinct admin *identity*, not interchangeable with Admin-Emon — each admin has their own client base, their own writers, their own invoicing style (you invoice properly with full client records; Emon runs his side almost entirely through WhatsApp). |
| **Admin — Emon** | Emon | Separate admin identity from Momin, own client base, own writers, own commission arrangements (with Lemon and possibly others). |
| **Writer** | e.g. Humaira, Mitul, Khalid, Rafsan, Durjoy, Fatin, Fahim, Ishaan, and many more named in the sheets | Records tasks (university, module code, assignment type, word count/details, fee), gets paid, needs to see their own earnings/works. A writer's *actual take-home* fee is frequently **less** than the true amount the client paid — this gap is structural, not incidental. |
| **Writer-who-also-sources (broker writer)** | e.g. Khalid taking work from a client and handing it down at a lower price for someone else to do; "Imu" being handed civil-engineering work by Emon and further sub-contracting to his own writers | A writer can simultaneously be a downstream recipient of work *and* an upstream source to other writers, in the same task-chain, on different jobs. The system needs to treat "writer" and "source" as independent facts about a party, not mutually exclusive roles. |
| **Vendor** (e.g. "Toma Apu") | Third-party who brings in work and expects it done, no visibility needed | "Headache-free" — vendors don't need dashboards showing your internal margin, only what's relevant to *their* side (their own tasks/payments if they want it). What they charge their own clients is explicitly none of your business's concern. |
| **Referral / Profit-share Partner** (e.g. "Lemon") | Someone who sources work and is compensated from profit — usually a percentage cut, but a flat cut is used instead for low-volume work, chosen situationally | Anyone who sources work can become a partner — there's no fixed list of who qualifies; sourcing the work is the only qualifying trait. What actually distinguishes a Partner from a Vendor isn't the payment mechanism (both can end up with a flat amount) — it's visibility: a Partner can get real system access to see their own share and running balance, where a Vendor is deliberately "headache-free" and doesn't need or want it. Evidence (`OVERALL` sheet) already confirms this extends well beyond two people — Antu, Shohan, and Mohsin each have their own running profit-share settlement balances ("Antu Pabe," "Shohan Pabe," "Mohsin Pabe"), independent of the Emon↔Momin split. Partners are not necessarily connected to or aware of one another — two partners can each deal with the business independently with no relationship to each other at all. |
| **Future: Employees (HRM)** | Not yet built | Broader than just marketer/promoter — envisioned as a full HRM-style section for writer/employee management generally. Employees are paid per contract (salary-based), not per-task the way writers are. They can log their own work (how much they've done) without necessarily seeing or entering price/rate figures at all, while the business separately tracks what's actually collected and paid to derive profit from that work. An employee's salary is managed by whichever partner/source they're "owned" by — tied to whichever partner's chain they sit under, not centrally administered. Deferred, but the data model shouldn't have to be redesigned to add it later. |
| **Future: Client** | Already built, not yet turned on | The client-portal infrastructure (client accounts, messaging, public quote intake) already exists from the prior engineering phase and can be completed/turned on when wanted, rather than built from scratch. The primary intended use is read-only: clients seeing their own work summaries and dues. Client-facing *communication* stays WhatsApp-based in practice — the in-system messaging feature, even though built, isn't needed right now. For new quote requests, the real want is a direct notification straight to email and WhatsApp when one comes in; an email-notify hook for this already exists in the built system but is currently unconfigured, while an automatic WhatsApp push does not yet exist and would be new work. Storing the quote as a structured lead record isn't strictly necessary in your view, but you're fine leaving that behavior as-is for now. New requirement: client account username and password should both be auto-derivable from the client's student ID plus part of their name, so accounts can be created automatically, or manually with minimal clicks. |

---

## 2. Core concepts & vocabulary (grounded in real evidence, not invented)

- **Task / Work item.** The atomic unit of billable work. Recorded fields
  seen consistently across writers' real sheets: university, module
  code (the *most* important field, per your narrative), module name,
  assignment type & number (A1/A2/A3; tutorials numbered separately;
  class-works/tutorials/assignments/assessments/coursework all treated as
  one bucket; exams are a distinct bucket), word count or other
  size measure (slide count, page count, "weight %"), delivery date,
  submission date, group-vs-individual flag (with a note for
  full-group-vs-partial if group).
- **Referral/Client/Student source tag.** Nearly every real task row
  carries a name in a "Referral/Client/Student" column — who introduced or
  is otherwise associated with this specific task. This is the field that
  later drives profit-share/commission computation. It is *not* always
  the same as "who will pay" or "who does the work."
- **Client info.** Name, ID, university, sometimes login credentials —
  recorded when known; frequently *not* known to the writer, only to the
  admin.
- **Pricing is negotiated per instance, not pulled from a fixed price
  list — but past rates are commonly used as a reference point.** When a
  similar piece of work has been priced before, that prior rate is often
  looked up and used as the starting point, then adjusted up or down for
  the present case. The same exact course code, in the same exact cohort,
  is still billed to different clients at different per-word rates (seen
  repeatedly in `X-MBA_Invoice_V2.xlsx` — e.g. one course billed at
  ৳0.6/word to one client and ৳1.8/word to another in the same batch).
  "Optimum, not fixed" per your narrative is confirmed exactly by the real
  data — optimum here means anchored to precedent, not looked up from a
  static table.
- **Two distinct running amounts per client: Expected vs. Due/Remaining.**
  These are tracked as separate numbers, not derived from one field —
  "Total Payment Expected" and "Total Payment Due" appear as sibling
  columns throughout the writer sheets, and "Total / Paid / Remaining" as
  a parallel triplet in the invoice sheets.
- **"Previous Due" carries forward across billing cycles.** A repeat
  client's next round of invoicing starts from a nonzero prior balance,
  not from zero — this is a real, recorded pattern (`X-MBA_Invoice_V2`,
  `BBA_Mujibur_Sem2` sheet).
- **Corrections/adjustments are separate line items, not edits.** A
  correction to already-delivered work gets its own fee line
  ("Corrections/Other files" column), consistent with the append-only,
  never-edit principle already established for this system's ledger.
- **Discounts are applied two different ways in practice**: (a) a flat
  negative line item ("Discount −3000"), or (b) a lower effective
  per-word rate charged directly on the line, with no separate discount
  line at all. Both need to be representable.
- **Delivered work can exist with no price yet.** Several real rows show
  work already delivered with "price not quoted yet" or a literal
  `(missing)` placeholder in the fee column — pricing can lag delivery,
  confirming your narrative's "sometimes this is recorded when task is
  given and sometimes after delivery," but showing it can lag all the way
  past delivery, not just past assignment.
- **Group cohort billing, one course, many students, one shared
  deliverable, individually priced.** In a class/cohort course (e.g. the
  BMMB70xx batch of ~18 students), each student is billed individually for
  shared assignments, and a **shared group presentation can be paid in
  full by just one member**, with ৳0 charged to the rest of that specific
  group ("Presentation PAID BY EMAD (0 charged here)" — the whole group's
  presentation fee collected from one person). This is a distinct pattern
  from "the whole class pays the same price."
- **Per-line profit can be negative even when the overall client
  relationship is profitable.** The `Thesis` sheet computes profit
  line-by-line (Client-to-be-paid minus Writer-to-be-paid) and shows real
  cases where one sub-task's line is a loss (writer still had to be paid
  in full even though that specific piece wasn't separately billed to the
  client) while the client relationship as a whole nets positive. This
  matches — and is real-world validation for — the existing "loss on one
  job, profit on the whole" logic already built into this system.
- **Settlement/profit-share is a genuinely multi-party ledger, not just
  Emon↔Momin.** The `OVERALL` sheet's running settlement includes not
  just the Emon/Momin split but independent "Pabe" (receivable) balances
  for at least three other named individuals (Antu, Shohan, Mohsin), each
  computed differently (some as a flat per-job rate × job count, some as
  a percentage), and settled with partial, dated transfers over months —
  the same shape as the existing `settlement_transfer` mechanism, just
  with more parties than currently modeled examples show.
- **Loans are extended to far more people than just the two admins.** A
  dedicated "Loan Hishab" ledger names a dozen-plus individuals (writers,
  vendors, and people not otherwise appearing as writers or clients at
  all) each with their own loan balance and repayment notes. **Decided:**
  loans to writers and vendors are a business-side concern — tracked in
  the system as ordinary paid/receivable/payable amounts, not personal
  finance. Purely personal loans (an admin's own money, tracked for
  themselves) stay in the private PF plane exactly as already built. See
  Section 5, item 8.
- **Multi-currency and multi-platform payment is real, not
  hypothetical.** Confirmed payment mediums: Bank (several named banks),
  Bkash, Nagad, DBBL, MTB, USDT (with a manually-tracked conversion rate
  to BDT), and at least one GBP-denominated balance settled through a
  named individual acting as an informal currency agent ("Anchit (170
  Pound)"). Currency conversion is currently done by hand, with the rate
  noted inline.
- **Tool/subscription costs are deducted as negative entries directly
  against a person's earnings**, frequently as a plain text comment next
  to a "payment received" row rather than a structured expense record
  (e.g. "Turnitin," "Claude Purchase," "ChatGPT" all appear this way).
  There is also a separate, more structured monthly expense list
  (Month / Description / Amount) for shared/business-level costs —
  including at least one clearly personal, non-business cost recorded in
  the same list ("Tour").
- **Data-quality problems are already a real, self-reported pain
  point.** You (or Emon) have literally written "FLAG — may overlap
  existing block" directly into invoice notes when spotting probable
  duplicate entries by eye. Duplicate/overlap detection is not a
  theoretical nice-to-have; it is something you are already doing
  manually and finding taxing.
- **The current per-client-sheet convention doesn't scale.** The `Master`
  sheet is literally an index of ~40 individual clients, each pointing at
  their own separate tab/sheet. This is the direct, visible cost of the
  current tooling that the new system needs to remove.

---

## 3. Detailed workflows

### 3.1 Task intake & recording
A task is created when work is handed to a writer (by an admin, or by
another writer acting as a broker). The writer records: university, module
code, module/assignment identity, size/weight, group-or-individual (and
if group, full-or-partial), delivery/submission dates, and their own fee —
**at whatever point in the process this information becomes known**, which
may be at assignment, at delivery, or (per real evidence) sometime after
delivery. The system should not force all of these to be known upfront.

A task may be tagged with a **referral/source** name distinct from who is
doing the work and distinct from who the client is — this tag is what
downstream profit-share/commission computation keys off, and it may or may
not be visible to the writer performing the work.

### 3.2 Pricing & discounts
Price is negotiated per instance (per client, per course, sometimes per
copy within the same course), commonly by referencing what was charged
before for the same or similar work as a starting point and adjusting it
up or down for the present case — not pulled from a fixed price list.
Discounts appear either as an explicit negative adjustment line or as a
directly-lower quoted rate with no separate discount line. When a discount
is applied on the client side, the writer's fee is sometimes adjusted
downward to match and sometimes left untouched (an explicit business
decision each time, not automatic) — the writer must be able to see when
their fee was adjusted because of a client-side discount, per your
narrative ("this is noted so that writer knows").

A related but distinct pattern is more common in practice than a formal
discount: the initial asking price and the amount actually agreed/collected
simply differ, and the recorded price is corrected in place to the real
figure — quote ৳50,000, actually collect ৳45,000, and the recorded price
becomes ৳45,000, done manually (in Excel, literally overwriting the price
cell). From the client's side this can look like a discount was given, but
internally no formal discount ever occurred — ৳45,000 is treated as the
real, final price, and writer payment and profit are computed from that
corrected figure, not from the original ask. The "ask" and the "final
settled price" are two different things, and only the settled one drives
the money math.

### 3.3 Course / Thesis / Project (multi-task) handling
When a whole course, thesis, or project is taken as one commitment, all
constituent deliverables and deadlines are recorded together, and pricing
is agreed **in bulk** for the whole commitment — not built up row-by-row
from individually-priced pieces. This is straightforward when the
commitment is fully individual work. It gets materially harder when the
commitment includes **group deliverables inside an individually-priced
bulk course** (your own example: a course with 4 group members, weekly
individual tutorials *and* group assignments, priced as one bulk sum, no
row-by-row pricing) — writers must still track exactly which copy/member
they're producing for, even though there's no separate price to attach to
each copy.

The same bulk-pricing pattern also shows up with no group element at all:
several separate individual assignments or courses for one client are
sometimes billed together as one combined sum rather than priced
individually — in the real spreadsheets this is done literally by merging
cells across the price column for that client's several task rows. Each
underlying task still needs its own record (its own module/assignment
identity, word count, etc.), but the price attached is one combined
figure for the set, not a sum of independently-set per-task prices.

Thesis-type work specifically tracks **per-line profit** (client fee
minus writer fee per deliverable — proposal, ethics form, data collection,
report, etc.), and it is normal for individual lines to be loss-making
as long as the whole relationship remains profitable.

### 3.4 Client invoicing
For a single client, multiple tasks accumulate into one invoice. Discounts
may apply once enough volume accumulates, which can retroactively require
adjusting an already-recorded writer fee (with the writer notified, per
3.2). A repeat client's invoice can carry forward a **previous due**
balance from an earlier billing cycle rather than starting fresh.

Momin's side does this with full client records (name, ID, university)
kept from the start. Emon's side runs almost entirely through WhatsApp,
without necessarily knowing (or needing to know) full client identity —
Emon sometimes asks Momin to generate an invoice for *Emon's* client using
only a breakdown/summary of work done, without ever knowing that client's
name or ID.

Group-cohort courses (a whole class/batch) are invoiced with each student
billed individually, but a shared group deliverable's fee can be
collected in full from a single group member with the rest of the group
charged nothing for that specific item.

### 3.5 Writer payment
Writers are paid on their own schedule, disconnected from when the client
pays — both sides are tracked independently to know what's incoming, what's
outgoing, and the resulting profit, rather than deriving one from the
other. A writer's payment may be reduced by tool/subscription costs the
business covers on their behalf (credential vault subscriptions), recorded
as a deduction against that specific writer's earnings.

### 3.6 Multi-party chains & profit-share
Every real chain scenario from your narrative is independently confirmed
in the spreadsheets:
- **Direct**: client pays business, business pays writer, remainder is
  profit, split between whichever admins/partners are entitled to it.
- **Cross-admin handoff with commission**: one admin sources and prices
  the work, hands it to the other admin's writer chain, and takes a
  commission percentage (your example: 20%) rather than a profit split —
  the rate itself can be set per task rather than being one fixed
  percentage applied to everything.
- **Multi-hop chains with hidden margins at each hop** (Emon→Imu→Imu's
  writers): each party in the chain only needs to know their own
  hop's numbers; what a downstream party collects beyond what they pass
  upward is deliberately not visible to the party above them, but is
  still recorded for that party's own accounting.
- **Source-based splits** (web vs. Facebook lead source changing the
  Emon/Momin split) — the split percentage is a property of *how the work
  was sourced*, not fixed globally.
- **More than two profit-sharing parties exist simultaneously** — Lemon,
  and independently Antu/Shohan/Mohsin, each with their own arrangement
  and their own running settlement balance against the business, settled
  via irregular, partial, dated transfers.

### 3.7 Vendor / referral handling
A pure vendor (no percentage arrangement) simply hands over a task and
receives whatever was agreed, with zero further visibility into your
internal margin or process. A profit-share partner instead earns a
percentage of profit rather than a flat handoff amount, and — unlike a
vendor — may want their own visibility into their share of jobs and
running balance.

### 3.8 Expenses & tool-cost deduction
Two distinct expense patterns exist and both need supporting:
1. **Shared/business-level recurring costs** (AI subscriptions, tool
   licenses) tracked as a simple running monthly list, deducted from
   overall profit before it's split between partners.
2. **Per-writer tool costs** (a specific writer's use of a paid checking
   tool) deducted directly from that specific writer's own earnings,
   not from the shared business pool.

### 3.9 Personal finance (future subscription product)
Independently of the business ledger, each person (initially Momin/Emon,
eventually offered as a paid product to others including writers) tracks
their own expenses, loans given/taken, savings, and targets — entirely
walled off from the business plane, matching the existing personal-finance
isolation already built. Loans specifically need to support: to/from many
different named individuals (not just Emon↔Momin), partial/staged
repayment over time, and running balances per lender/borrower pair.

### 3.10 Task / reminder tracking
Both admins currently rely on whiteboards and physical diaries to avoid
forgetting due tasks — a real, named pain point, not a hypothetical
feature request. The replacement needs to support due-task lists/reminders
at whatever granularity a task or sub-deliverable within a bulk course
needs (a single weekly deliverable inside a larger course commitment, not
just the course as a whole).

### 3.11 Credential vault / shared tool access
Business-purchased tool logins (e.g. a checking/plagiarism tool with
multiple seats) are shared with specific writers on a partial basis — one
writer might see 2 of 5 accounts, another sees 3 of 5, with no writer
seeing accounts they weren't explicitly granted. This matches the
already-built per-item, per-holder credential-sharing model.

### 3.12 Knowledge base / documents
Best-practice documents and prompt packs are shared internally, authored
by anyone who finds something worth sharing, in whatever form is
convenient (a blog-style post, or similar) — video files themselves are
never stored directly, only links to videos hosted elsewhere.

### 3.13 Commercialized checks / plagiarism tooling
When AI/plagiarism checks are sold as a service to others (not just used
internally), that revenue and its associated cost need their own tracking
— this is already partially represented in the existing check/credit
system.

### 3.14 Permissions
SuperAdmin sees and can act on literally everything across the business
plane. Personal finance is the one deliberate exception — it stays walled
off even from SuperAdmin, resolved and confirmed, not a remaining tension
(see Section 5, item 7).
Admin-Momin and Admin-Emon are separate identities with their own scoped
visibility, not a shared "Admin" role. Day-to-day, you expect to operate
as an ordinary Admin/Writer, reaching for SuperAdmin capability only when
actually needed.

### 3.15 Admin broadcast & notifications
An admin can send a notification to a chosen audience: everyone, a
hand-picked custom set of users, or an entire role. Several distinct
notification types are anticipated — the exact set still needs defining,
not assumed here. This is in-system only; no email channel is needed for
this. On the receiving end: a bell icon carrying an unread-count badge, a
panel/dropdown listing notifications, the ability to mark one or all as
read, and pop-ups for at least some notification types rather than
requiring the user to go check the bell.

---

## 4. Patterns found only in the spreadsheets — not in your narrative

Flagged separately and explicitly, as requested, so nothing new gets
silently treated as if you'd already described it:

1. **Group-cohort billing with per-student custom pricing on the
   identical course/assignment**, including one member's payment covering
   a shared group deliverable for the whole group.
2. **Per-line negative profit within an overall-profitable
   relationship** (thesis sub-tasks).
3. **A genuinely multi-party profit-share settlement ledger** — at least
   three more named individuals (Antu, Shohan, Mohsin) beyond Emon/Momin
   and Lemon, each with independently-computed running balances.
4. **Loans extended to a much wider set of people** than the two admins —
   writers, vendors, and others.
5. **Real multi-currency handling**, including an informal
   currency-conversion agent for GBP and a manually-tracked USDT/BDT rate.
6. **"Previous Due" explicitly carrying forward** across a repeat
   client's separate billing cycles.
7. **Delivered-but-unpriced work** as a real, recurring state, not just
   "priced late."
8. **Manual duplicate/overlap detection** ("FLAG…") as an existing,
   self-identified pain point.
9. **A literal "one sheet per client" ceiling** (~40 client tabs feeding
   one master index) as the concrete, visible symptom of the scaling
   problem this whole rebuild is meant to solve.

---

## 5. Decisions & remaining open items

The questions raised against the spreadsheet evidence have mostly been
settled. Two remain genuinely open — marked as such below, not glossed
over.

1. **Resits / fails / clawbacks — decided, and situational by design.**
   If a resit is done by the same writer and tracked as such, no fee
   reversal is needed — it's part of the same commitment, not a new
   billable event. If a resit goes to a *different* writer, it's handled
   case by case: either both writers are paid their respective portions,
   or the original writer gets nothing for that piece — this is a genuine
   business judgment call each time, not a single fixed formula. If there's
   no resit and the client simply never pays, the writer gets nothing, or
   a small token amount, at the business's discretion.
2. **The 10%/40% split in the `OVERALL` sheet — partially clarified,
   still open.** The 10% figure was a reserved estimate for another
   partner whose arrangement isn't yet finalized — it exists to give a
   running check on roughly what that partner would be owed, not as a
   settled rule. The 40% figure's meaning is still unclarified. Treat both
   as provisional until that partner arrangement itself is actually
   decided — this should not be modeled as a fixed rule yet.
3. **Partner eligibility — decided, and broader than the question asked.**
   There's no fixed list of named partners; anyone can be one. The
   qualifying logic is simple: sourcing the work is what makes someone a
   partner. Compensation for sourcing isn't always a percentage either —
   for low-volume work, a flat cut can be used instead of a percentage,
   chosen situationally depending on the work. Partners should be able to
   get real system access to see their own share, with strict isolation:
   no partner sees another partner's data unless it's explicitly shared
   with them — consistent with the opacity principle already used
   elsewhere in the system.
4. **Negative-margin lines — decided.** The system should flag them
   rather than let them pass silently, so overall profitability is easy
   to check at a glance.
5. **Multi-currency — decided, with one important addition.** BDT is the
   single primary ledger currency. Other currencies (GBP, USD, AUD, and
   presumably others) can be recorded, but only as the *transaction
   medium* — how a payment was received, or how a client is billed —
   converted to BDT at either a manually-entered daily rate or a rate the
   system fetches automatically (left open which, as an implementation
   choice). One real detail that needs its own tracking: the Bangladesh
   government pays a 2.5%-per-1000-BDT incentive on certain incoming
   foreign-currency transactions through formal banking channels. Some
   clients wrongly try to count this incentive as part of what they owe,
   since it reads to them as "extra money you received" — but it's a
   bonus paid to the business by the government, entirely separate from
   the client relationship. This needs to be tracked as its own distinct
   income line, never netted against or confused with what a client
   actually owes.
6. **Duplicate/overlap detection — left to implementation judgment.** Not
   a fixed requirement from you; approach it however serves the system
   best when this gets built.
7. **SuperAdmin vs. personal-finance privacy — decided.** PF stays
   private, including from SuperAdmin. This was a genuine tension between
   the narrative and the built system; resolved toward keeping the built
   privacy guarantee intact, since that privacy is the actual product
   being sold.
8. **Business-side loan/advance ledger for writers and vendors —
   decided.** These loans are tracked in the system as ordinary business
   paid/receivable/payable amounts, not personal finance — needs a
   business-plane advance/loan ledger (currently not built; see
   BUSINESS_MODEL_AUDIT.md §4.4). Purely personal loans remain in the
   private PF plane as already built.

---


---

## 7. Suggested next step

Once you've reviewed this and settled Section 5's open questions, the
natural next move (as you said) is to audit this document against the
current codebase/schema — table by table, workflow by workflow — to find
exactly where the built system already matches this reality, and where it
needs to change. That's a separate pass from this one, and shouldn't be
started until this document reflects what you actually want, not just
what the spreadsheets happened to show.
