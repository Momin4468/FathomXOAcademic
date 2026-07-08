"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfLoan, type PfLoanEvent } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

export default function PfLoansPage() {
  const { data, error, isLoading, mutate } = usePfApi<PfLoan[]>("loans");
  const [open, setOpen] = useState(false);

  return (
    <PfShell>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Loans</h1>
        <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Add loan"}</Button>
      </div>
      {open && <AddLoan onDone={() => { setOpen(false); void mutate(); }} />}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No loans yet" hint="Track money you've lent or borrowed." />}
      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((l) => <LoanRow key={l.id} loan={l} onChanged={mutate} />)}
        </ul>
      )}
    </PfShell>
  );
}

function AddLoan({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ direction: "given", counterpartyName: "", principal: "", currency: "BDT", startedOn: today(), dueOn: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.counterpartyName.trim() || !form.principal) return;
    setBusy(true);
    setErr("");
    try {
      await pfApiSend("loans", "POST", {
        direction: form.direction,
        counterpartyName: form.counterpartyName.trim(),
        principal: Number(form.principal),
        currency: form.currency,
        startedOn: form.startedOn,
        dueOn: form.dueOn || undefined,
        note: form.note || undefined,
      });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-5">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Direction">
            <Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="given">I lent (given)</option>
              <option value="taken">I borrowed (taken)</option>
            </Select>
          </Field>
          <Field label="Counterparty"><Input value={form.counterpartyName} onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })} placeholder="Name" /></Field>
          <Field label="Principal"><MoneyInput value={form.principal} onChange={(v) => setForm({ ...form, principal: v })} /></Field>
          <Field label="Currency"><Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{PF_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label="Started"><DateInput value={form.startedOn} onChange={(v) => setForm({ ...form, startedOn: v })} /></Field>
          <Field label="Due (optional)"><DateInput value={form.dueOn} onChange={(v) => setForm({ ...form, dueOn: v })} /></Field>
        </div>
        <Field label="Note"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        {err && <ErrorNote message={err} />}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save loan"}</Button>
      </form>
    </Card>
  );
}

function LoanRow({ loan, onChanged }: { loan: PfLoan; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: events, mutate } = usePfApi<PfLoanEvent[]>(open ? `loans/${loan.id}/events` : null);
  const [form, setForm] = useState({ kind: "repayment", amount: "", occurredOn: today() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function addEvent() {
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    try {
      await pfApiSend(`loans/${loan.id}/events`, "POST", { kind: form.kind, amount: Number(form.amount), occurredOn: form.occurredOn });
      setForm({ ...form, amount: "" });
      await mutate();
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add event");
    } finally {
      setBusy(false);
    }
  }
  async function reverse(eventId: string) {
    if (!window.confirm("Reverse this event? (append-only — a correcting entry is recorded)")) return;
    try {
      await pfApiSend(`loans/events/${eventId}/reverse`, "POST");
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
          <div className="text-sm">
            <span className="font-medium">{loan.counterpartyName}</span>
            <span className="ml-2"><Badge tone={loan.direction === "given" ? "blue" : "amber"}>{loan.direction === "given" ? "lent" : "borrowed"}</Badge></span>
            <div className="mt-0.5 text-xs text-gray-500">
              started {formatDate(loan.startedOn)}{loan.dueOn ? ` · due ${formatDate(loan.dueOn)}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">outstanding</div>
            <div className="font-semibold tabular-nums">{pfMoney(loan.outstanding, loan.currency)}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-400">of {pfMoney(loan.principal, loan.currency)} principal</span>
          <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Events"}</Button>
        </div>

        {open && (
          <div className="mt-3 space-y-3">
            {events && events.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {events.map((ev) => (
                  <li key={ev.id} className={`flex items-center justify-between py-1.5 text-sm ${ev.reversesId ? "opacity-50" : ""}`}>
                    <span><Badge tone="gray">{ev.kind}</Badge> <span className="ml-1 text-xs text-gray-500">{formatDate(ev.occurredOn)}</span></span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{pfMoney(ev.amount, loan.currency)}</span>
                      {!ev.reversesId && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => reverse(ev.id)}>reverse</button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="sm:w-40"><Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="repayment">repayment</option><option value="disbursement">disbursement</option><option value="adjustment">adjustment</option></Select></Field></div>
              <div className="flex-1"><Field label="Amount"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field></div>
              <div className="sm:w-40"><Field label="Date"><DateInput value={form.occurredOn} onChange={(v) => setForm({ ...form, occurredOn: v })} /></Field></div>
              <Button variant="secondary" disabled={busy || !form.amount} onClick={addEvent}>Add</Button>
            </div>
            {err && <ErrorNote message={err} />}
          </div>
        )}
      </Card>
    </li>
  );
}
