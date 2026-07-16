"use client";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { Check } from "lucide-react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type WhoAmI, type WorkListRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataGrid, type DataGridColumn } from "@/components/DataGrid";
import { Badge, Button, Card, Chip, EmptyState } from "@/components/ui";
import { useToast } from "@/components/toast";

interface ProvisionalRow { id: string; kind: string; canonical: string; parent: string | null; createdAt: string }

/**
 * Approvals (handoff §5) — the governance queue. This slice covers reference
 * governance (provisional canonical entities captured on the fly, awaiting a
 * steward's confirm/merge); the other approval surfaces are linked below. A claim
 * is not a fact until an authorized role confirms it (CLAUDE.md §3.8).
 */
export default function ApprovalsPage() {
  const { mutate } = useSWRConfig();
  const { toast } = useToast();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canApproveRef = can(me?.permissions, "reference:approve");

  const canApproveWork = can(me?.permissions, "work:approve");
  const key = "reference/provisional";
  const workKey = "work?workState=pending";
  const { data: rows, isLoading } = useApi<ProvisionalRow[]>(can(me?.permissions, "reference:view") ? key : null);
  // Work awaiting a governance confirm (draft/pending → confirmed is the "claim
  // becomes fact" step; §3.8). An approver confirms it here.
  const { data: pendingWork } = useApi<WorkListRow[]>(canApproveWork ? workKey : null);

  async function confirm(r: ProvisionalRow) {
    await apiSend(`reference/${r.id}/confirm`, "POST");
    await mutate(key);
    toast({ title: `Confirmed ${r.canonical}`, variant: "success" });
  }
  async function confirmWork(id: string) {
    await apiSend(`work/${id}/transition`, "POST", { toState: "confirmed" });
    await mutate(workKey);
    toast({ title: "Job confirmed", variant: "success" });
  }

  const columns: DataGridColumn<ProvisionalRow>[] = [
    { key: "kind", label: "Type", render: (r) => <Badge tone="amber">{r.kind.replace(/_/g, " ")}</Badge> },
    { key: "canonical", label: "Name / code", render: (r) => (r.kind === "course" || r.kind === "university" ? <Chip>{r.canonical}</Chip> : r.canonical) },
    { key: "parent", label: "Under" },
    { key: "createdAt", label: "Captured", render: (r) => <span className="text-slate-400">{formatDate(r.createdAt)}</span> },
  ];

  const otherQueues = [
    { href: "/resit", label: "Resit / rework approvals", perm: "work:approve" },
    { href: "/opening-balances", label: "Opening-balance migration", perm: "billing:approve" },
    { href: "/vendor-admin", label: "Vendor claims", perm: "vendor:approve" },
    { href: "/hrm", label: "Employee work logs", perm: "hrm:approve" },
  ].filter((q) => can(me?.permissions, q.perm));

  return (
    <AppShell>
      <DataGrid<ProvisionalRow>
        title="Approvals"
        sub="Provisional reference data captured on the fly — confirm to make it canonical, or merge duplicates in the Academic directory."
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={isLoading}
        emptyTitle="Nothing awaiting approval"
        rowActions={canApproveRef ? () => [{ icon: Check, label: "Confirm", tone: "blue", onClick: confirm }] : undefined}
        stats={[{ label: "Awaiting a steward", value: (rows ?? []).length, tone: (rows ?? []).length ? "gold" : "neutral" }]}
      />

      {canApproveWork && (
        <Card className="mt-4 p-0">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Work awaiting confirmation</h2>
            <Badge tone={(pendingWork ?? []).length ? "amber" : "gray"}>{(pendingWork ?? []).length}</Badge>
          </div>
          {!pendingWork || pendingWork.length === 0 ? (
            <div className="p-4"><EmptyState title="Nothing pending" hint="Logged work becomes a fact once an approver confirms it." /></div>
          ) : (
            <ul className="divide-y divide-ink-800">
              {pendingWork.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <Link href={`/work/${w.id}`} className="flex min-w-0 items-center gap-2 text-sm hover:underline">
                    {w.courseCode && <Chip>{w.courseCode}</Chip>}
                    <span className="truncate font-medium">{w.title}</span>
                    {w.doerName && <span className="shrink-0 text-xs text-slate-500">· {w.doerName}</span>}
                  </Link>
                  <Button variant="secondary" className="min-h-0 shrink-0 px-3 py-1 text-xs" onClick={() => void confirmWork(w.id)}>Confirm</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {otherQueues.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Other approval queues</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {otherQueues.map((q) => (
              <li key={q.href}><Link href={q.href} className="rounded-lg border border-ink-700 px-3 py-1.5 text-gold-600 hover:bg-ink-800 dark:text-gold-400">{q.label} →</Link></li>
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}
