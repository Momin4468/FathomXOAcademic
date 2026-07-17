"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate } from "@/lib/format";
import { pfMoney, type PfCashCheckin, type PfReconcile } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { PF, PfBtn, PfCard, PfCardHead, PfField, PfInput, PfMoneyInput, PfBadge, PfNote, PfLoading, PfEmpty, PfTextBtn } from "@/components/pf-dc";

const today = () => new Date().toISOString().slice(0, 10);

export default function PfCashPage() {
  const { data: rec, mutate: mutateRec } = usePfApi<PfReconcile>("cash/reconcile");
  const { data: history, error, isLoading, mutate: mutateHist } = usePfApi<PfCashCheckin[]>("cash/checkins");
  const refresh = () => { void mutateRec(); void mutateHist(); };

  return (
    <PfShell>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Cash check-in</h1>
        <p style={{ fontSize: 12, color: PF.onGradSub, margin: "4px 0 0" }}>Declare your cash-on-hand; we compare it with what your ledger implies. Nothing is auto-recorded.</p>
      </div>

      {rec && <ReconcileCard rec={rec} onAdjusted={refresh} />}

      <RecordCheckin onDone={refresh} />

      <div style={{ fontSize: 12.5, fontWeight: 700, color: PF.onGrad, margin: "24px 0 8px" }}>History</div>
      {isLoading && <PfLoading />}
      {error && <PfNote tone="red">{error.message}</PfNote>}
      {history && history.length === 0 && <PfEmpty title="No check-ins yet" hint="Record your cash-on-hand to start reconciling." />}
      {history && history.length > 0 && (
        <PfCard style={{ padding: 0, overflow: "hidden" }}>
          {history.map((c, i) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: i === 0 ? undefined : `1px solid ${PF.hair}`, fontSize: 12.5 }}>
              <span style={{ color: PF.text2 }}>{formatDate(c.asOf)}{c.note ? ` · ${c.note}` : ""}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(c.declaredAmount, c.currency)}</span>
            </div>
          ))}
        </PfCard>
      )}
    </PfShell>
  );
}

function ReconcileCard({ rec, onAdjusted }: { rec: PfReconcile; onAdjusted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (rec.status === "none") return null;
  if (rec.status === "baseline") {
    return (
      <PfCard style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, margin: 0, color: PF.text }}>First check-in recorded — the next one will reconcile against it.</p>
        {rec.latest && <p style={{ fontSize: 11, color: PF.muted, margin: "4px 0 0" }}>Declared {pfMoney(rec.latest.declaredAmount, rec.latest.currency)} on {formatDate(rec.latest.asOf)}.</p>}
      </PfCard>
    );
  }
  if (rec.status === "reconciled") {
    return (
      <PfCard tone="green" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, margin: 0, color: PF.green }}>Reconciled ✓</p>
        <p style={{ fontSize: 11, color: PF.text2, margin: "4px 0 0" }}>Your declared cash matches what the ledger implies since your last check-in.</p>
      </PfCard>
    );
  }

  // over | under — surface the delta + an optional, user-confirmed adjustment.
  const sug = rec.suggestedAdjustment;
  const currency = rec.latest?.currency ?? "BDT";
  async function logAdjustment() {
    if (!sug || !rec.latest) return;
    setBusy(true);
    setErr("");
    try {
      // The suggestion is the user's to accept — nothing was written until now.
      await pfApiSend(sug.kind === "income" ? "income" : "expense", "POST", {
        amount: sug.amount,
        currency: sug.currency,
        occurredOn: rec.latest.asOf,
        note: "Cash reconciliation adjustment",
      });
      onAdjusted();
    } catch (e2) {
      setErr(bannerMessage(e2, "Could not log the adjustment") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PfCard tone="amber" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div><PfBadge tone="amber">{rec.status === "over" ? "more cash than expected" : "less cash than expected"}</PfBadge></div>
          <p style={{ fontSize: 11, color: PF.text2, margin: "8px 0 0" }}>
            You declared <span style={{ fontVariantNumeric: "tabular-nums" }}>{pfMoney(rec.latest?.declaredAmount, currency)}</span>; your ledger implies{" "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{pfMoney(rec.expected, currency)}</span> since {rec.prior ? formatDate(rec.prior.asOf) : "your last check-in"}.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10.5, color: PF.muted }}>unexplained</div>
          <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PF.amber }}>{pfMoney(Math.abs(rec.discrepancy ?? 0), currency)}</div>
        </div>
      </div>
      {sug && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <PfBtn variant="secondary" disabled={busy} onClick={logAdjustment}>{busy ? "Logging…" : `Log ${pfMoney(sug.amount, currency)} ${sug.kind}`}</PfBtn>
          <span style={{ fontSize: 11, color: PF.muted2 }}>Optional — reconcile by recording the missing {sug.kind}.</span>
        </div>
      )}
      {err && <div style={{ marginTop: 8 }}><PfNote tone="red">{err}</PfNote></div>}
    </PfCard>
  );
}

function RecordCheckin({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ asOf: today(), declaredAmount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.declaredAmount === "") return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend("cash/checkins", "POST", { asOf: form.asOf, declaredAmount: Number(form.declaredAmount), note: form.note || undefined });
      setForm({ asOf: today(), declaredAmount: "", note: "" });
      setOpen(false);
      onDone();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not record") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PfCard style={{ marginBottom: 16 }}>
      <PfCardHead right={<PfTextBtn onClick={() => setOpen((o) => !o)}>{open ? "Close" : "New"}</PfTextBtn>}>Record a check-in</PfCardHead>
      {open && (
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <PfField label="As of" error={fieldErrs.asOf}><PfInput type="date" value={form.asOf} onChange={(e) => setForm({ ...form, asOf: e.target.value })} /></PfField>
            <PfField label="Cash on hand" required error={fieldErrs.declaredAmount}><PfMoneyInput value={form.declaredAmount} onChange={(v) => setForm({ ...form, declaredAmount: v })} /></PfField>
            <PfField label="Note" error={fieldErrs.note}><PfInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></PfField>
          </div>
          {err && <PfNote tone="red">{err}</PfNote>}
          <div><PfBtn type="submit" disabled={busy || form.declaredAmount === ""}>{busy ? "Saving…" : "Record check-in"}</PfBtn></div>
        </form>
      )}
    </PfCard>
  );
}
