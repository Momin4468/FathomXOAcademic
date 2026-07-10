"use client";
import Link from "next/link";
import { ApiError, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type DashboardData, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PersonalFinanceConnectCard } from "@/components/PersonalFinanceConnectCard";
import { WorkList } from "@/components/WorkList";
import { PartyName } from "@/components/PartyName";
import { Button, Card, EmptyState, ErrorNote, Money, Spinner, cx } from "@/components/ui";

interface ChartsData { scope: string; netMonthly?: Array<{ month: string; revenue: number; net: number }> }
interface PaymentRow { id: string; direction: string; amount: string; paidAt: string; medium: string | null; counterpartyPartyId: string | null }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => MONTHS[Number(m.split("-")[1]) - 1] ?? m;

function Kpi({ label, value, tone, highlight }: { label: string; value: number; tone?: "emerald" | "gold"; highlight?: boolean }) {
  return (
    <Card className={highlight ? "bg-nav-surface text-nav-bright" : ""}>
      <div className={cx("text-[11px] font-semibold uppercase tracking-wide", highlight ? "text-nav-muted" : "text-slate-500")}>{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular-nums", tone === "emerald" && "text-emerald-600 dark:text-emerald-400", tone === "gold" && "text-gold-500 dark:text-gold-400", highlight && "text-gold-400")}>
        <Money value={value} />
      </div>
    </Card>
  );
}

function IncomeBars({ data }: { data: Array<{ month: string; revenue: number }> }) {
  if (!data.length) return <EmptyState title="No income yet" />;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <div className="flex h-44 items-end gap-2">
      {data.map((d) => (
        <div key={d.month} className="flex flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] tabular-nums text-slate-400">{Math.round(d.revenue).toLocaleString()}</span>
          <div className="w-full rounded-t bg-gold-400" style={{ height: `${Math.max(3, (d.revenue / max) * 100)}%` }} />
          <span className="text-[10px] text-slate-500">{monthLabel(d.month)}</span>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const { data: me, isLoading } = useApi<WhoAmI>("platform/whoami");
  const { data: dash, error: dashError } = useApi<DashboardData>("dashboard", { shouldRetryOnError: false });
  const owner = dash?.owner;
  const { data: charts } = useApi<ChartsData>(owner ? "dashboard/charts" : null);
  const { data: payments } = useApi<PaymentRow[]>(can(me?.permissions, "billing:view") ? "payments" : null);
  const dashFailed = dashError instanceof ApiError && dashError.status !== 404;
  const maxOwed = Math.max(...(owner?.writerPayoutsOwed ?? []).map((w) => w.owed), 1);
  const earnings = dash?.balance?.earnings;
  const chargesB = dash?.balance?.charges;

  return (
    <AppShell>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{owner ? "Dashboard" : "My open loops"}</h1>
          <p className="text-xs text-slate-400">{owner ? "One place for the money you were tracking across forty sheets." : "What’s open and whose move is it?"}</p>
        </div>
        {can(me?.permissions, "work:create") && <Link href="/work/new"><Button>+ New job</Button></Link>}
      </div>

      {isLoading && <Spinner />}
      {dashFailed && <div className="mb-4"><ErrorNote message="Couldn't load your numbers." /></div>}

      {/* ── Admin money dashboard ── */}
      {owner && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Billed" value={owner.billed} />
            <Kpi label="Collected" value={owner.collected} tone="emerald" />
            <Kpi label="Outstanding" value={owner.outstandingDuesTotal} tone="gold" />
            <Kpi label="Net margin" value={owner.orgMargin.margin} highlight />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Income by month</h2>
              <IncomeBars data={charts?.netMonthly ?? []} />
            </Card>

            <Card>
              <h2 className="mb-3 text-sm font-semibold">Writer payouts owed</h2>
              {owner.writerPayoutsOwed.length === 0 ? (
                <EmptyState title="All writers paid up" />
              ) : (
                <ul className="space-y-2.5">
                  {owner.writerPayoutsOwed.slice(0, 6).map((w) => (
                    <li key={w.writerPartyId} className="text-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-medium"><PartyName id={w.writerPartyId} /></span>
                        <span className="tabular-nums text-slate-300"><Money value={w.owed} /></span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-ink-800"><div className="h-full rounded bg-gold-400" style={{ width: `${(w.owed / maxOwed) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="mb-2 text-sm font-semibold">Needs collecting</h2>
              {owner.duesByClient.filter((d) => d.due > 0).length === 0 ? (
                <EmptyState title="Nothing outstanding" />
              ) : (
                <ul className="divide-y divide-ink-800">
                  {owner.duesByClient.filter((d) => d.due > 0).slice(0, 5).map((d) => (
                    <li key={d.clientPartyId} className="flex items-center justify-between py-2 text-sm">
                      <span className="font-medium"><PartyName id={d.clientPartyId} /></span>
                      <span className="tabular-nums font-medium"><Money value={d.due} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="mb-2 text-sm font-semibold">Recent payments</h2>
              {(payments ?? []).length === 0 ? (
                <EmptyState title="No payments yet" />
              ) : (
                <ul className="divide-y divide-ink-800">
                  {(payments ?? []).slice(0, 6).map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                      <span>
                        <span className="font-medium"><PartyName id={p.counterpartyPartyId} /></span>
                        <span className="ml-2 text-xs text-slate-400">{formatDate(p.paidAt)} · {p.medium ?? "—"}</span>
                      </span>
                      <span className={p.direction === "in" ? "tabular-nums text-emerald-600 dark:text-emerald-400" : "tabular-nums text-slate-400"}>
                        {p.direction === "in" ? "+" : "−"}<Money value={Math.abs(Number(p.amount))} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ── Member ("my numbers") + open loops ── */}
      {!owner && (
        <>
          {dash?.balance && (
            <Card className="mb-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">My numbers</h2>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-xs text-slate-500">earned (outstanding)</div><div className="font-medium"><Money value={earnings?.outstanding} /></div></div>
                <div><div className="text-xs text-slate-500">earned (total)</div><div className="font-medium"><Money value={earnings?.owed} /></div></div>
                <div><div className="text-xs text-slate-500">dues (outstanding)</div><div className="font-medium"><Money value={chargesB?.outstanding} /></div></div>
                <div><div className="text-xs text-slate-500">net</div><div className="font-semibold"><Money value={dash.balance.net} /></div></div>
              </div>
            </Card>
          )}
          {me?.party && <PersonalFinanceConnectCard />}
          {me && (
            <div className="space-y-6">
              {can(me.permissions, "work:approve") && (
                <>
                  <WorkList title="Confirmation queue" path="work?workState=pending" emptyHint="No jobs awaiting confirmation." />
                  <WorkList title="In progress" path="work?workState=confirmed" emptyHint="No active jobs." />
                </>
              )}
              {me.party && <WorkList title="My work" path={`work?doerPartyId=${me.party.id}`} emptyHint="You have no assigned work yet." />}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
