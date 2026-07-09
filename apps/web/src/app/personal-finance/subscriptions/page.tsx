"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfSubscription } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { DataTable } from "@/components/DataTable";
import { Badge, Button, Card, DateInput, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

export default function PfSubscriptionsPage() {
  const { data, error, isLoading, mutate } = usePfApi<PfSubscription[]>("subscriptions");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", amount: "", currency: "BDT", nextDueDate: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) return;
    setBusy(true);
    setErr("");
    try {
      await pfApiSend("subscriptions", "POST", {
        name: form.name.trim(),
        amount: Number(form.amount),
        currency: form.currency,
        nextDueDate: form.nextDueDate || undefined,
        note: form.note || undefined,
      });
      setForm({ name: "", amount: "", currency: "BDT", nextDueDate: "", note: "" });
      setOpen(false);
      await mutate();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    await pfApiSend(`subscriptions/${id}/archive`, "POST");
    await mutate();
  }
  async function runReminders() {
    setMsg("");
    try {
      const r = await pfApiSend<{ sent: number }>("subscriptions/reminders/run", "POST");
      setMsg(`Reminders sent: ${r.sent}`);
    } catch (e2) {
      setMsg(e2 instanceof Error ? e2.message : "Could not run reminders");
    }
  }

  return (
    <PfShell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-xs text-gray-500">An email reminder fires 3 days before each next due date.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={runReminders}>Run reminders</Button>
          <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Add"}</Button>
        </div>
      </div>
      {msg && <p className="mb-3 text-xs text-emerald-700">{msg}</p>}

      {open && (
        <Card className="mb-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Netflix" /></Field>
              <Field label="Next due date" hint="Reminder fires 3 days before."><DateInput value={form.nextDueDate} onChange={(v) => setForm({ ...form, nextDueDate: v })} /></Field>
              <Field label="Amount"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
              <Field label="Currency"><Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{PF_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
            </div>
            <Field label="Note"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            {err && <ErrorNote message={err} />}
            <Button type="submit" disabled={busy || !form.name.trim() || !form.amount}>{busy ? "Saving…" : "Save subscription"}</Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <DataTable<PfSubscription>
          tableId="pf-subscriptions"
          exportName="subscriptions"
          rows={data}
          getRowId={(s) => s.id}
          emptyTitle="No subscriptions yet"
          columns={[
            { key: "name", header: "Name", sortable: true, value: (s) => s.name },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              sortable: true,
              total: true,
              // Per-row currency: render with pfMoney; numeric value drives sort/total.
              render: (s) => <span className="tabular-nums">{pfMoney(s.amount, s.currency)}</span>,
              value: (s) => (s.amount == null ? "" : Number(s.amount)),
            },
            {
              key: "nextDueDate",
              header: "Next due",
              sortable: true,
              render: (s) => (s.nextDueDate ? <Badge tone="amber">{formatDate(s.nextDueDate)}</Badge> : <span className="text-gray-400">—</span>),
              value: (s) => s.nextDueDate ?? "",
            },
            { key: "note", header: "Note", filter: "text", value: (s) => s.note ?? "" },
            {
              key: "action",
              header: "",
              align: "right",
              render: (s) => (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    archive(s.id);
                  }}
                >
                  archive
                </button>
              ),
            },
          ]}
        />
      )}
    </PfShell>
  );
}
