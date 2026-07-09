"use client";
import { useEffect, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfCategory, type PfInvestment, type PfInvestmentEvent } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

export default function PfInvestmentsPage() {
  const { data, error, isLoading, mutate } = usePfApi<PfInvestment[]>("investments");
  const [open, setOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const { confirmClose } = useUnsavedGuard(open && formDirty);

  return (
    <PfShell>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Investments</h1>
        <Button onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Add holding"}</Button>
      </div>
      <p className="mb-4 text-xs text-gray-500">Current value & profit/loss are derived from your value updates — never stored.</p>
      {open && <AddInvestment onDirtyChange={setFormDirty} onDone={() => { setOpen(false); void mutate(); }} />}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No investments yet" hint="Add a holding, then log value updates." />}
      {data && data.length > 0 && (
        <ul className="space-y-3">{data.map((i) => <InvestmentRow key={i.id} inv={i} onChanged={mutate} />)}</ul>
      )}
    </PfShell>
  );
}

function AddInvestment({ onDone, onDirtyChange }: { onDone: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const { data: types } = usePfApi<PfCategory[]>("categories?kind=investment");
  const [form, setForm] = useState({ name: "", categoryId: "", principal: "", currency: "BDT", startedOn: today(), note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const dirty = !!form.name || !!form.principal || !!form.note;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.principal) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend("investments", "POST", {
        name: form.name.trim(),
        categoryId: form.categoryId || undefined,
        principal: Number(form.principal),
        currency: form.currency,
        startedOn: form.startedOn,
        note: form.note || undefined,
      });
      onDone();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not save") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required error={fieldErrs.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme shares" /></Field>
          <Field label="Type" error={fieldErrs.categoryId}>
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Uncategorised</option>
              {(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Amount invested (principal)" required error={fieldErrs.principal}><MoneyInput value={form.principal} onChange={(v) => setForm({ ...form, principal: v })} /></Field>
          <Field label="Currency" error={fieldErrs.currency}><Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{PF_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label="Started on" error={fieldErrs.startedOn}><DateInput value={form.startedOn} onChange={(v) => setForm({ ...form, startedOn: v })} /></Field>
          <Field label="Note" error={fieldErrs.note}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
        {err && <ErrorNote message={err} />}
        <Button type="submit" disabled={busy || !form.name.trim() || !form.principal}>{busy ? "Saving…" : "Add holding"}</Button>
      </form>
    </Card>
  );
}

function InvestmentRow({ inv, onChanged }: { inv: PfInvestment; onChanged: () => void }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const { data: events, mutate } = usePfApi<PfInvestmentEvent[]>(open ? `investments/${inv.id}/events` : null);
  const [form, setForm] = useState({ kind: "valuation", amount: "", occurredOn: today() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const gain = inv.unrealizedPl >= 0;

  async function addEvent() {
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend(`investments/${inv.id}/events`, "POST", { kind: form.kind, amount: Number(form.amount), occurredOn: form.occurredOn });
      setForm({ ...form, amount: "" });
      await mutate();
      onChanged();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not add update") ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function reverse(eventId: string) {
    if (!(await confirm({ title: "Reverse this update?", body: "Append-only — a correcting entry is recorded.", danger: true, confirmLabel: "Reverse" }))) return;
    try {
      await pfApiSend(`investments/events/${eventId}/reverse`, "POST");
      await mutate();
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not reverse");
    }
  }

  return (
    <li>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-medium">{inv.name}</div>
          <div className="text-right">
            <div className="text-xs text-gray-500">current value</div>
            <div className="font-semibold tabular-nums">{pfMoney(inv.currentValue, inv.currency)}</div>
            <div className={`text-xs tabular-nums ${gain ? "text-emerald-700" : "text-rose-700"}`}>
              {gain ? "▲" : "▼"} {pfMoney(Math.abs(inv.unrealizedPl), inv.currency)} vs {pfMoney(inv.costBasis, inv.currency)} in
            </div>
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Value updates"}</Button>
        </div>

        {open && (
          <div className="mt-3 space-y-3">
            {events && events.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {events.map((ev) => (
                  <li key={ev.id} className={`flex items-center justify-between py-1.5 text-sm ${ev.reversesId ? "opacity-50" : ""}`}>
                    <span>
                      <Badge tone={ev.kind === "valuation" ? "blue" : ev.kind === "contribution" ? "green" : "amber"}>{ev.kind}</Badge>
                      <span className="ml-1 text-xs text-gray-500">{formatDate(ev.occurredOn)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{pfMoney(ev.amount, inv.currency)}</span>
                      {!ev.reversesId && <button type="button" aria-label="Reverse update" className="text-xs text-red-600 hover:underline" onClick={() => reverse(ev.id)}>reverse</button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="sm:w-44"><Field label="Update" error={fieldErrs.kind}>
                <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="valuation">valuation (mark value)</option>
                  <option value="contribution">contribution (add money)</option>
                  <option value="withdrawal">withdrawal (take out)</option>
                </Select>
              </Field></div>
              <div className="flex-1"><Field label="Amount" error={fieldErrs.amount}><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field></div>
              <div className="sm:w-40"><Field label="Date" error={fieldErrs.occurredOn}><DateInput value={form.occurredOn} onChange={(v) => setForm({ ...form, occurredOn: v })} /></Field></div>
              <Button variant="secondary" disabled={busy || !form.amount} onClick={addEvent}>Add</Button>
            </div>
            <p className="text-xs text-gray-400">A <b>valuation</b> sets the current worth (latest wins). <b>Contribution</b>/<b>withdrawal</b> move your cost basis.</p>
            {err && <ErrorNote message={err} />}
          </div>
        )}
      </Card>
    </li>
  );
}
