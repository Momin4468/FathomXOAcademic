"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfSubscription } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

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
      {data && data.length === 0 && <EmptyState title="No subscriptions yet" />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <span className="font-medium">{s.name}</span>
                {s.nextDueDate ? <span className="ml-2"><Badge tone="amber">due {formatDate(s.nextDueDate)}</Badge></span> : null}
                {s.note ? <div className="mt-0.5 text-xs text-gray-500">{s.note}</div> : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">{pfMoney(s.amount, s.currency)}</span>
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => archive(s.id)}>archive</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PfShell>
  );
}
