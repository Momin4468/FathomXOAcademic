/** Types for the Personal Finance plane (§11). */

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
  kind: "income" | "expense";
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

/** Currency suggestions (recorded as entered; any value allowed). */
export const PF_CURRENCIES = ["BDT", "USD", "GBP", "EUR", "AUD"];

/** Multi-currency money string — the business <Money> is ৳-only, so PF formats its own. */
export function pfMoney(amount: string | number | null | undefined, currency = "BDT"): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(n)) return "";
  const formatted = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency === "BDT" ? `৳${formatted}` : `${currency} ${formatted}`;
}
