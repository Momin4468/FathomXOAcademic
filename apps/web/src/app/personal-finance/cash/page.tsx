"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate } from "@/lib/format";
import { pfMoney, type PfCashCheckin, type PfReconcile } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Spinner } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

export default function PfCashPage() {
  const { data: rec, mutate: mutateRec } = usePfApi<PfReconcile>("cash/reconcile");
  const { data: history, error, isLoading, mutate: mutateHist } = usePfApi<PfCashCheckin[]>("cash/checkins");
  const refresh = () => { void mutateRec(); void mutateHist(); };

  return (
    <PfShell>
      <div className="mb-1">
        <h1 className="text-lg font-semibold tracking-tight">Cash check-in</h1>
        <p className="text-xs text-slate-400">Declare your cash-on-hand; we compare it with what your ledger implies. Nothing is auto-recorded.</p>
      </div>

      {rec && <ReconcileCard rec={rec} onAdjusted={refresh} />}

      <RecordCheckin onDone={refresh} />

      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-200">History</h2>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {history && history.length === 0 && <EmptyState title="No check-ins yet" hint="Record your cash-on-hand to start reconciling." />}
      {history && history.length > 0 && (
        <ul className="divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-850">
          {history.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-slate-300">{formatDate(c.asOf)}{c.note ? ` · ${c.note}` : ""}</span>
              <span className="font-medium tabular-nums">{pfMoney(c.declaredAmount, c.currency)}</span>
            </li>
          ))}
        </ul>
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
      <Card className="mb-5">
        <p className="text-sm">First check-in recorded — the next one will reconcile against it.</p>
        {rec.latest && <p className="mt-1 text-xs text-slate-400">Declared {pfMoney(rec.latest.declaredAmount, rec.latest.currency)} on {formatDate(rec.latest.asOf)}.</p>}
      </Card>
    );
  }
  if (rec.status === "reconciled") {
    return (
      <Card className="mb-5 border-emerald-200">
        <p className="text-sm font-medium text-emerald-800">Reconciled ✓</p>
        <p className="mt-1 text-xs text-slate-400">Your declared cash matches what the ledger implies since your last check-in.</p>
      </Card>
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
    <Card className="mb-5 border-amber-200">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            <Badge tone="amber">{rec.status === "over" ? "more cash than expected" : "less cash than expected"}</Badge>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            You declared <span className="tabular-nums">{pfMoney(rec.latest?.declaredAmount, currency)}</span>; your ledger implies{" "}
            <span className="tabular-nums">{pfMoney(rec.expected, currency)}</span> since {rec.prior ? formatDate(rec.prior.asOf) : "your last check-in"}.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">unexplained</div>
          <div className="font-semibold tabular-nums">{pfMoney(Math.abs(rec.discrepancy ?? 0), currency)}</div>
        </div>
      </div>
      {sug && (
        <div className="mt-3 flex items-center gap-3">
          <Button variant="secondary" disabled={busy} onClick={logAdjustment}>
            {busy ? "Logging…" : `Log ${pfMoney(sug.amount, currency)} ${sug.kind}`}
          </Button>
          <span className="text-xs text-slate-500">Optional — reconcile by recording the missing {sug.kind}.</span>
        </div>
      )}
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
    </Card>
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
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Record a check-in</h2>
        <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "New"}</Button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="As of" error={fieldErrs.asOf}><DateInput value={form.asOf} onChange={(v) => setForm({ ...form, asOf: v })} /></Field>
            <Field label="Cash on hand" required error={fieldErrs.declaredAmount}><MoneyInput value={form.declaredAmount} onChange={(v) => setForm({ ...form, declaredAmount: v })} /></Field>
            <Field label="Note" error={fieldErrs.note}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
          {err && <ErrorNote message={err} />}
          <Button type="submit" disabled={busy || form.declaredAmount === ""}>{busy ? "Saving…" : "Record check-in"}</Button>
        </form>
      )}
    </Card>
  );
}
