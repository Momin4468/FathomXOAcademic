"use client";
import type { ReactNode } from "react";
import { ApiError, useApi } from "@/lib/api";
import { can, type DashboardData, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Donut, NetTrend } from "@/components/Charts";
import { Card, EmptyState, ErrorNote, Money, Spinner } from "@/components/ui";

interface VolumeRow { partyId: string; displayName: string | null; totalJobs: number; delivered: number; openJobs: number }
interface RepRow {
  writerPartyId: string; displayName: string | null; jobs: number;
  onTimeRate: number | null; failRate: number | null; complaints: number; reliabilityScore: number | null;
}
interface ProfitRow { writerPartyId: string; displayName: string | null; jobs: number; revenue: number; writerCost: number; profit: number }
interface Leaderboard { scope: "owner" | "member"; volume: VolumeRow[]; reputation?: RepRow[]; profitPerWriter?: ProfitRow[] }
interface Charts {
  scope: "owner" | "member";
  orgNet?: { revenue: number; writerCost: number; net: number };
  netMonthly?: { month: string; net: number }[];
  expenseByCategory?: { category: string; total: number }[];
}

const pct = (v: number | null): string => (v == null ? "—" : `${Math.round(v * 100)}%`);

export default function AnalyticsPage() {
  const { data: me, isLoading: meLoading } = useApi<WhoAmI>("platform/whoami");
  const allowed = can(me?.permissions, "dashboard:view");
  const { data: dash, error: dErr, isLoading: dLoad } = useApi<DashboardData>(allowed ? "dashboard" : null, { shouldRetryOnError: false });
  const { data: lb } = useApi<Leaderboard>(allowed ? "dashboard/leaderboard" : null, { shouldRetryOnError: false });
  const { data: charts } = useApi<Charts>(allowed ? "dashboard/charts" : null, { shouldRetryOnError: false });
  const notConfigured = dErr instanceof ApiError && dErr.status === 404;

  const owner = dash?.owner;
  const isOwner = lb?.scope === "owner";
  const repByWriter = new Map((lb?.reputation ?? []).map((r) => [r.writerPartyId, r]));

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
        <p className="text-xs text-gray-500">{isOwner ? "Business analytics" : "Your numbers"} · derived at read time, never stored.</p>
      </div>

      {meLoading && <Spinner />}
      {!meLoading && !allowed && <EmptyState title="You don't have access to analytics" />}
      {allowed && notConfigured && <EmptyState title="Analytics isn't available" hint="The dashboard module is off for this workspace." />}
      {allowed && dErr && !notConfigured && <ErrorNote message="Couldn't load analytics." />}
      {allowed && dLoad && <Spinner />}

      {allowed && dash && (
        <>
          {/* ── KPI tiles ─────────────────────────────────────────────────── */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {owner ? (
              <>
                <Kpi label="Revenue" value={<Money value={charts?.orgNet?.revenue} />} />
                <Kpi label="Writer cost" value={<Money value={charts?.orgNet?.writerCost} />} />
                <Kpi label="Net margin" value={<Money value={charts?.orgNet?.net} signed />} />
                <Kpi label="Outstanding dues" value={<Money value={owner.outstandingDuesTotal} />} sub={`${owner.pendingClientCount} owing`} />
              </>
            ) : (
              <>
                <Kpi label="Earnings outstanding" value={<Money value={dash.balance?.earnings?.outstanding} />} />
                <Kpi label="Dues outstanding" value={<Money value={dash.balance?.charges?.outstanding} />} />
                <Kpi label="Net position" value={<Money value={dash.balance?.net} signed />} />
                <Kpi label="Open loops" value={<span>{dash.openLoops?.count ?? 0}</span>} sub={dash.openLoops?.scope === "mine" ? "yours" : "all"} />
              </>
            )}
          </div>

          {/* ── Owner charts ─────────────────────────────────────────────── */}
          {isOwner && (
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              {charts?.netMonthly && charts.netMonthly.length >= 2 && (
                <Card>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Net by month</h2>
                  <NetTrend data={charts.netMonthly.map((m) => ({ label: m.month, net: m.net }))} />
                </Card>
              )}
              {charts?.expenseByCategory && charts.expenseByCategory.length > 0 && (
                <Card>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Expenses by category</h2>
                  <div className="flex items-center gap-4">
                    <Donut slices={charts.expenseByCategory.map((e) => ({ label: e.category, value: e.total }))} />
                    <ul className="flex-1 space-y-1 text-xs">
                      {charts.expenseByCategory.slice(0, 8).map((e) => (
                        <li key={e.category} className="flex justify-between gap-2">
                          <span className="capitalize text-gray-600">{e.category}</span>
                          <span className="tabular-nums"><Money value={e.total} /></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── Writer leaderboard (volume for all; reputation columns for owners) ── */}
          {lb && lb.volume.length > 0 && (
            <Card className="mb-5">
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Writer leaderboard</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Writer</th>
                      <th className="py-2 pr-3 text-right">Jobs</th>
                      <th className="py-2 pr-3 text-right">Delivered</th>
                      <th className="py-2 pr-3 text-right">Open</th>
                      {isOwner && <th className="py-2 pr-3 text-right">Reliability</th>}
                      {isOwner && <th className="py-2 pr-3 text-right">On-time</th>}
                      {isOwner && <th className="py-2 pr-3 text-right">Fail</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lb.volume.map((v, i) => {
                      const rep = repByWriter.get(v.partyId);
                      return (
                        <tr key={v.partyId} className="border-b border-gray-100">
                          <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                          <td className="py-2 pr-3 font-medium">{v.displayName ?? "—"}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{v.totalJobs}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{v.delivered}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{v.openJobs}</td>
                          {isOwner && <td className="py-2 pr-3 text-right tabular-nums">{rep?.reliabilityScore ?? "—"}</td>}
                          {isOwner && <td className="py-2 pr-3 text-right tabular-nums">{pct(rep?.onTimeRate ?? null)}</td>}
                          {isOwner && <td className="py-2 pr-3 text-right tabular-nums">{pct(rep?.failRate ?? null)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ── Profit per writer (owner only) ───────────────────────────── */}
          {isOwner && lb?.profitPerWriter && lb.profitPerWriter.length > 0 && (
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Profit per writer</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                      <th className="py-2 pr-3">Writer</th>
                      <th className="py-2 pr-3 text-right">Jobs</th>
                      <th className="py-2 pr-3 text-right">Revenue</th>
                      <th className="py-2 pr-3 text-right">Writer cost</th>
                      <th className="py-2 pr-3 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lb.profitPerWriter.map((p) => (
                      <tr key={p.writerPartyId} className="border-b border-gray-100">
                        <td className="py-2 pr-3 font-medium">{p.displayName ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.jobs}</td>
                        <td className="py-2 pr-3 text-right tabular-nums"><Money value={p.revenue} /></td>
                        <td className="py-2 pr-3 text-right tabular-nums"><Money value={p.writerCost} /></td>
                        <td className="py-2 pr-3 text-right tabular-nums"><Money value={p.profit} signed /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <Card>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </Card>
  );
}
