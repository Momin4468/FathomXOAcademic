"use client";
import { useMemo, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfCategory, type PfEntry } from "@/lib/pf-types";
import { useConfirm } from "@/components/confirm";
import {
  PF, PfBtn, PfCard, PfField, PfInput, PfSelect, PfMoneyInput, PfBadge, PfNote, PfLoading, PfEmpty, PfTextBtn,
} from "@/components/pf-dc";

const today = () => new Date().toISOString().slice(0, 10);

/** Shared income/expense manager (§11): list + capture-first add + reverse. */
export function PfEntryManager({ kind }: { kind: "income" | "expense" }) {
  const confirm = useConfirm();
  const { data: categories } = usePfApi<PfCategory[]>(`categories?kind=${kind}`);
  const { data: entries, error, isLoading, mutate } = usePfApi<PfEntry[]>(kind);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ categoryId: "", amount: "", currency: "BDT", convertedAmount: "", convertedCurrency: "BDT", occurredOn: today(), note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const dirty = !!form.amount || !!form.note || !!form.categoryId;
  const { confirmClose } = useUnsavedGuard(dirty);

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    (categories ?? []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const reversedIds = useMemo(() => new Set((entries ?? []).filter((e) => e.reversesId).map((e) => e.reversesId)), [entries]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend(kind, "POST", {
        categoryId: form.categoryId || undefined,
        amount: Number(form.amount),
        currency: form.currency,
        convertedAmount: form.currency !== "BDT" && form.convertedAmount ? Number(form.convertedAmount) : undefined,
        convertedCurrency: form.currency !== "BDT" && form.convertedAmount ? form.convertedCurrency : undefined,
        occurredOn: form.occurredOn,
        note: form.note || undefined,
      });
      setForm({ ...form, amount: "", convertedAmount: "", note: "" });
      setOpen(false);
      await mutate();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not save") ?? "");
    } finally {
      setBusy(false);
    }
  }

  async function reverse(id: string) {
    if (!(await confirm({ title: "Reverse this entry?", body: "Append-only — a correcting entry is recorded.", danger: true, confirmLabel: "Reverse" }))) return;
    await pfApiSend(`${kind}/${id}/reverse`, "POST");
    await mutate();
  }

  const amtColor = kind === "income" ? PF.green : PF.red;
  const th: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: PF.muted, padding: "9px 14px", borderBottom: `1px solid ${PF.border}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "9px 14px", borderBottom: `1px solid ${PF.hair}`, verticalAlign: "top" };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad, textTransform: "capitalize" }}>{kind}</h1>
        <PfBtn onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : `+ Add ${kind}`}</PfBtn>
      </div>

      {open && (
        <PfCard style={{ marginBottom: 16 }}>
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <PfField label="Category" error={fieldErrs.categoryId}>
                <PfSelect value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">{categories && categories.length === 0 ? "No categories yet" : "Uncategorised"}</option>
                  {(categories ?? []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </PfSelect>
              </PfField>
              <PfField label="Date" error={fieldErrs.occurredOn}>
                <PfInput type="date" value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} />
              </PfField>
              <PfField label="Amount" required error={fieldErrs.amount}>
                <PfMoneyInput currency={form.currency} value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
              </PfField>
              <PfField label="Currency" error={fieldErrs.currency}>
                <PfSelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {PF_CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </PfSelect>
              </PfField>
            </div>
            {form.currency !== "BDT" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <PfField label="Converted amount (optional)" hint="No automatic conversion — record it if you want." error={fieldErrs.convertedAmount}>
                  <PfMoneyInput currency={form.convertedCurrency} value={form.convertedAmount} onChange={(v) => setForm({ ...form, convertedAmount: v })} />
                </PfField>
                <PfField label="Converted currency" error={fieldErrs.convertedCurrency}>
                  <PfSelect value={form.convertedCurrency} onChange={(e) => setForm({ ...form, convertedCurrency: e.target.value })}>
                    {PF_CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </PfSelect>
                </PfField>
              </div>
            )}
            <PfField label="Note" error={fieldErrs.note}>
              <PfInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </PfField>
            {err && <PfNote tone="red">{err}</PfNote>}
            <div><PfBtn type="submit" disabled={busy || !form.amount}>{busy ? "Saving…" : `Save ${kind}`}</PfBtn></div>
          </form>
        </PfCard>
      )}

      {isLoading && <PfLoading />}
      {error && <PfNote tone="red">{error.message}</PfNote>}
      {entries && entries.length === 0 && <PfEmpty title={`No ${kind} yet`} />}
      {entries && entries.length > 0 && (
        <div style={{ background: PF.card, border: `1px solid ${PF.border}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Detail</th>
                <th style={{ ...th, textAlign: "left" }}>Date</th>
                <th style={{ ...th, textAlign: "right" }}>Amount (BDT)</th>
                <th style={{ ...th, width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {entries.map((x) => {
                const reversal = !!x.reversesId;
                const wasReversed = reversedIds.has(x.id);
                const isPayout = x.source === "business_payout";
                return (
                  <tr key={x.id} style={{ opacity: reversal ? 0.55 : 1 }}>
                    <td style={td}>
                      <span style={{ fontWeight: 500, color: PF.text }}>{x.categoryId ? catName.get(x.categoryId) ?? "—" : "Uncategorised"}</span>
                      {isPayout && <span style={{ marginLeft: 8 }}><PfBadge tone="blue">business payout</PfBadge></span>}
                      {x.note && <span style={{ display: "block", fontSize: 10.5, color: PF.faint }}>{x.note}</span>}
                    </td>
                    <td style={{ ...td, color: PF.muted, whiteSpace: "nowrap" }}>{formatDate(x.occurredOn)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: amtColor }}>{pfMoney(x.amount, x.currency)}</td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {reversal ? <PfBadge tone="red">reversal</PfBadge> : wasReversed ? <PfBadge tone="gray">reversed</PfBadge> : !isPayout ? <PfTextBtn danger ariaLabel="Reverse entry" onClick={() => reverse(x.id)}>delete</PfTextBtn> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
