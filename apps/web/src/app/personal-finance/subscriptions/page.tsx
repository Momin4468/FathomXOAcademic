"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfSubscription } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { PF, PfBtn, PfCard, PfField, PfInput, PfSelect, PfMoneyInput, PfBadge, PfNote, PfLoading, PfEmpty, PfTextBtn } from "@/components/pf-dc";

export default function PfSubscriptionsPage() {
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = usePfApi<PfSubscription[]>("subscriptions");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", amount: "", currency: "BDT", nextDueDate: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const dirty = !!form.name || !!form.amount || !!form.nextDueDate || !!form.note;
  const { confirmClose } = useUnsavedGuard(dirty);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not save") ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    if (!(await confirm({ title: "Archive this subscription?", danger: true, confirmLabel: "Archive" }))) return;
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

  const th: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: PF.muted, padding: "9px 14px", borderBottom: `1px solid ${PF.border}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "9px 14px", borderBottom: `1px solid ${PF.hair}`, verticalAlign: "middle" };

  return (
    <PfShell>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Subscriptions</h1>
          <p style={{ fontSize: 12, color: PF.onGradSub, margin: "4px 0 0" }}>An email reminder fires 3 days before each next due date.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PfBtn variant="secondary" onClick={runReminders}>Run reminders</PfBtn>
          <PfBtn onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Add"}</PfBtn>
        </div>
      </div>
      <div aria-live="polite">{msg && <p style={{ fontSize: 11, color: PF.light, marginBottom: 12 }}>{msg}</p>}</div>

      {open && (
        <PfCard style={{ marginBottom: 16 }}>
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <PfField label="Name" error={fieldErrs.name}><PfInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Netflix" /></PfField>
              <PfField label="Next due date" hint="Reminder fires 3 days before." error={fieldErrs.nextDueDate}><PfInput type="date" value={form.nextDueDate} onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })} /></PfField>
              <PfField label="Amount" error={fieldErrs.amount}><PfMoneyInput currency={form.currency} value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></PfField>
              <PfField label="Currency" error={fieldErrs.currency}><PfSelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{PF_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</PfSelect></PfField>
            </div>
            <PfField label="Note" error={fieldErrs.note}><PfInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></PfField>
            {err && <PfNote tone="red">{err}</PfNote>}
            <div><PfBtn type="submit" disabled={busy || !form.name.trim() || !form.amount}>{busy ? "Saving…" : "Save subscription"}</PfBtn></div>
          </form>
        </PfCard>
      )}

      {isLoading && <PfLoading />}
      {error && <PfNote tone="red">{error.message}</PfNote>}
      {data && data.length === 0 && <PfEmpty title="No subscriptions yet" />}
      {data && data.length > 0 && (
        <div style={{ background: PF.card, border: `1px solid ${PF.border}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Name</th>
                <th style={{ ...th, textAlign: "right" }}>Amount</th>
                <th style={{ ...th, textAlign: "left" }}>Next due</th>
                <th style={{ ...th, textAlign: "left" }}>Note</th>
                <th style={{ ...th, width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 500, color: PF.text }}>{s.name}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(s.amount, s.currency)}</td>
                  <td style={td}>{s.nextDueDate ? <PfBadge tone="amber">{formatDate(s.nextDueDate)}</PfBadge> : <span style={{ color: PF.muted2 }}>—</span>}</td>
                  <td style={{ ...td, color: PF.text2 }}>{s.note ?? ""}</td>
                  <td style={{ ...td, textAlign: "right" }}><PfTextBtn danger ariaLabel="Archive subscription" onClick={() => archive(s.id)}>archive</PfTextBtn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PfShell>
  );
}
