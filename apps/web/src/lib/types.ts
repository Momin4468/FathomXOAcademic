// Lightweight mirrors of the API responses the UI consumes. Money fields are
// optional on purpose: the API redacts them, so "absent" is the normal case and
// the UI must treat their absence as "not visible to me".

export interface Principal {
  userId: string;
  orgId: string;
  partyId: string | null;
  isSystemSuperadmin: boolean;
}

export interface WhoAmI {
  principal: Principal;
  party: { id: string; displayName: string } | null;
  roleNames: string[];
  permissions: string[]; // "module:action"
}

export interface WorkListRow {
  id: string;
  title: string;
  workState: string;
  moneyState: string;
  doerPartyId: string | null;
  sourcePartyId: string | null;
  updatedAt: string;
}

export interface WorkItem {
  id: string;
  title: string;
  details: string | null;
  workState: string;
  moneyState: string;
  sourcePartyId: string | null;
  doerPartyId: string | null;
  courseRefId: string | null;
  assignmentTypeRefId: string | null;
  isEstimate: boolean;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface WorkLine {
  id: string;
  lineKind: string;
  side: "consumer" | "producer" | "unassigned";
  writerPartyId: string | null;
  consumerPartyId?: string | null; // present only if money-visible
  wordCount: number | null;
  unitCount: number | null;
  sourceLineId: string | null;
  note: string | null;
  clientRate?: string | null; // money — present only if visible
  writerRate?: string | null;
  fixedAmount?: string | null;
  amount?: number; // computed — present only if visible
}

export interface Leg {
  id: string;
  seq: number;
  fromPartyId: string | null;
  toPartyId: string | null;
  amount: string;
  workLineId: string | null;
}

export interface MarginNode {
  partyId: string;
  inbound: number;
  outbound: number;
  margin: number;
}

export interface JobPnl {
  revenue: number;
  writerCost: number;
  clawback: number;
  reworkCost: number;
  net: number;
  isLoss: boolean;
}

export interface WorkDetail {
  item: WorkItem;
  lines: WorkLine[];
  legs: Leg[];
  margins: MarginNode[];
  pnl?: JobPnl | null; // present only when money-visible (work:approve)
}

export interface RefEntity {
  id: string;
  kind: string;
  canonical: string;
  status: string;
  parentId?: string | null;
}

export interface PartyRow {
  id: string;
  displayName: string;
  partyType: string[];
  externalRef: string | null;
  universityId: string | null;
  programme: string | null;
}

export interface Expense {
  id: string;
  category: string;
  amount: string;
  incurredAt: string;
  costBearer: string;
  costBearerSplitJson: Record<string, unknown> | null;
  payeePartyId: string | null;
  campaignTag: string | null;
  revenueLinkId: string | null;
  note: string | null;
  nextDueDate: string | null; // subscription (0026)
  currency: string | null; // recorded, no FX
  lastRemindedDue: string | null;
}

export interface Task {
  id: string;
  title: string;
  details: string | null;
  state: string;
  dueAt: string | null;
  dueTz: string | null;
  assigneePartyId: string | null;
  workItemId: string | null;
  completedAt: string | null;
  urgency: { overdue: boolean; msLeft: number | null; bucket: "overdue" | "soon" | "later" | "none" };
}

// ─── Billing (Module 5) ───────────────────────────────────────────────────────
// Money fields can be absent when the caller can't see them — treat absence as
// "not visible to me" and render nothing (see the file header).

export interface Invoice {
  id: string;
  clientPartyId: string;
  status: string; // open | sent | partial | paid | void
  isEstimate: boolean;
  supersedesInvoiceId: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  workLineId: string;
  amount?: number | string; // present when money-visible
  paid?: number; // derived from allocations
  due?: number;
  note: string | null;
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: InvoiceLine[];
}

export interface Payment {
  id: string;
  direction: "in" | "out";
  counterpartyPartyId: string | null;
  amount?: number | string; // present when money-visible
  paidAt: string;
  medium: string | null;
  trxId: string | null;
  note: string | null;
  reversesPaymentId: string | null;
  createdAt: string;
}

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  invoiceLineId: string | null;
  writerPartyId: string | null;
  chargeId: string | null;
  amount: number | string;
}

