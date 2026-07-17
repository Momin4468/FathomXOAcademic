"use client";
import { useMemo, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { pfMoney, type PfCategory, type PfTarget } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { PF, PfBtn, PfCard, PfField, PfInput, PfSelect, PfMoneyInput, PfBadge, PfNote, PfLoading, PfEmpty, PfProgress, PfTextBtn } from "@/components/pf-dc";

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };
const KIND_LABEL: Record<string, string> = { budget_cap: "Budget cap", income_goal: "Income goal", savings_target: "Savings target" };

export default function PfTargetsPage() {
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = usePfApi<PfTarget[]>("targets");
  const { data: categories } = usePfApi<PfCategory[]>("categories");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "budget_cap", categoryId: "", period: "month", periodStart: monthStart(), amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const dirty = !!form.amount || !!form.categoryId || !!form.note;
  const { confirmClose } = useUnsavedGuard(dirty);

  const relevantCats = useMemo(() => {
    const wantKind = form.kind === "income_goal" ? "income" : form.kind === "budget_cap" ? "expense" : null;
    if (!wantKind) return [];
    return (categories ?? []).filter((c) => c.kind === wantKind);
  }, [categories, form.kind]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend("targets", "POST", {
        kind: form.kind,
        categoryId: form.kind !== "savings_target" && form.categoryId ? form.categoryId : undefined,
        period: form.period,
        periodStart: form.periodStart,
        amount: Number(form.amount),
        note: form.note || undefined,
      });
      setForm({ ...form, amount: "", note: "", categoryId: "" });
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
    if (!(await confirm({ title: "Archive this target?", danger: true, confirmLabel: "Archive" }))) return;
    await pfApiSend(`targets/${id}/archive`, "POST");
    await mutate();
  }

  const th: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: PF.muted, padding: "9px 14px", borderBottom: `1px solid ${PF.border}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "9px 14px", borderBottom: `1px solid ${PF.hair}`, verticalAlign: "middle" };

  return (
    <PfShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Targets &amp; budgets</h1>
        <PfBtn onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Add target"}</PfBtn>
      </div>

      {open && (
        <PfCard style={{ marginBottom: 16 }}>
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <PfField label="Type" error={fieldErrs.kind}>
                <PfSelect value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, categoryId: "" })}>
                  <option value="budget_cap">Budget cap (expense)</option>
                  <option value="income_goal">Income goal</option>
                  <option value="savings_target">Savings target</option>
                </PfSelect>
              </PfField>
              <PfField label="Period" error={fieldErrs.period}>
                <PfSelect value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}><option value="month">Monthly</option><option value="year">Yearly</option></PfSelect>
              </PfField>
              {form.kind !== "savings_target" && (
                <PfField label="Category (optional)" error={fieldErrs.categoryId}>
                  <PfSelect value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                    <option value="">All categories</option>
                    {relevantCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </PfSelect>
                </PfField>
              )}
              <PfField label="Starts" error={fieldErrs.periodStart}><PfInput type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></PfField>
              <PfField label="Amount" error={fieldErrs.amount}><PfMoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></PfField>
            </div>
            <PfField label="Note" error={fieldErrs.note}><PfInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></PfField>
            {err && <PfNote tone="red">{err}</PfNote>}
            <div><PfBtn type="submit" disabled={busy || !form.amount}>{busy ? "Saving…" : "Save target"}</PfBtn></div>
          </form>
        </PfCard>
      )}

      {isLoading && <PfLoading />}
      {error && <PfNote tone="red">{error.message}</PfNote>}
      {data && data.length === 0 && <PfEmpty title="No targets yet" hint="Set a budget cap, an income goal, or a savings target." />}
      {data && data.length > 0 && (
        <div style={{ background: PF.card, border: `1px solid ${PF.border}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Type</th>
                <th style={{ ...th, textAlign: "center" }}>Period</th>
                <th style={{ ...th, textAlign: "right" }}>Amount</th>
                <th style={{ ...th, textAlign: "right" }}>Current</th>
                <th style={{ ...th, textAlign: "left" }}>Progress</th>
                <th style={{ ...th, width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => {
                const amount = Number(t.amount);
                const current = Number(t.current);
                const pct = amount > 0 ? Math.min(100, Math.round((current / amount) * 100)) : 0;
                const over = t.kind === "budget_cap" && current > amount;
                return (
                  <tr key={t.id}>
                    <td style={{ ...td, color: PF.text }}>{KIND_LABEL[t.kind]}</td>
                    <td style={{ ...td, textAlign: "center" }}><PfBadge tone="gray">{t.period === "year" ? "yearly" : "monthly"}</PfBadge></td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(t.amount, t.currency)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: PF.text }}>{pfMoney(t.current, t.currency)}</td>
                    <td style={td}>
                      <div style={{ minWidth: 120 }}>
                        <PfProgress pct={pct} over={over} />
                        <div style={{ marginTop: 4, fontSize: 10.5, color: over ? PF.red : PF.muted }}>{over ? "over!" : `${pct}%`}</div>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}><PfTextBtn danger ariaLabel="Archive target" onClick={() => archive(t.id)}>archive</PfTextBtn></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PfShell>
  );
}
