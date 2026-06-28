"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { can, type Expense, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Button,
  Card,
  DateInput,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Money,
  Select,
  Spinner,
} from "@/components/ui";

const CATEGORIES = ["subscription", "salary", "promo", "loss", "event", "other"];
const COST_BEARERS = ["momin", "emon", "split", "writer"];
const CURRENCIES = ["BDT", "USD", "GBP", "EUR", "AUD"];

export default function ExpensesPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data, error, isLoading, mutate } = useApi<{ expenses: Expense[]; total: string }>("expenses");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category: "subscription",
    amount: "",
    incurredAt: new Date().toISOString().slice(0, 10),
    costBearer: "momin",
    splitMomin: "50",
    splitEmon: "50",
    campaignTag: "",
    note: "",
    nextDueDate: "",
    currency: "BDT",
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [reminderMsg, setReminderMsg] = useState("");

  const canCreate = can(me?.permissions, "expenses:create");
  const canApprove = can(me?.permissions, "expenses:approve");

  async function runReminders() {
    setReminderMsg("");
    try {
      const r = await apiSend<{ sent: number }>("expenses/reminders/run", "POST");
      setReminderMsg(`Reminders sent: ${r.sent}`);
    } catch (err) {
      setReminderMsg(err instanceof Error ? err.message : "Could not run reminders");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await apiSend("expenses", "POST", {
        category: form.category,
        amount: Number(form.amount),
        incurredAt: form.incurredAt,
        costBearer: form.costBearer,
        costBearerSplitJson:
          form.costBearer === "split"
            ? { momin: Number(form.splitMomin), emon: Number(form.splitEmon) }
            : undefined,
        campaignTag: form.category === "promo" && form.campaignTag ? form.campaignTag : undefined,
        note: form.note || undefined,
        nextDueDate: form.category === "subscription" && form.nextDueDate ? form.nextDueDate : undefined,
        currency: form.category === "subscription" ? form.currency : undefined,
      });
      setOpen(false);
      setForm({ ...form, amount: "", campaignTag: "", note: "", nextDueDate: "" });
      await mutate();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save expense");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Expenses</h1>
          {data && (
            <p className="text-xs text-gray-500">
              Total: <Money value={data.total} />
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canApprove && <Button variant="secondary" onClick={runReminders}>Run reminders</Button>}
          {canCreate && <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Add expense"}</Button>}
        </div>
      </div>
      {reminderMsg && <p className="mb-3 text-xs text-green-700">{reminderMsg}</p>}

      {open && canCreate && (
        <Card className="mb-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount">
                <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </Field>
              <Field label="Cost bearer">
                <Select value={form.costBearer} onChange={(e) => setForm({ ...form, costBearer: e.target.value })}>
                  {COST_BEARERS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Incurred on">
                <DateInput value={form.incurredAt} onChange={(v) => setForm({ ...form, incurredAt: v })} />
              </Field>
            </div>
            {form.costBearer === "split" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Split — Momin %">
                  <Input type="number" value={form.splitMomin} onChange={(e) => setForm({ ...form, splitMomin: e.target.value })} />
                </Field>
                <Field label="Split — Emon %">
                  <Input type="number" value={form.splitEmon} onChange={(e) => setForm({ ...form, splitEmon: e.target.value })} />
                </Field>
              </div>
            )}
            {form.category === "promo" && (
              <Field label="Campaign tag">
                <Input value={form.campaignTag} onChange={(e) => setForm({ ...form, campaignTag: e.target.value })} placeholder="e.g. JuneAds" />
              </Field>
            )}
            {form.category === "subscription" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Next due date" hint="A reminder fires 3 days before.">
                  <DateInput value={form.nextDueDate} onChange={(v) => setForm({ ...form, nextDueDate: v })} />
                </Field>
                <Field label="Currency">
                  <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                    {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </Select>
                </Field>
              </div>
            )}
            <Field label="Note">
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            {formError && <ErrorNote message={formError} />}
            <Button type="submit" disabled={busy || !form.amount}>
              {busy ? "Saving…" : "Save expense"}
            </Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.expenses.length === 0 && <EmptyState title="No expenses yet" />}
      {data && data.expenses.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {data.expenses.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="text-sm">
                <span className="font-medium capitalize">{x.category}</span>
                {x.campaignTag ? <span className="ml-2 text-xs text-gray-400">#{x.campaignTag}</span> : null}
                {x.nextDueDate ? <span className="ml-2 text-xs text-amber-700">due {formatDate(x.nextDueDate)}</span> : null}
                <div className="mt-0.5 text-xs text-gray-500">
                  {formatDate(x.incurredAt)} · <Badge>{x.costBearer}</Badge>
                </div>
              </div>
              <span className="text-sm font-medium tabular-nums">
                {x.currency && x.currency !== "BDT"
                  ? `${x.currency} ${formatMoney(x.amount, "") ?? x.amount}`
                  : <Money value={x.amount} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
