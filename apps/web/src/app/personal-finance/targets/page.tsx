"use client";
import { useMemo, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { pfMoney, type PfCategory, type PfTarget } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };
const KIND_LABEL: Record<string, string> = { budget_cap: "Budget cap", income_goal: "Income goal", savings_target: "Savings target" };

export default function PfTargetsPage() {
  const { data, error, isLoading, mutate } = usePfApi<PfTarget[]>("targets");
  const { data: categories } = usePfApi<PfCategory[]>("categories");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "budget_cap", categoryId: "", period: "month", periodStart: monthStart(), amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const relevantCats = useMemo(() => {
    const wantKind = form.kind === "income_goal" ? "income" : form.kind === "budget_cap" ? "expense" : null;
    if (!wantKind) return [];
    return (categories ?? []).filter((c) => c.kind === wantKind);
  }, [categories, form.kind]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    try {
      await pfApiSend("targets", "POST", {
        kind: form.kind,
        categoryId: form.kind !== "savings_target" && form.categoryId ? form.categoryId : undefined,
        period: form.period,
        periodStart: form.periodStart,
        amount: Number(form.amount),
        note: form.note || undefined,
      });
      setForm({ ...form, amount: "", note: "", categoryId: "" });
      setOpen(false);
      await mutate();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    await pfApiSend(`targets/${id}/archive`, "POST");
    await mutate();
  }

  return (
    <PfShell>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Targets & budgets</h1>
        <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Add target"}</Button>
      </div>

      {open && (
        <Card className="mb-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Type">
                <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, categoryId: "" })}>
                  <option value="budget_cap">Budget cap (expense)</option>
                  <option value="income_goal">Income goal</option>
                  <option value="savings_target">Savings target</option>
                </Select>
              </Field>
              <Field label="Period">
                <Select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}><option value="month">Monthly</option><option value="year">Yearly</option></Select>
              </Field>
              {form.kind !== "savings_target" && (
                <Field label="Category (optional)">
                  <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                    <option value="">All categories</option>
                    {relevantCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Starts"><DateInput value={form.periodStart} onChange={(v) => setForm({ ...form, periodStart: v })} /></Field>
              <Field label="Amount"><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            </div>
            <Field label="Note"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            {err && <ErrorNote message={err} />}
            <Button type="submit" disabled={busy || !form.amount}>{busy ? "Saving…" : "Save target"}</Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No targets yet" hint="Set a budget cap, an income goal, or a savings target." />}
      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((t) => {
            const amount = Number(t.amount);
            const current = Number(t.current);
            const pct = amount > 0 ? Math.min(100, Math.round((current / amount) * 100)) : 0;
            const over = t.kind === "budget_cap" && current > amount;
            return (
              <li key={t.id}>
                <Card>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">
                      {KIND_LABEL[t.kind]} <Badge tone="gray">{t.period === "year" ? "yearly" : "monthly"}</Badge>
                    </span>
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => archive(t.id)}>archive</button>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                    <span>{pfMoney(t.current, t.currency)} of {pfMoney(t.amount, t.currency)} {over ? "· over!" : `· ${pct}%`}</span>
                    <span>from {formatDate(t.periodStart)}</span>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PfShell>
  );
}
