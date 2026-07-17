"use client";
import { useEffect, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfSaving, type PfSavingEvent } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

export default function PfSavingsPage() {
  const { data, error, isLoading, mutate } = usePfApi<PfSaving[]>("savings");
  const [open, setOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const { confirmClose } = useUnsavedGuard(open && formDirty);

  return (
    <PfShell>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Savings</h1>
        <Button onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Add pot"}</Button>
      </div>
      {open && <AddSaving onDirtyChange={setFormDirty} onDone={() => { setOpen(false); void mutate(); }} />}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No savings pots yet" hint="Create a pot and track deposits." />}
      {data && data.length > 0 && (
        <ul className="space-y-3">{data.map((s) => <SavingRow key={s.id} saving={s} onChanged={mutate} />)}</ul>
      )}
    </PfShell>
  );
}

function AddSaving({ onDone, onDirtyChange }: { onDone: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const [form, setForm] = useState({ name: "", currency: "BDT", targetAmount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const dirty = !!form.name || !!form.targetAmount || !!form.note;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend("savings", "POST", { name: form.name.trim(), currency: form.currency, targetAmount: form.targetAmount ? Number(form.targetAmount) : undefined, note: form.note || undefined });
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
          <Field label="Name" error={fieldErrs.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Emergency fund" /></Field>
          <Field label="Currency" error={fieldErrs.currency}><Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{PF_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label="Target (optional)" error={fieldErrs.targetAmount}><MoneyInput value={form.targetAmount} onChange={(v) => setForm({ ...form, targetAmount: v })} /></Field>
          <Field label="Note" error={fieldErrs.note}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
        {err && <ErrorNote message={err} />}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create pot"}</Button>
      </form>
    </Card>
  );
}

function SavingRow({ saving, onChanged }: { saving: PfSaving; onChanged: () => void }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const { data: events, mutate } = usePfApi<PfSavingEvent[]>(open ? `savings/${saving.id}/events` : null);
  const [form, setForm] = useState({ kind: "deposit", amount: "", occurredOn: today() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const pct = saving.targetAmount && Number(saving.targetAmount) > 0 ? Math.min(100, Math.round((Number(saving.balance) / Number(saving.targetAmount)) * 100)) : null;

  async function addEvent() {
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend(`savings/${saving.id}/events`, "POST", { kind: form.kind, amount: Number(form.amount), occurredOn: form.occurredOn });
      setForm({ ...form, amount: "" });
      await mutate();
      onChanged();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not add movement") ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function reverse(eventId: string) {
    if (!(await confirm({ title: "Reverse this movement?", body: "Append-only — a correcting entry is recorded.", danger: true, confirmLabel: "Reverse" }))) return;
    try {
      await pfApiSend(`savings/events/${eventId}/reverse`, "POST");
      await mutate();
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not reverse");
    }
  }

  return (
    <li>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">{saving.name}</div>
          <div className="text-right">
            <div className="text-xs text-slate-400">balance</div>
            <div className="font-semibold tabular-nums">{pfMoney(saving.balance, saving.currency)}</div>
          </div>
        </div>
        {pct !== null && (
          <div className="mt-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-ink-800">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-xs text-slate-500">{pct}% of {pfMoney(saving.targetAmount, saving.currency)} target</div>
          </div>
        )}
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Movements"}</Button>
        </div>

        {open && (
          <div className="mt-3 space-y-3">
            {events && events.length > 0 && (
              <ul className="divide-y divide-ink-800">
                {events.map((ev) => (
                  <li key={ev.id} className={`flex items-center justify-between py-1.5 text-sm ${ev.reversesId ? "opacity-50" : ""}`}>
                    <span><Badge tone={ev.kind === "deposit" ? "green" : "gray"}>{ev.kind}</Badge> <span className="ml-1 text-xs text-slate-400">{formatDate(ev.occurredOn)}</span></span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{pfMoney(ev.amount, saving.currency)}</span>
                      {!ev.reversesId && <button type="button" aria-label="Reverse movement" className="text-xs text-red-600 hover:underline" onClick={() => reverse(ev.id)}>reverse</button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="sm:w-40"><Field label="Type" error={fieldErrs.kind}><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="deposit">deposit</option><option value="withdraw">withdraw</option></Select></Field></div>
              <div className="flex-1"><Field label="Amount" error={fieldErrs.amount}><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field></div>
              <div className="sm:w-40"><Field label="Date" error={fieldErrs.occurredOn}><DateInput value={form.occurredOn} onChange={(v) => setForm({ ...form, occurredOn: v })} /></Field></div>
              <Button variant="secondary" disabled={busy || !form.amount} onClick={addEvent}>Add</Button>
            </div>
            {err && <ErrorNote message={err} />}
          </div>
        )}
      </Card>
    </li>
  );
}
