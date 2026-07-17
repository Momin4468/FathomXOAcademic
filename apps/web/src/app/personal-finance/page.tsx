"use client";
import Link from "next/link";
import { useState } from "react";
import { usePfApi, pfDismissAnomaly } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { pfMoney, type PfInsights, type PfDashboard } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Donut, IncomeExpenseBars, NetTrend, PF_PALETTE } from "@/components/PfCharts";
import { Badge, Card, EmptyState, ErrorNote, Spinner, cx } from "@/components/ui";

type Kind = "week" | "month" | "custom";

export default function PfOverviewPage() {
  const [sel, setSel] = useState<Kind | null>(null);
  const [customDays, setCustomDays] = useState(30);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());

  async function dismissAnomaly(id: string) {
    setDismissing((prev) => new Set(prev).add(id)); // optimistic hide
    try {
      await pfDismissAnomaly(id);
    } catch {
      setDismissing((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }
  const query = sel ? `?period=${sel}${sel === "custom" ? `&days=${customDays}` : ""}` : "";
  const { data, error, isLoading } = usePfApi<PfInsights>(`insights${query}`);
  // Net worth is a point-in-time STOCK (not period-scoped) — from the dashboard overview.
  const { data: dash } = usePfApi<PfDashboard>("dashboard");
  const activeKind: Kind = sel ?? (data?.period.kind ?? "month");
  const base = data?.baseCurrency ?? "BDT";

  return (
    <PfShell>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          {data && <p className="text-xs text-slate-400">This {data.period.label}, in {base}</p>}
        </div>
        {data && !data.linked && (
          <Link href="/personal-finance/connect" className="shrink-0 text-xs font-medium text-emerald-800 hover:underline">
            Connect business income →
          </Link>
        )}
      </div>

      {/* Period selector — drives KPIs, charts AND the anomaly comparison alike */}
      <div className="mb-4 flex items-center gap-2">
        <div className="inline-flex rounded-lg bg-ink-800 p-0.5 text-sm">
          {(["week", "month", "custom"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSel(k)}
              className={cx("rounded-md px-3 py-1 font-medium capitalize", activeKind === k ? "bg-ink-850 text-slate-100 shadow-sm" : "text-slate-400")}
            >
              {k}
            </button>
          ))}
        </div>
        {activeKind === "custom" && (
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input
              type="number"
              min={1}
              max={366}
              value={customDays}
              onChange={(e) => {
                setSel("custom");
                setCustomDays(Math.max(1, Math.min(366, Number(e.target.value) || 30)));
              }}
              className="w-16 rounded-lg border border-ink-700 px-2 py-1 text-xs tabular-nums"
            />
            days
          </label>
        )}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}

      {data && (
        <>
          {/* Gentle anomaly notices */}
          {data.anomalies.some((a) => !dismissing.has(a.id)) && (
            <div className="mb-4 space-y-2">
              {data.anomalies
                .filter((a) => !dismissing.has(a.id))
                .map((a) => (
                  <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                    <div className="text-amber-900">
                      <span className="font-medium">{a.kind === "period_total" ? "Total spending" : a.categoryName}</span> is running above your usual —{" "}
                      <span className="tabular-nums">{pfMoney(a.observed, a.currency)}</span> vs ~<span className="tabular-nums">{pfMoney(a.baseline, a.currency)}</span>.
                    </div>
                    <button type="button" onClick={() => dismissAnomaly(a.id)} className="shrink-0 text-xs text-amber-700 hover:underline">
                      Dismiss
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* Net worth headline (a stock: assets − liabilities). Run-rates below are FLOWS. */}
          {dash && (
            <Card className="mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Net worth</h2>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{pfMoney(dash.netWorth.value, base)}</div>
              <p className="mt-1 text-xs text-slate-400">
                Savings {pfMoney(dash.netWorth.assets.savings, base)} · Investments {pfMoney(dash.netWorth.assets.investments, base)} ·
                Owed to you {pfMoney(dash.netWorth.assets.receivable, base)} · Cash {pfMoney(dash.netWorth.assets.cash, base)} · You owe {pfMoney(dash.netWorth.liabilities.owed, base)}
              </p>
            </Card>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label={`Income`} value={pfMoney(data.totals.income, base)} tone="text-emerald-700" />
            <Kpi label={`Expense`} value={pfMoney(data.totals.expense, base)} tone="text-rose-700" />
            <Kpi label={`Net`} value={pfMoney(data.totals.net, base)} tone={Number(data.totals.net) >= 0 ? "text-emerald-700" : "text-rose-700"} />
            <Kpi label="Savings" value={pfMoney(data.totals.savingsTotal, base)} />
            <Kpi label="Investments" value={pfMoney(dash?.netWorth.assets.investments, base)} />
            <Kpi label="Lent out" value={pfMoney(data.totals.loansGivenOutstanding, base)} />
            <Kpi label="Owed by you" value={pfMoney(data.totals.loansTakenOutstanding, base)} />
          </div>

          {/* Charts */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-200">Spending by category</h2>
              {data.spendingByCategory.length === 0 ? (
                <EmptyState title="No spending this period" />
              ) : (
                <div className="flex items-center gap-4">
                  <Donut slices={data.spendingByCategory.map((c) => ({ label: c.name, value: Number(c.amount) }))} />
                  <ul className="min-w-0 flex-1 space-y-1 text-sm">
                    {data.spendingByCategory.slice(0, 6).map((c, i) => (
                      <li key={c.categoryId ?? c.name} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PF_PALETTE[i % PF_PALETTE.length] }} />
                        <span className="truncate text-slate-200">{c.name}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-slate-400">{pfMoney(c.amount, base)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-200">Income vs expense</h2>
              <IncomeExpenseBars data={data.series} />
              <div className="mt-2 flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-600" /> Income</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-500" /> Expense</span>
              </div>
            </Card>

            <Card className="sm:col-span-2">
              <h2 className="mb-2 text-sm font-semibold text-slate-200">Net trend</h2>
              {data.series.length < 2 ? (
                <p className="py-4 text-center text-xs text-slate-500">Not enough history yet — this fills in as more periods pass.</p>
              ) : (
                <NetTrend data={data.series} />
              )}
            </Card>
          </div>

          {/* Budgets / targets */}
          {data.targets.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-slate-200">Budgets &amp; goals</h2>
              <div className="space-y-2">
                {data.targets.slice(0, 6).map((t) => {
                  const pct = Number(t.amount) > 0 ? Math.min(100, (Number(t.current) / Number(t.amount)) * 100) : 0;
                  const over = t.kind === "budget_cap" && Number(t.current) > Number(t.amount);
                  return (
                    <Card key={t.id}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium capitalize">{t.kind.replace("_", " ")}</span>
                        <span className={cx("tabular-nums", over ? "text-rose-700" : "text-slate-300")}>
                          {pfMoney(t.current, t.currency)} / {pfMoney(t.amount, t.currency)}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
                        <div className={cx("h-full rounded-full", over ? "bg-rose-500" : t.kind === "budget_cap" ? "bg-emerald-500" : "bg-sky-500")} style={{ width: `${pct}%` }} />
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {/* Upcoming subscriptions / future expenses */}
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Upcoming &amp; future expenses</h2>
            {data.upcomingSubscriptions.length === 0 ? (
              <EmptyState title="Nothing due in the next 30 days" />
            ) : (
              <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
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
        </>
      )}
    </PfShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? "text-slate-100"}`}>{value || "—"}</div>
    </Card>
  );
}
