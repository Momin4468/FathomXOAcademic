/** Types for the Personal Finance plane (§11). */
import { formatMoney } from "./format";

export interface PfProfile {
  id: string;
  email: string;
  displayName: string | null;
  baseCurrency: string;
  linked: boolean;
  twofaEnabled: boolean;
}

export interface PfCategory {
  id: string;
  kind: "income" | "expense" | "investment";
  name: string;
  archivedAt: string | null;
}

export interface PfEntry {
  id: string;
  categoryId: string | null;
  amount: string;
  currency: string;
  convertedAmount: string | null;
  convertedCurrency: string | null;
  occurredOn: string;
  note: string | null;
  source?: string;
  reversesId: string | null;
}

export interface PfLoan {
  id: string;
  direction: "given" | "taken";
  counterpartyName: string;
  principal: string;
  currency: string;
  startedOn: string;
  dueOn: string | null;
  note: string | null;
  outstanding: string;
  archivedAt: string | null;
}

export interface PfLoanEvent {
  id: string;
  loanId: string;
  kind: string;
  amount: string;
  occurredOn: string;
  note: string | null;
  reversesId: string | null;
}

export interface PfSaving {
  id: string;
  name: string;
  currency: string;
  targetAmount: string | null;
  note: string | null;
  balance: string;
  archivedAt: string | null;
}

export interface PfSavingEvent {
  id: string;
  savingId: string;
  kind: string;
  amount: string;
  occurredOn: string;
  note: string | null;
  reversesId: string | null;
}

export interface PfInvestment {
  id: string;
  categoryId: string | null;
  name: string;
  currency: string;
  principal: string;
  startedOn: string;
  note: string | null;
  archivedAt: string | null;
  // Derived at read (never stored):
  costBasis: number;
  currentValue: number;
  unrealizedPl: number;
}

export interface PfInvestmentEvent {
  id: string;
  investmentId: string;
  kind: string; // valuation | contribution | withdrawal
  amount: string;
  occurredOn: string;
  note: string | null;
  reversesId: string | null;
}

export interface PfCashCheckin {
  id: string;
  asOf: string;
  declaredAmount: string;
  currency: string;
  note: string | null;
}

export interface PfReconcile {
  status: "none" | "baseline" | "reconciled" | "over" | "under";
  latest: PfCashCheckin | null;
  prior?: PfCashCheckin | null;
  netFlow?: number | null;
  expected?: number | null;
  discrepancy?: number | null;
  suggestedAdjustment?: { kind: "income" | "expense"; amount: number; currency: string } | null;
}

export interface PfTarget {
  id: string;
  kind: "budget_cap" | "income_goal" | "savings_target";
  categoryId: string | null;
  period: "month" | "year";
  periodStart: string;
  periodEnd: string;
  amount: string;
  currency: string;
  note: string | null;
  current: string;
}

export interface PfSubscription {
  id: string;
  name: string;
  categoryId: string | null;
  amount: string;
  currency: string;
  nextDueDate: string | null;
  lastRemindedDue: string | null;
  note: string | null;
}

export interface PfDashboard {
  displayName: string | null;
  baseCurrency: string;
  linked: boolean;
  month: { income: string; expense: string; net: string };
  loans: { givenOutstanding: string; takenOutstanding: string };
  savingsTotal: string;
  investmentsTotal: string;
  cashOnHand: string;
  netWorth: {
    value: string;
    assets: { savings: string; investments: string; receivable: string; cash: string };
    liabilities: { owed: string };
    monthlyFlow: { income: string; expense: string; net: string };
  };
  upcomingSubscriptions: Array<{ id: string; name: string; amount: string; currency: string; nextDueDate: string }>;
  recent: Array<{ kind: string; id: string; amount: string; currency: string; occurredOn: string; note: string | null }>;
}

export interface PfNoteItem {
  text: string;
  done: boolean;
}

export interface PfNoteAttachment {
  id: string;
  noteId: string;
  isLink: boolean;
  url: string;
  filename: string | null;
  sizeBytes: number | null;
  mime: string | null;
}

export interface PfNote {
  id: string;
  title: string | null;
  body: string | null;
  items: PfNoteItem[];
  color: string | null;
  pinned: boolean;
  remindOn: string | null;
  lastRemindedOn: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  attachments?: PfNoteAttachment[];
}

export const NOTE_COLORS = ["default", "yellow", "green", "blue", "pink", "gray"] as const;

/** Map a note color to a left-strip Tailwind class. */
export const NOTE_COLOR_BG: Record<string, string> = {
  default: "bg-gray-200",
  yellow: "bg-amber-300",
  green: "bg-emerald-300",
  blue: "bg-blue-300",
  pink: "bg-pink-300",
  gray: "bg-gray-400",
};

/** Per-account PF settings (0035). */
export interface PfPreferences {
  rollupPeriod: "week" | "month" | "custom";
  rollupCustomDays: number;
  subscriptionLeadDays: number;
  reminderSubscriptions: boolean;
  reminderNotes: boolean;
  anomalyEnabled: boolean;
  anomalyThresholdPct: number;
  activeCurrencies: string[];
  defaultBudgetPeriod: "month" | "year";
  aiQuickaddEnabled: boolean;
  baseCurrency: string;
  aiAvailable: boolean;
}

export interface PfInsights {
  displayName: string | null;
  baseCurrency: string;
  linked: boolean;
  period: { kind: "week" | "month" | "custom"; key: string; start: string; end: string; label: string };
  totals: {
    income: string;
    expense: string;
    net: string;
    savingsTotal: string;
    loansGivenOutstanding: string;
    loansTakenOutstanding: string;
  };
  spendingByCategory: Array<{ categoryId: string | null; name: string; amount: string }>;
  series: Array<{ key: string; label: string; income: number; expense: number; net: number }>;
  targets: PfTarget[];
  upcomingSubscriptions: Array<{ id: string; name: string; amount: string; currency: string; nextDueDate: string }>;
  anomalies: Array<{
    id: string;
    kind: "period_total" | "category";
    periodKey: string;
    categoryId: string | null;
    categoryName: string;
    observed: string;
    baseline: string;
    currency: string;
    createdAt: string;
  }>;
}

export interface PfFrequentCategory {
  id: string;
  name: string;
  uses: number;
}

export interface PfExpenseDraft {
  amount: number;
  categoryName: string | null;
  note: string | null;
  currency: string | null;
}

/** Currency suggestions (recorded as entered; any value allowed). */
export const PF_CURRENCIES = ["BDT", "USD", "GBP", "EUR", "AUD"];

/**
 * Multi-currency money string. Unified with the business formatter (R7) — delegates
 * to `formatMoney` (single source of truth: forced 2 decimals, thousand separators)
 * with a currency-aware prefix. Returns "" (not null) for absent, per PF call sites.
 */
export function pfMoney(amount: string | number | null | undefined, currency = "BDT"): string {
  return formatMoney(amount, currency === "BDT" ? "৳" : `${currency} `) ?? "";
}