export interface PaymentProof {
  id: string;
  paymentId: string;
  fileObjectId: string;
  side: string;
  attachedBy: string;
  attachedAt: string;
}

export interface PaymentDetail {
  payment: Payment;
  allocations: PaymentAllocation[];
  proofs: PaymentProof[];
}

export interface ChargeItem {
  id: string;
  category: string;
  amount?: number | string;
  reason: string | null;
  workItemId: string | null;
  createdAt: string;
  due?: number;
}

export interface Balance {
  partyId: string | null;
  earnings: { owed?: number; paid?: number; outstanding?: number };
  charges: { owed?: number; paid?: number; outstanding?: number; items: ChargeItem[] };
  net?: number;
}

// ─── Files + knowledge base (Module 9) ────────────────────────────────────────
export interface FileMeta {
  id: string;
  kind: string;
  isLink: boolean;
  filename: string | null;
  mime: string | null;
  sizeBytes: number | null;
  url: string | null; // present only for links; stored files download via /api/files/:id
  createdAt?: string;
}

export interface KnowledgeArticleRow {
  id: string;
  type: string;
  title: string;
  universityRefId: string | null;
  programmeRefId: string | null;
  status: string;
  updatedAt: string;
}

export interface KnowledgeArticle extends KnowledgeArticleRow {
  body: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ArticleDetail {
  article: KnowledgeArticle;
  attachments: FileMeta[];
}

export interface CoverSheet {
  id: string;
  name: string;
  universityRefId: string | null;
  programmeRefId: string | null;
  fileObjectId: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface RefLite {
  id: string;
  kind: string;
  canonical: string;
}

export interface UniversityHub {
  university: RefLite;
  programmes: RefLite[];
  referencingStyles: RefLite[];
  articles: KnowledgeArticleRow[];
  coverSheets: CoverSheet[];
}

// ─── Check service (Module 10) ────────────────────────────────────────────────
export interface CheckChannel {
  id: string;
  label: string;
  employeePartyId: string;
  active: boolean;
}

export interface CheckToolAccount {
  id: string;
  label: string;
  vaultItemId: string | null;
  active: boolean;
  credit?: { purchased: number; consumed: number; remaining: number; spend: number; costPerCredit: number };
}

export interface CheckBatchRow {
  id: string;
  channelId: string;
  channelLabel: string;
  toolAccountId: string | null;
  periodDate: string;
  filesChecked: number;
  filesPaid: number;
  amountCollected: string;
  customerPartyId: string | null;
  workItemId: string | null;
  status: string;
  note: string | null;
  recordedBy: string | null;
  confirmedBy: string | null;
}

export interface CheckPnl {
  revenue: number;
  accountCost: number;
  workerComp: number;
  net: number;
  filesChecked: number;
  filesPaid: number;
  marginPerCheck: number | null;
}

// ─── Referrers (Module 11) ────────────────────────────────────────────────────
export interface Referrer {
  id: string;
  displayName: string;
  partyType: string[];
  externalRef: string | null;
}

export interface ReferrerTerm {
  id: string;
  basis: string | null; // revenue | margin | fixed
  value: string;
  appliesTo: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ReferralSuggestion {
  workItemId: string;
  referrerId: string | null;
  referrerName: string | null;
  revenue: number;
  margin: number;
  term: { basis: string | null; value: string; appliesTo: string; effectiveFrom: string } | null;
  suggestedAmount: number | null;
  source: "derived" | "unpriced" | "no_referrer";
}

export interface ReferrerWork {
  workItemId: string;
  title: string;
  clientName: string | null;
  referralAmount: string;
  referralAt: string;
  jobCreatedAt: string;
}

export interface MyReferrals {
  works: ReferrerWork[];
  balance: Balance;
}

// ─── Custom fields (Module 12) ────────────────────────────────────────────────
export interface CustomFieldDef {
  id: string;
  targetEntity: string; // work_item | party | project
  fieldName: string;
  fieldType: string; // text | number | date | select | bool
  optionsJson: string[] | null;
  scopeJson: Record<string, string> | null;
  required: boolean;
  sort: number;
  archivedAt: string | null;
}

/** A field + current value for a record's detail (describeForRecord). */
export interface CustomFieldOnRecord {
  id: string;
  fieldName: string;
  fieldType: string;
  options: string[] | null;
  required: boolean;
  value: unknown;
  missingRequired: boolean;
}

// ─── Dashboard (Module 13) ────────────────────────────────────────────────────
export interface DashboardData {
  balance: Balance | null;
  openLoops: { count: number; scope: "all" | "mine" };
  owner?: {
    outstandingDuesTotal: number;
    pendingClientCount: number;
    duesByClient: Array<{ clientPartyId: string; invoiced: number; paid: number; due: number }>;
    profitPerWriter: Array<{ writerPartyId: string; jobs: number; revenue: number; writerCost: number; profit: number }>;
    orgMargin: { revenue: number; writerCost: number; margin: number };
    openLoopsTotal: number;
  };
}

// ─── Settlement (§4.4) ────────────────────────────────────────────────────────
export interface SettlementResult {
  partnerA: string;
  partnerB: string;
  jobCount: number;
  totalPool: number;
  accrual: { partyA: number; partyB: number };
  transfersNet: number;
  net: { aMinusB: number; owedBy: string | null; owedTo: string | null; amount: number };
}
export interface SettlementTransfer {
  id: string;
  fromPartyId: string;
  toPartyId: string;
  amount: string;
  transferredAt: string;
  medium: string | null;
  note: string | null;
  reversesTransferId: string | null;
}

// ─── Credential vault (§8) ────────────────────────────────────────────────────
export interface VaultItem {
  id: string;
  name: string;
  type: string;
  url: string | null;
  clientPartyId: string | null;
  createdAt: string;
}
export interface VaultSecret { username?: string; password?: string; totpRecovery?: string; notes?: string }
export interface VaultReveal extends Omit<VaultItem, "createdAt"> { secret: VaultSecret }
export interface VaultManageItem extends VaultItem { shareCount: number }
export interface VaultShare { id: string; partyId: string; grantedAt: string; grantedBy: string | null }

// ─── Outcomes + reputation (§8) ───────────────────────────────────────────────
export interface Outcome {
  id: string;
  workItemId: string;
  writerPartyId: string | null;
  onTime: boolean | null;
  daysLate: number | null;
  revisionCount: number;
  revisionFault: string | null;
  grade: string | null;
  markerFeedback: string | null;
  complaint: boolean;
  complaintReason: string | null;
  failed: boolean;
  aiScore: string | null;
  satisfaction: string | null;
  reworkCost: string | null;
  disputed: boolean;
  recordedAt: string;
}
export interface Reputation {
  jobCount: number;
  onTime: { count: number; measured: number; rate: number | null };
  avgDaysLate: number | null;
  revisionRate: number | null;
  writerFaultRevisions: number;
  complaint: { count: number; rate: number | null };
  failRate: number | null;
  avgAiScore: number | null;
  satisfaction: { high: number; neutral: number; low: number };
  gradedCount: number;
  totalReworkCost: number;
  disputedCount: number;
  reliabilityScore: number | null;
}
export interface WriterCard {
  profile: { partyId: string; displayName: string; expertiseTags: string[]; availability: string; maxConcurrent: number | null };
  reputation: Reputation;
  courseHistory: Array<{ courseRefId: string; courseName: string | null; jobCount: number; lastWorkedAt: string }>;
  load: { openJobs: number; availability: string; maxConcurrent: number | null; atCapacity: boolean | null };
}

// ─── Party / client-360 detail ────────────────────────────────────────────────
export interface PartyDetail {
  id: string;
  displayName: string;
  partyType: string[];
  externalRef: string | null;
  programme: string | null;
  universityId: string | null;
  universityCanonical: string | null;
  referredByPartyId: string | null;
  referredByName: string | null;
  customFields: CustomFieldOnRecord[];
  createdAt: string;
}

export const can = (perms: string[] | undefined, key: string) => !!perms?.includes(key);
