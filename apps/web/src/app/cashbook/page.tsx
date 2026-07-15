"use client";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataGrid, type DataGridColumn } from "@/components/DataGrid";
import { Badge, EmptyState, Money } from "@/components/ui";

/** One Cashbook row (payment or expense, unified as an in/out line). */
interface CashRow {
  kind: "payment" | "expense";
  id: string;
  date: string;
  direction: "in" | "out";
  category: string;
  counterparty: string | null;
  medium: string | null;
  trxId: string | null;
  amount: string;
  note: string | null;
  reversal: boolean;
}
interface Cashbook { rows: CashRow[]; totalIn: number; totalOut: number; net: number }

/**
 * The unified Cashbook (handoff §7) — ONE ledger for every taka in and out.
 * Client payments, writer/vendor payouts, expenses, salaries & subscriptions are
 * all just categories here (that's why they're no longer separate tabs). A
 * presentation union over the existing append-only payment + expense ledgers — the
 * money model is untouched; corrections are still reversing entries on the source.
 */
export default function CashbookPage() {
  const router = useRouter();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canView = can(me?.permissions, "billing:view");
  const { data, isLoading } = useApi<Cashbook>(canView ? "billing/cashbook" : null);

  const columns: DataGridColumn<CashRow>[] = [
    { key: "date", label: "Date", render: (r) => <span className="whitespace-nowrap text-slate-400">{formatDate(r.date)}</span> },
    { key: "direction", label: "In / Out", align: "center", render: (r) => <Badge tone={r.direction === "in" ? "green" : "red"}>{r.direction}</Badge> },
    { key: "category", label: "Category", render: (r) => <span className="flex items-center gap-1.5">{r.category}{r.reversal && <Badge tone="gray">reversal</Badge>}</span> },
    { key: "counterparty", label: "Counterparty" },
    { key: "medium", label: "Medium" },
    { key: "trxId", label: "Trx ID", kind: "mono" },
    {
      key: "amount", label: "Amount", align: "right",
      render: (r) => (
        <span className={r.direction === "in" ? "tabular-nums text-emerald-600 dark:text-emerald-400" : "tabular-nums text-red-600 dark:text-red-400"}>
          {r.direction === "in" ? "+" : "−"}<Money value={Math.abs(Number(r.amount))} />
        </span>
      ),
    },
    { key: "note", label: "Note" },
  ];

  if (!canView) {
    return <AppShell><EmptyState title="Not authorized" hint="You need billing access to view the cashbook." /></AppShell>;
  }

  return (
    <AppShell>
      <DataGrid<CashRow>
        title="Cashbook"
        sub="One ledger for every taka in and out — client payments, writer payouts, expenses, subscriptions. Expenses & settlement are just categories here."
        columns={columns}
        rows={data?.rows}
        getRowId={(r) => `${r.kind}:${r.id}`}
        loading={isLoading}
        emptyTitle="No cashbook entries yet"
        rowActions={(r) => (r.kind === "payment" ? [{ icon: ExternalLink, label: "Open payment", onClick: () => router.push(`/payments/${r.id}`) }] : [])}
        stats={[
          { label: "Total in", value: <Money value={data?.totalIn ?? 0} />, tone: "green" },
          { label: "Total out", value: <Money value={data?.totalOut ?? 0} />, tone: "red" },
          { label: "Net in hand", value: <Money value={data?.net ?? 0} />, tone: "gold" },
        ]}
        foot="A client payment recorded on their page flows in automatically. Balances (a partner's, a client's remaining) are DERIVED from this ledger + opening balances — never stored twice. Corrections are reversing entries on the source payment."
      />
    </AppShell>
  );
}
