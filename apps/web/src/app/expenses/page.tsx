"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { can, type Expense, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
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
  MoneyInput,
  Select,
  Spinner,
} from "@/components/ui";

const CATEGORIES = ["subscription", "salary", "promo", "loss", "event", "other"];
const COST_BEARERS = ["party", "split", "writer"];
const CURRENCIES = ["BDT", "USD", "GBP", "EUR", "AUD"];

type PartyRow = { id: string; displayName: string; externalRef?: string | null };
// Cost-bearer parties are partners; search the directory (pick-don't-type).
const searchPartner = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=partner`);
  return rows.map((p) => ({ id: p.id, label: p.displayName, sub: p.externalRef ?? undefined }));
};

export default function ExpensesPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data, error, isLoading, mutate } = useApi<{ expenses: Expense[]; total: string }>("expenses");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category: "subscription",
    amount: "",
    incurredAt: new Date().toISOString().slice(0, 10),
    costBearer: "party",
    campaignTag: "",
    note: "",
    nextDueDate: "",
    currency: "BDT",
  });
  // cost_bearer='party' → one bearer; 'split' → a list of {party, share}.
  const [bearer, setBearer] = useState<PickItem | null>(null);
  const [splitRows, setSplitRows] = useState<Array<{ id: string; label: string; share: string }>>([]);
  const [splitKey, setSplitKey] = useState(0); // remount the add-picker after each add
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
    if (form.costBearer === "party" && !bearer) {
      setFormError("Pick the partner who bears this cost.");
      return;
    }
    if (form.costBearer === "split" && splitRows.some((r) => !(Number(r.share) > 0))) {
      setFormError("Each split party needs a positive share.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await apiSend("expenses", "POST", {
        category: form.category,
        amount: Number(form.amount),
        incurredAt: form.incurredAt,
        costBearer: form.costBearer,
        bearerPartyId: form.costBearer === "party" ? bearer?.id : undefined,
        costBearerSplitJson:
          form.costBearer === "split"
            ? Object.fromEntries(splitRows.map((r) => [r.id, Number(r.share)]))
            : undefined,
        campaignTag: form.category === "promo" && form.campaignTag ? form.campaignTag : undefined,
        note: form.note || undefined,
        nextDueDate: form.category === "subscription" && form.nextDueDate ? form.nextDueDate : undefined,
        currency: form.category === "subscription" ? form.currency : undefined,
      });
      setOpen(false);
      setForm({ ...form, amount: "", campaignTag: "", note: "", nextDueDate: "" });
      setBearer(null);
      setSplitRows([]);
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
                <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
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
            {form.costBearer === "party" && (
              <Field label="Borne by" hint="The partner who bears this cost.">
                <EntityPicker placeholder="Search partner…" search={searchPartner} onPick={setBearer} />
              </Field>
            )}
            {form.costBearer === "split" && (
              <Field label="Split between" hint="Add each partner and their share.">
                <div className="space-y-2">
                  {splitRows.map((r, i) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm">{r.label}</span>
                      <MoneyInput
                        className="w-24"
                        value={r.share}
                        onChange={(v) =>
                          setSplitRows(splitRows.map((x, j) => (j === i ? { ...x, share: v } : x)))
                        }
                      />
                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:underline"
                        onClick={() => setSplitRows(splitRows.filter((_, j) => j !== i))}
                      >
                        remove
                      </button>
                    </div>
                  ))}
                  <EntityPicker
                    key={splitKey}
                    placeholder="Add a partner…"
                    search={searchPartner}
                    onPick={(item) => {
                      if (item && !splitRows.some((r) => r.id === item.id)) {
                        setSplitRows([...splitRows, { id: item.id, label: item.label, share: "" }]);
                      }
                      setSplitKey((k) => k + 1);
                    }}
                  />
                </div>
              </Field>
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
