"use client";
import { useMemo } from "react";
import { useApi } from "@/lib/api";
import { can, type WhoAmI, type WorkListRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, cell, DGrid, fmtDay, money, Page, T, type DCol } from "@/components/dc";

/**
 * Completed (handoff §4) — delivered work in the design's generic grid, split from
 * Tasks so the active board stays short.
 */
export default function CompletedPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canMoney = can(me?.permissions, "work:approve");
  const { data: rows } = useApi<WorkListRow[]>("work");
  const done = useMemo(() => (rows ?? []).filter((r) => r.workState === "delivered"), [rows]);

  const cols: DCol<WorkListRow>[] = [
    { label: "Code", render: (r) => cell(r.courseCode ?? "—", { mono: true }) },
    { label: "Task", render: (r) => cell(r.title, { sub: r.projectTitle ?? r.courseCode ?? undefined, weight: 600 }) },
    { label: "Client", render: (r) => r.clientName ?? "—" },
    { label: "From", render: (r) => r.ownerName ?? "—" },
    { label: "Words", align: "right", render: (r) => r.wordCount ?? "—" },
    { label: "Delivered", render: (r) => fmtDay(r.deliveryDate ?? r.submissionDate) },
    { label: canMoney ? "Writer" : "My fee", align: "right", render: (r) => money(canMoney ? r.writerAmount : r.myFee) },
    ...(canMoney ? [
      { label: "Client", align: "right" as const, render: (r: WorkListRow) => money(r.clientAmount) },
      { label: "Margin", align: "right" as const, render: (r: WorkListRow) => <span style={{ color: (r.margin ?? 0) < 0 ? T.red : T.ink }}>{money(r.margin)}</span> },
    ] : []),
    { label: "State", align: "center", render: () => <Badge tone="green">delivered</Badge> },
  ];

  return (
    <AppShell>
      <Page title="Completed" sub="delivered work — kept out of the active board so it doesn't clutter the daily view">
        <DGrid cols={cols} rows={done} keyOf={(r) => r.id} minWidth={780}
          actions={[{ label: "open", href: (r) => `/work/${r.id}` }]}
          empty="No delivered work yet." foot={`${done.length} delivered`} />
      </Page>
    </AppShell>
  );
}
