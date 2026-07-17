"use client";
import { ApiError, useApi } from "@/lib/api";
import { can, type DashboardData, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Donut, NetTrend } from "@/components/Charts";
import { Money } from "@/components/ui";
import { Card, DGrid, EmptyBox, Loading, Note, Page, StatCards, T, cell, type DCol, type Stat } from "@/components/dc";

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

type Ranked = VolumeRow & { rank: number };
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
  const volRows: Ranked[] = (lb?.volume ?? []).map((v, i) => ({ ...v, rank: i + 1 }));

  // KPI tiles — money stays gated: <Money> renders NOTHING for an absent/redacted value.
  const stats: Stat[] = !dash
    ? []
    : owner
      ? [
          { label: "Revenue", value: <Money value={charts?.orgNet?.revenue} /> },
          { label: "Writer cost", value: <Money value={charts?.orgNet?.writerCost} /> },
          { label: "Net margin", value: <Money value={charts?.orgNet?.net} signed />, tone: "green" },
          { label: "Outstanding dues", value: <Money value={owner.outstandingDuesTotal} />, tone: "amber", note: `${owner.pendingClientCount} owing` },
        ]
      : [
          { label: "Earnings outstanding", value: <Money value={dash.balance?.earnings?.outstanding} /> },
          { label: "Dues outstanding", value: <Money value={dash.balance?.charges?.outstanding} /> },
          { label: "Net position", value: <Money value={dash.balance?.net} signed />, tone: "green" },
          { label: "Open loops", value: dash.openLoops?.count ?? 0, tone: "gold", note: dash.openLoops?.scope === "mine" ? "yours" : "all" },
        ];

  const lbCols: DCol<Ranked>[] = [
    { label: "#", width: 40, render: (v) => <span style={{ color: T.muted }}>{v.rank}</span> },
    { label: "Writer", render: (v) => cell(v.displayName ?? "—", { weight: 500 }) },
    { label: "Jobs", align: "right", render: (v) => v.totalJobs },
    { label: "Delivered", align: "right", render: (v) => v.delivered },
    { label: "Open", align: "right", render: (v) => v.openJobs },
    ...(isOwner
      ? ([
          { label: "Reliability", align: "right", render: (v) => repByWriter.get(v.partyId)?.reliabilityScore ?? "—" },
          { label: "On-time", align: "right", render: (v) => pct(repByWriter.get(v.partyId)?.onTimeRate ?? null) },
          { label: "Fail", align: "right", render: (v) => pct(repByWriter.get(v.partyId)?.failRate ?? null) },
        ] as DCol<Ranked>[])
      : []),
  ];

  const heading: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: T.ink, margin: "0 0 8px" };
  const chartTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, marginBottom: 14 };

  return (
    <AppShell>
      <Page title="Analytics" sub={`${isOwner ? "Business analytics" : "Your numbers"} · derived at read time, never stored.`}>
        {meLoading && <Loading />}
        {!meLoading && !allowed && <EmptyBox title="You don't have access to analytics" />}
        {allowed && notConfigured && <EmptyBox title="Analytics isn't available" hint="The dashboard module is off for this workspace." />}
        {allowed && dErr && !notConfigured && <Note>Couldn&rsquo;t load analytics.</Note>}
        {allowed && dLoad && <Loading />}

        {allowed && dash && (
          <>
            <StatCards items={stats} min={180} />

            {isOwner && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start", marginBottom: 20 }}>
                {charts?.netMonthly && charts.netMonthly.length >= 2 && (
                  <Card style={{ padding: 16 }}>
                    <div style={chartTitle}>Net by month</div>
                    <NetTrend data={charts.netMonthly.map((m) => ({ label: m.month, net: m.net }))} />
                  </Card>
                )}
                {charts?.expenseByCategory && charts.expenseByCategory.length > 0 && (
                  <Card style={{ padding: 16 }}>
                    <div style={chartTitle}>Expenses by category</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <Donut slices={charts.expenseByCategory.map((e) => ({ label: e.category, value: e.total }))} />
                      <ul style={{ flex: 1, listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 5, fontSize: 12 }}>
                        {charts.expenseByCategory.slice(0, 8).map((e) => (
                          <li key={e.category} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ textTransform: "capitalize", color: T.ink2 }}>{e.category}</span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}><Money value={e.total} /></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* Writer leaderboard (volume for all; reputation columns for owners). */}
            {lb && lb.volume.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h2 style={heading}>Writer leaderboard</h2>
                <DGrid<Ranked> rows={volRows} keyOf={(v) => v.partyId} cols={lbCols} />
              </div>
            )}

            {/* Profit per writer (owner only). */}
            {isOwner && lb?.profitPerWriter && lb.profitPerWriter.length > 0 && (
              <div>
                <h2 style={heading}>Profit per writer</h2>
                <DGrid<ProfitRow>
                  rows={lb.profitPerWriter}
                  keyOf={(p) => p.writerPartyId}
                  cols={[
                    { label: "Writer", render: (p) => cell(p.displayName ?? "—", { weight: 500 }) },
                    { label: "Jobs", align: "right", render: (p) => p.jobs },
                    { label: "Revenue", align: "right", render: (p) => <Money value={p.revenue} /> },
                    { label: "Writer cost", align: "right", render: (p) => <Money value={p.writerCost} /> },
                    { label: "Profit", align: "right", render: (p) => <Money value={p.profit} signed /> },
                  ]}
                />
              </div>
            )}
          </>
        )}
      </Page>
    </AppShell>
  );
}
