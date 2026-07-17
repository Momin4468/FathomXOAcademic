"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useApi } from "@/lib/api";
import { can, type DashboardData, type WhoAmI, type WorkListRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Card, money, Page, StatCards, T, type Stat } from "@/components/dc";

/**
 * Dashboard — role-shaped, recreated to the `Business OS v5` handoff: Fraunces
 * title + stat-card row + a two-column "due soon" list and "needs attention"
 * panel. Owner (SuperAdmin/admin) sees org economics; a writer sees their own.
 */
export default function DashboardPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data: dash } = useApi<DashboardData>("dashboard", { shouldRetryOnError: false });
  const { data: work } = useApi<WorkListRow[]>("work");
  const owner = dash?.owner;
  const canMoney = can(me?.permissions, "work:approve");

  const stats: Stat[] = useMemo(() => {
    if (owner) {
      return [
        { label: "Open loops", value: owner.openLoopsTotal, tone: "gold", note: "tasks not yet delivered" },
        { label: "Org margin", value: money(owner.orgMargin.margin), tone: "green", note: `rev ${money(owner.orgMargin.revenue)}` },
        { label: "Outstanding dues", value: money(owner.outstandingDuesTotal), tone: "amber", note: `${owner.pendingClientCount} clients` },
        { label: "Collected", value: money(owner.collected), tone: "blue", note: `of ${money(owner.billed)} billed` },
      ];
    }
    const b = dash?.balance;
    return [
      { label: "Open loops", value: dash?.openLoops.count ?? 0, tone: "gold", note: "your work in flight" },
      ...(b ? [{ label: "My net", value: money(b.net), tone: "green" as const }] : []),
    ];
  }, [owner, dash]);

  const due = useMemo(
    () => (work ?? [])
      .filter((r) => r.workState !== "delivered")
      .filter((r) => r.deliveryDate || r.submissionDate)
      .sort((a, b) => (a.deliveryDate ?? a.submissionDate ?? "").localeCompare(b.deliveryDate ?? b.submissionDate ?? ""))
      .slice(0, 6),
    [work],
  );

  const attention: { dot: string; t: string; sub: string }[] = [];
  if (owner) {
    if (owner.pendingClientCount) attention.push({ dot: T.amber, t: `${owner.pendingClientCount} clients owe money`, sub: `${money(owner.outstandingDuesTotal)} outstanding across invoices` });
    const owed = owner.writerPayoutsOwed?.filter((w) => w.owed > 0) ?? [];
    if (owed.length) attention.push({ dot: T.purple, t: `${owed.length} writers awaiting payout`, sub: `${money(owed.reduce((s, w) => s + w.owed, 0))} owed in total` });
    if (owner.orgMargin.margin < 0) attention.push({ dot: T.red, t: "Org margin is negative", sub: "review pricing / write-offs this period" });
  }
  if (!attention.length) attention.push({ dot: T.green, t: "All clear", sub: "nothing needs your attention right now" });

  const title = owner ? "Dashboard" : "My open loops";
  const sub = owner ? "your book at a glance — work due, money owed, what needs a decision" : "your work in flight and what's due";

  return (
    <AppShell>
      <Page title={title} sub={sub}>
        <StatCards items={stats} min={180} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
          <Card>
            <div style={{ padding: "11px 16px", borderBottom: `1px solid ${T.eyebrow}`, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: "#D9A23A" }} />Due soon
            </div>
            {due.length === 0 ? (
              <div style={{ padding: "22px 16px", fontSize: 12.5, color: T.muted2 }}>Nothing scheduled.</div>
            ) : due.map((d) => {
              const dd = d.deliveryDate ?? d.submissionDate ?? "";
              const soon = !!dd && dd <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
              return (
                <Link key={d.id} href={`/work/${d.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${T.hair}`, textDecoration: "none", color: T.ink }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: T.mono, background: T.codeBg, color: T.codeText, borderRadius: 6, padding: "3px 7px" }}>{d.courseCode ?? "—"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{d.title}</span>
                    <span style={{ display: "block", fontSize: 11, color: T.muted2 }}>{d.clientName ?? d.ownerName ?? "—"}</span>
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: soon ? T.red : T.muted, whiteSpace: "nowrap" }}>{dd.slice(8, 10)}/{dd.slice(5, 7)}</span>
                </Link>
              );
            })}
          </Card>
          <Card style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Needs attention</div>
            {attention.map((a, i) => (
              <div key={i} style={{ padding: "9px 0", borderTop: i ? `1px solid ${T.hair}` : undefined }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: a.dot }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{a.t}</span>
                </div>
                <div style={{ fontSize: 11, color: T.muted2, marginTop: 2, paddingLeft: 14 }}>{a.sub}</div>
              </div>
            ))}
            {canMoney && <Link href="/analytics" style={{ display: "inline-block", marginTop: 8, fontSize: 11.5, fontWeight: 600, color: T.goldDeep, textDecoration: "none" }}>Open analytics →</Link>}
          </Card>
        </div>
      </Page>
    </AppShell>
  );
}
