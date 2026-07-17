"use client";
import { useEffect, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfSaving, type PfSavingEvent } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { PF, PfBtn, PfCard, PfField, PfInput, PfSelect, PfMoneyInput, PfBadge, PfNote, PfLoading, PfEmpty, PfProgress, PfTextBtn } from "@/components/pf-dc";

const today = () => new Date().toISOString().slice(0, 10);

export default function PfSavingsPage() {
  const { data, error, isLoading, mutate } = usePfApi<PfSaving[]>("savings");
  const [open, setOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const { confirmClose } = useUnsavedGuard(open && formDirty);

  return (
    <PfShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Savings</h1>
        <PfBtn onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Add pot"}</PfBtn>
      </div>
      {open && <AddSaving onDirtyChange={setFormDirty} onDone={() => { setOpen(false); void mutate(); }} />}

      {isLoading && <PfLoading />}
      {error && <PfNote tone="red">{error.message}</PfNote>}
      {data && data.length === 0 && <PfEmpty title="No savings pots yet" hint="Create a pot and track deposits." />}
      {data && data.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>{data.map((s) => <SavingRow key={s.id} saving={s} onChanged={mutate} />)}</ul>
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
    <PfCard style={{ marginBottom: 16 }}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <PfField label="Name" error={fieldErrs.name}><PfInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Emergency fund" /></PfField>
          <PfField label="Currency" error={fieldErrs.currency}><PfSelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{PF_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</PfSelect></PfField>
          <PfField label="Target (optional)" error={fieldErrs.targetAmount}><PfMoneyInput currency={form.currency} value={form.targetAmount} onChange={(v) => setForm({ ...form, targetAmount: v })} /></PfField>
          <PfField label="Note" error={fieldErrs.note}><PfInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></PfField>
        </div>
        {err && <PfNote tone="red">{err}</PfNote>}
        <div><PfBtn type="submit" disabled={busy}>{busy ? "Saving…" : "Create pot"}</PfBtn></div>
      </form>
    </PfCard>
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
      <PfCard>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: PF.text }}>{saving.name}</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10.5, color: PF.muted }}>balance</div>
            <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(saving.balance, saving.currency)}</div>
          </div>
        </div>
        {pct !== null && (
          <div style={{ marginTop: 10 }}>
            <PfProgress pct={pct} />
            <div style={{ marginTop: 4, fontSize: 11, color: PF.muted2 }}>{pct}% of {pfMoney(saving.targetAmount, saving.currency)} target</div>
          </div>
        )}
        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
          <PfTextBtn onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Movements"}</PfTextBtn>
        </div>

        {open && (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {events && events.length > 0 && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {events.map((ev) => (
                  <li key={ev.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${PF.hair}`, fontSize: 12.5, opacity: ev.reversesId ? 0.5 : 1 }}>
                    <span><PfBadge tone={ev.kind === "deposit" ? "green" : "gray"}>{ev.kind}</PfBadge> <span style={{ marginLeft: 6, fontSize: 11, color: PF.muted }}>{formatDate(ev.occurredOn)}</span></span>
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(ev.amount, saving.currency)}</span>
                      {!ev.reversesId && <PfTextBtn danger ariaLabel="Reverse movement" onClick={() => reverse(ev.id)}>reverse</PfTextBtn>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
              <div style={{ width: 150 }}><PfField label="Type" error={fieldErrs.kind}><PfSelect value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="deposit">deposit</option><option value="withdraw">withdraw</option></PfSelect></PfField></div>
              <div style={{ flex: 1, minWidth: 140 }}><PfField label="Amount" error={fieldErrs.amount}><PfMoneyInput currency={saving.currency} value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></PfField></div>
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
