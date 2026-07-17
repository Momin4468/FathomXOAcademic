"use client";
import { useState } from "react";
import { Banknote } from "lucide-react";
import { apiSend, useApi } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataGrid, type DataGridColumn } from "@/components/DataGrid";
import { Badge, EmptyState, Money } from "@/components/ui";
import { useToast } from "@/components/toast";

interface PayrollRow {
  compRuleId: string;
  partyId: string;
  name: string;
  salary: number;
  paidThisMonth: number;
  outstanding: number;
  status: "due" | "partial" | "paid";
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Payroll (handoff §18) — salaried staff (parties on a monthly comp rule),
 * monthly salary vs paid-this-cycle (derived from `salary` expenses). Paying
 * settles through the Cashbook: "Pay" records a salary expense for the
 * outstanding amount, attributed to the recording admin. Read-time derived —
 * nothing stored twice.
 */
export default function PayrollPage() {
  const { toast } = useToast();
  const { data: me, mutate: _m } = useApi<WhoAmI>("platform/whoami");
  const canView = can(me?.permissions, "hrm:approve");
  const canPay = can(me?.permissions, "expenses:create") && !!me?.party?.id;

  const key = "worklog/payroll";
  const { data: rows, isLoading, mutate } = useApi<PayrollRow[]>(canView ? key : null);
  const [busy, setBusy] = useState<string | null>(null);

  async function pay(row: PayrollRow) {
    if (!(row.outstanding > 0) || !me?.party?.id) return;
    setBusy(row.compRuleId);
    try {
      await apiSend("expenses", "POST", {
        category: "salary",
        amount: row.outstanding,
        incurredAt: today(),
        costBearer: "party",
        bearerPartyId: me.party.id,
        payeePartyId: row.partyId,
        note: `Salary — ${row.name}`,
      });
      await mutate();
      toast({ title: `Paid ${row.name}`, description: "Posted to the Cashbook (Salary).", variant: "success" });
    } catch (e) {
      toast({ title: "Could not pay", description: e instanceof Error ? e.message : "", variant: "error" });
    } finally { setBusy(null); }
  }

  const columns: DataGridColumn<PayrollRow>[] = [
    { key: "name", label: "Staff", render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "salary", label: "Monthly", align: "right", render: (r) => <Money value={r.salary} /> },
    { key: "paidThisMonth", label: "Paid this cycle", align: "right", render: (r) => <span className="text-emerald-600 dark:text-emerald-400"><Money value={r.paidThisMonth} /></span> },
    { key: "outstanding", label: "Outstanding", align: "right", render: (r) => <span className={r.outstanding > 0 ? "text-red-600 dark:text-red-400" : ""}><Money value={r.outstanding} /></span> },
    { key: "status", label: "Status", align: "center", render: (r) => <Badge tone={r.status === "paid" ? "green" : r.status === "partial" ? "amber" : "red"}>{r.status}</Badge> },
    {
      key: "pay", label: "", align: "right",
      render: (r) => (canPay && r.outstanding > 0
        ? <button type="button" disabled={busy === r.compRuleId} onClick={() => pay(r)} className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-2 py-1 text-xs text-gold-600 hover:bg-ink-800 disabled:opacity-50 dark:text-gold-400"><Banknote className="h-3.5 w-3.5" /> {busy === r.compRuleId ? "Paying…" : "Pay"}</button>
        : null),
    },
  ];

  if (!canView) return <AppShell><EmptyState title="Not authorized" hint="Payroll is an admin surface (hrm:approve)." /></AppShell>;

  const totals = (rows ?? []).reduce((a, r) => ({ s: a.s + r.salary, p: a.p + r.paidThisMonth, o: a.o + r.outstanding }), { s: 0, p: 0, o: 0 });

  return (
    <AppShell>
      <DataGrid<PayrollRow>
        title="Payroll"
        sub="Salaried staff — monthly runs. Paying settles through the Cashbook (Salary category). Salary & paid figures are derived."
        columns={columns}
        rows={rows}
        getRowId={(r) => r.compRuleId}
        loading={isLoading}
        emptyTitle="No salaried staff"
        stats={[
          { label: "Monthly payroll", value: <Money value={round2(totals.s)} /> },
          { label: "Paid this cycle", value: <Money value={round2(totals.p)} />, tone: "green" },
          { label: "Outstanding", value: <Money value={round2(totals.o)} />, tone: totals.o > 0 ? "red" : "neutral" },
        ]}
        foot="Salaried staff are separate from per-task writers. A salaried person is anyone on a monthly comp rule (Settings › comp rules / the rules engine)."
      />
    </AppShell>
  );
}
