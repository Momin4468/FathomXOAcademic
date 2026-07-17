"use client";
import { useEffect, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfLoan, type PfLoanEvent, type PfDashboard } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { PF, PfBtn, PfCard, PfField, PfInput, PfSelect, PfMoneyInput, PfBadge, PfNote, PfLoading, PfEmpty, PfTextBtn } from "@/components/pf-dc";

const today = () => new Date().toISOString().slice(0, 10);

export default function PfLoansPage() {
  const { data, error, isLoading, mutate } = usePfApi<PfLoan[]>("loans");
  const { data: dash } = usePfApi<PfDashboard>("dashboard");
  const [open, setOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const { confirmClose } = useUnsavedGuard(open && formDirty);
  const base = dash?.baseCurrency ?? "BDT";

  return (
    <PfShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Loans</h1>
        <PfBtn onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Add loan"}</PfBtn>
      </div>

      {dash && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <PfCard tone="green">
            <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: PF.green }}>Owed to me</div>
            <div style={{ fontSize: 21, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PF.green, marginTop: 4 }}>{pfMoney(dash.loans.givenOutstanding, base)}</div>
          </PfCard>
          <PfCard tone="red">
            <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: PF.red }}>I owe</div>
            <div style={{ fontSize: 21, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PF.red, marginTop: 4 }}>{pfMoney(dash.loans.takenOutstanding, base)}</div>
          </PfCard>
        </div>
      )}

      {open && <AddLoan onDirtyChange={setFormDirty} onDone={() => { setOpen(false); void mutate(); }} />}

      {isLoading && <PfLoading />}
      {error && <PfNote tone="red">{error.message}</PfNote>}
      {data && data.length === 0 && <PfEmpty title="No loans yet" hint="Track money you've lent or borrowed." />}
      {data && data.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {data.map((l) => <LoanRow key={l.id} loan={l} onChanged={mutate} />)}
        </ul>
      )}
    </PfShell>
  );
}

function AddLoan({ onDone, onDirtyChange }: { onDone: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const [form, setForm] = useState({ direction: "given", counterpartyName: "", principal: "", currency: "BDT", startedOn: today(), dueOn: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const dirty = !!form.counterpartyName || !!form.principal || !!form.dueOn || !!form.note;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.counterpartyName.trim() || !form.principal) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not save") ?? "");
    } finally {
      setBusy(false);
    }
  }
  return (
    <PfCard style={{ marginBottom: 16 }}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <PfField label="Direction" error={fieldErrs.direction}>
            <PfSelect value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="given">I lent (given)</option>
              <option value="taken">I borrowed (taken)</option>
            </PfSelect>
          </PfField>
          <PfField label="Counterparty" error={fieldErrs.counterpartyName}><PfInput value={form.counterpartyName} onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })} placeholder="Name" /></PfField>
          <PfField label="Principal" error={fieldErrs.principal}><PfMoneyInput currency={form.currency} value={form.principal} onChange={(v) => setForm({ ...form, principal: v })} /></PfField>
          <PfField label="Currency" error={fieldErrs.currency}><PfSelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{PF_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</PfSelect></PfField>
          <PfField label="Started" error={fieldErrs.startedOn}><PfInput type="date" value={form.startedOn} onChange={(e) => setForm({ ...form, startedOn: e.target.value })} /></PfField>
          <PfField label="Due (optional)" error={fieldErrs.dueOn}><PfInput type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} /></PfField>
        </div>
        <PfField label="Note" error={fieldErrs.note}><PfInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></PfField>
        {err && <PfNote tone="red">{err}</PfNote>}
        <div><PfBtn type="submit" disabled={busy}>{busy ? "Saving…" : "Save loan"}</PfBtn></div>
      </form>
    </PfCard>
  );
}

function LoanRow({ loan, onChanged }: { loan: PfLoan; onChanged: () => void }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const { data: events, mutate } = usePfApi<PfLoanEvent[]>(open ? `loans/${loan.id}/events` : null);
  const [form, setForm] = useState({ kind: "repayment", amount: "", occurredOn: today() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function addEvent() {
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend(`loans/${loan.id}/events`, "POST", { kind: form.kind, amount: Number(form.amount), occurredOn: form.occurredOn });
      setForm({ ...form, amount: "" });
      await mutate();
      onChanged();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not add event") ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function reverse(eventId: string) {
    if (!(await confirm({ title: "Reverse this event?", body: "Append-only — a correcting entry is recorded.", danger: true, confirmLabel: "Reverse" }))) return;
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
      <PfCard>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 12.5 }}>
            <span style={{ fontWeight: 600, color: PF.text }}>{loan.counterpartyName}</span>
            <span style={{ marginLeft: 8 }}><PfBadge tone={loan.direction === "given" ? "blue" : "amber"}>{loan.direction === "given" ? "lent" : "borrowed"}</PfBadge></span>
            <div style={{ marginTop: 2, fontSize: 11, color: PF.muted }}>started {formatDate(loan.startedOn)}{loan.dueOn ? ` · due ${formatDate(loan.dueOn)}` : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10.5, color: PF.muted }}>outstanding</div>
            <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(loan.outstanding, loan.currency)}</div>
          </div>
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: PF.muted2 }}>of {pfMoney(loan.principal, loan.currency)} principal</span>
          <PfTextBtn onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Events"}</PfTextBtn>
        </div>

        {open && (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {events && events.length > 0 && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {events.map((ev) => (
                  <li key={ev.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${PF.hair}`, fontSize: 12.5, opacity: ev.reversesId ? 0.5 : 1 }}>
                    <span><PfBadge tone="gray">{ev.kind}</PfBadge> <span style={{ marginLeft: 6, fontSize: 11, color: PF.muted }}>{formatDate(ev.occurredOn)}</span></span>
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(ev.amount, loan.currency)}</span>
                      {!ev.reversesId && <PfTextBtn danger ariaLabel="Reverse loan event" onClick={() => reverse(ev.id)}>reverse</PfTextBtn>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
              <div style={{ width: 150 }}><PfField label="Type" error={fieldErrs.kind}><PfSelect value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="repayment">repayment</option><option value="disbursement">disbursement</option><option value="adjustment">adjustment</option></PfSelect></PfField></div>
              <div style={{ flex: 1, minWidth: 140 }}><PfField label="Amount" error={fieldErrs.amount}><PfMoneyInput currency={loan.currency} value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></PfField></div>
              <div style={{ width: 150 }}><PfField label="Date" error={fieldErrs.occurredOn}><PfInput type="date" value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} /></PfField></div>
              <PfBtn variant="secondary" disabled={busy || !form.amount} onClick={addEvent}>Add</PfBtn>
            </div>
            {err && <PfNote tone="red">{err}</PfNote>}
          </div>
        )}
      </PfCard>
    </li>
  );
}
