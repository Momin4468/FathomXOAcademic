"use client";
import Link from "next/link";
import { usePfApi } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { pfMoney, type PfDashboard } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";

export default function PfDashboardPage() {
  const { data, error, isLoading } = usePfApi<PfDashboard>("dashboard");

  return (
    <PfShell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          {data && <p className="text-xs text-gray-500">This month, in {data.baseCurrency}</p>}
        </div>
        {data && !data.linked && (
          <Link href="/personal-finance/connect" className="text-xs font-medium text-emerald-700 hover:underline">
            Connect business income →
          </Link>
        )}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Income (month)" value={pfMoney(data.month.income, data.baseCurrency)} tone="text-emerald-700" />
            <Kpi label="Expense (month)" value={pfMoney(data.month.expense, data.baseCurrency)} tone="text-rose-700" />
            <Kpi label="Net (month)" value={pfMoney(data.month.net, data.baseCurrency)} tone={Number(data.month.net) >= 0 ? "text-emerald-700" : "text-rose-700"} />
            <Kpi label="Savings" value={pfMoney(data.savingsTotal, data.baseCurrency)} />
            <Kpi label="Lent out" value={pfMoney(data.loans.givenOutstanding, data.baseCurrency)} />
            <Kpi label="Owed by you" value={pfMoney(data.loans.takenOutstanding, data.baseCurrency)} />
          </div>

          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">Upcoming subscriptions</h2>
            {data.upcomingSubscriptions.length === 0 ? (
              <EmptyState title="Nothing due in the next 30 days" />
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {data.upcomingSubscriptions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="flex items-center gap-3">
                      <Badge tone="amber">due {formatDate(s.nextDueDate)}</Badge>
                      <span className="tabular-nums">{pfMoney(s.amount, s.currency)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">Recent activity</h2>
            {data.recent.length === 0 ? (
              <EmptyState title="No entries yet" hint="Add income or an expense to get started." />
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {data.recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span>
                      <Badge tone={r.kind === "income" ? "green" : "gray"}>{r.kind}</Badge>
                      <span className="ml-2 text-gray-500">{formatDate(r.occurredOn)}</span>
                      {r.note ? <span className="ml-2 text-gray-400">{r.note}</span> : null}
                    </span>
                    <span className={r.kind === "income" ? "tabular-nums text-emerald-700" : "tabular-nums text-rose-700"}>
                      {r.kind === "income" ? "+" : "−"}
                      {pfMoney(r.amount, r.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PfShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? "text-gray-900"}`}>{value || "—"}</div>
    </Card>
  );
}
