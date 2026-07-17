"use client";
import Link from "next/link";
import { useState } from "react";
import { usePfApi, pfDismissAnomaly } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { pfMoney, type PfInsights, type PfDashboard } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import {
  PF, PF_TINTS, PfBanner, PfPage, PfBtn, PfCard, PfCardHead, PfStatCards, PfBadge, PfNote,
  PfIncomeSpendBars, PfCategoryBars, PfProgress, PfLoading, PfEmpty,
} from "@/components/pf-dc";

type Kind = "week" | "month" | "custom";

// Recent-activity type → badge tone + amount colour (design Transactions type badges).
const RECENT: Record<string, { tone: "green" | "red" | "purple" | "teal" | "blue"; color: string }> = {
  income: { tone: "green", color: PF.green },
  expense: { tone: "red", color: PF.red },
  loan: { tone: "purple", color: PF.purple },
  saving: { tone: "teal", color: PF.accentDeep },
  investment: { tone: "blue", color: PF.blue },
};

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

  const nw = dash?.netWorth;
  const catMax = Math.max(1, ...(data?.spendingByCategory ?? []).map((c) => Number(c.amount) || 0));

  return (
    <PfShell>
      <PfBanner />
      <PfPage
        title="Overview"
        sub={data ? `This ${data.period.label}, in ${base}` : undefined}
        action={
          data && !data.linked ? (
            <PfBtn variant="ghost" href="/personal-finance/connect">Connect business income →</PfBtn>
          ) : undefined
        }
      >
        {/* Period selector — drives KPIs, charts AND the anomaly comparison alike */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {(["week", "month", "custom"] as const).map((k) => {
            const active = activeKind === k;
            return (
              <span key={k} onClick={() => setSel(k)} style={{ fontSize: 12, fontWeight: 600, padding: "6px 13px", borderRadius: 999, cursor: "pointer", textTransform: "capitalize", background: active ? PF.accent : "transparent", color: active ? PF.onGrad : PF.onGradSub, border: `1px solid ${active ? PF.accent : "rgba(127,227,206,0.35)"}` }}>
                {k}
              </span>
            );
          })}
          {activeKind === "custom" && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: PF.onGradSub }}>
              <input
                type="number" min={1} max={366} value={customDays}
                onChange={(e) => { setSel("custom"); setCustomDays(Math.max(1, Math.min(366, Number(e.target.value) || 30))); }}
                style={{ width: 64, border: `1px solid ${PF.border}`, borderRadius: 7, padding: "5px 8px", fontSize: 12, background: PF.card, color: PF.text, fontVariantNumeric: "tabular-nums" }}
              />
              days
            </label>
          )}
        </div>

        {isLoading && <PfLoading />}
        {error && <PfNote tone="red">{error.message}</PfNote>}

        {data && (
          <>
            {/* Gentle anomaly notices */}
            {data.anomalies.some((a) => !dismissing.has(a.id)) && (
              <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                {data.anomalies.filter((a) => !dismissing.has(a.id)).map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, background: PF.amberBg, border: `1px solid ${PF.amberBorder}`, borderRadius: 10, padding: "10px 13px" }}>
                    <div style={{ fontSize: 12, color: PF.amber }}>
                      <span style={{ fontWeight: 700 }}>{a.kind === "period_total" ? "Total spending" : a.categoryName}</span> is running above your usual —{" "}
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{pfMoney(a.observed, a.currency)}</span> vs ~<span style={{ fontVariantNumeric: "tabular-nums" }}>{pfMoney(a.baseline, a.currency)}</span>.
                    </div>
                    <button type="button" onClick={() => dismissAnomaly(a.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: PF.amber }}>Dismiss</button>
                  </div>
                ))}
              </div>
            )}

            {/* Net-worth header (a stock: assets − liabilities). */}
            {nw && (
              <div style={{ background: `linear-gradient(120deg, ${PF.grad1}, ${PF.grad2})`, borderRadius: 14, padding: "16px 20px", marginBottom: 16, color: PF.onGrad }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: PF.light }}>Net worth</div>
                <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{pfMoney(nw.value, base)}</div>
                <div style={{ fontSize: 11.5, color: PF.onGradSub, marginTop: 4 }}>
                  Savings {pfMoney(nw.assets.savings, base)} · Investments {pfMoney(nw.assets.investments, base)} · Owed to you {pfMoney(nw.assets.receivable, base)} · Cash {pfMoney(nw.assets.cash, base)} · You owe {pfMoney(nw.liabilities.owed, base)}
                </div>
              </div>
            )}

            {/* Balance-composition cards (live-derived — the app has no per-provider accounts) */}
            {nw && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))", gap: 12, marginBottom: 16 }}>
                <BalanceCard label="Savings" value={pfMoney(nw.assets.savings, base)} tint={PF_TINTS.cash} glyph="S" />
                <BalanceCard label="Investments" value={pfMoney(nw.assets.investments, base)} tint={PF_TINTS.crypto} glyph="I" />
                <BalanceCard label="Cash on hand" value={pfMoney(nw.assets.cash, base)} tint={PF_TINTS.mobile} glyph="৳" href="/personal-finance/cash" action="Reconcile" />
                <BalanceCard label="Owed to you" value={pfMoney(nw.assets.receivable, base)} tint={PF_TINTS.bank} glyph="→" />
                <BalanceCard label="You owe" value={pfMoney(nw.liabilities.owed, base)} tint={{ tint: PF.redBg, ink: PF.red }} glyph="←" />
              </div>
            )}

            {/* Period KPI cards */}
            <PfStatCards
              items={[
                { label: "Income", value: pfMoney(data.totals.income, base), tone: "green" },
                { label: "Expense", value: pfMoney(data.totals.expense, base), tone: "red" },
                { label: "Net", value: pfMoney(data.totals.net, base), tone: Number(data.totals.net) >= 0 ? "teal" : "red" },
                { label: "Savings", value: pfMoney(data.totals.savingsTotal, base), tone: "gray" },
              ]}
            />

            {/* Charts: income-vs-spend (left) · category + loans (right) */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,320px)", gap: 16, alignItems: "start", marginBottom: 16 }} className="pf-overview-grid">
              <PfCard>
                <PfCardHead>Income vs. spend · {data.series.length}-month</PfCardHead>
                {data.series.length === 0 ? (
                  <PfEmpty title="No history yet" />
                ) : (
                  <PfIncomeSpendBars series={data.series.map((s) => ({ label: s.label, income: s.income, expense: s.expense }))} />
                )}
              </PfCard>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <PfCard>
                  <PfCardHead>Spending by category · this {data.period.kind}</PfCardHead>
                  {data.spendingByCategory.length === 0 ? (
                    <div style={{ fontSize: 12, color: PF.muted2 }}>No spending this period.</div>
                  ) : (
                    <PfCategoryBars
                      rows={data.spendingByCategory.slice(0, 5).map((c) => ({ name: c.name, amount: pfMoney(c.amount, base), pct: (Number(c.amount) / catMax) * 100 }))}
                    />
                  )}
                </PfCard>
                <PfCard>
                  <PfCardHead>Loans</PfCardHead>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                    <span style={{ fontSize: 12, color: PF.text2 }}>Owed to me</span>
                    <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PF.green }}>{pfMoney(data.totals.loansGivenOutstanding, base)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${PF.hair}` }}>
                    <span style={{ fontSize: 12, color: PF.text2 }}>I owe</span>
                    <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PF.red }}>{pfMoney(data.totals.loansTakenOutstanding, base)}</span>
                  </div>
                </PfCard>
              </div>
            </div>

            {/* Recent activity — the transactions ledger with type badges */}
            {dash && dash.recent.length > 0 && (
              <PfCard style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: PF.text, borderBottom: `1px solid ${PF.eyebrow}` }}>Recent activity</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 420, borderCollapse: "collapse", fontSize: 12.5 }}>
                    <tbody>
                      {dash.recent.map((r) => {
                        const meta = RECENT[r.kind] ?? { tone: "teal" as const, color: PF.text2 };
                        return (
                          <tr key={`${r.kind}-${r.id}`}>
                            <td style={{ padding: "9px 16px", borderBottom: `1px solid ${PF.hair}`, color: PF.muted, whiteSpace: "nowrap" }}>{formatDate(r.occurredOn)}</td>
                            <td style={{ padding: "9px 8px", borderBottom: `1px solid ${PF.hair}` }}><PfBadge tone={meta.tone}>{r.kind}</PfBadge></td>
                            <td style={{ padding: "9px 8px", borderBottom: `1px solid ${PF.hair}`, color: PF.text2 }}>{r.note ?? ""}</td>
                            <td style={{ padding: "9px 16px", borderBottom: `1px solid ${PF.hair}`, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: meta.color }}>{pfMoney(r.amount, r.currency)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </PfCard>
            )}

            {/* Budgets / targets */}
            {data.targets.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: PF.onGrad, marginBottom: 8 }}>Budgets &amp; goals</div>
                <div style={{ display: "grid", gap: 10 }}>
                  {data.targets.slice(0, 6).map((t) => {
                    const pct = Number(t.amount) > 0 ? Math.min(100, (Number(t.current) / Number(t.amount)) * 100) : 0;
                    const over = t.kind === "budget_cap" && Number(t.current) > Number(t.amount);
                    return (
                      <PfCard key={t.id}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, marginBottom: 8 }}>
                          <span style={{ fontWeight: 600, textTransform: "capitalize", color: PF.text }}>{t.kind.replace("_", " ")}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums", color: over ? PF.red : PF.text2 }}>{pfMoney(t.current, t.currency)} / {pfMoney(t.amount, t.currency)}</span>
                        </div>
                        <PfProgress pct={pct} over={over} />
                      </PfCard>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Upcoming subscriptions / future expenses */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: PF.onGrad, marginBottom: 8 }}>Upcoming &amp; future expenses</div>
              {data.upcomingSubscriptions.length === 0 ? (
                <PfEmpty title="Nothing due in the next 30 days" />
              ) : (
                <PfCard style={{ padding: 0, overflow: "hidden" }}>
                  {data.upcomingSubscriptions.map((s, i) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", borderTop: i === 0 ? undefined : `1px solid ${PF.hair}` }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: PF.text }}>{s.name}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <PfBadge tone="amber">due {formatDate(s.nextDueDate)}</PfBadge>
                        <span style={{ fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(s.amount, s.currency)}</span>
                      </span>
                    </div>
                  ))}
                </PfCard>
              )}
            </div>
          </>
        )}
      </PfPage>
      <style>{`@media (max-width: 640px){ .pf-overview-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </PfShell>
  );
}

function BalanceCard({ label, value, tint, glyph, href, action }: { label: string; value: string; tint: { tint: string; ink: string }; glyph: string; href?: string; action?: string }) {
  return (
    <div style={{ background: PF.card, border: `1px solid ${PF.border}`, borderRadius: 12, padding: "13px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: tint.tint, color: tint.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>{glyph}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: PF.text }}>{label}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PF.text }}>{value}</div>
      <div style={{ fontSize: 10, color: PF.faint, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>live balance</span>
        {href && action && <Link href={href} style={{ color: PF.accentDeep, fontWeight: 700, textDecoration: "none" }}>{action}</Link>}
      </div>
    </div>
  );
}
