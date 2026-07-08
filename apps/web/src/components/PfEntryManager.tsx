"use client";
import { useMemo, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { pfMoney, PF_CURRENCIES, type PfCategory, type PfEntry } from "@/lib/pf-types";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

/** Shared income/expense manager (§11): list + capture-first add + reverse. */
export function PfEntryManager({ kind }: { kind: "income" | "expense" }) {
  const { data: categories } = usePfApi<PfCategory[]>(`categories?kind=${kind}`);
  const { data: entries, error, isLoading, mutate } = usePfApi<PfEntry[]>(kind);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ categoryId: "", amount: "", currency: "BDT", convertedAmount: "", convertedCurrency: "BDT", occurredOn: today(), note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
      setErr(e2 instanceof Error ? e2.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function reverse(id: string) {
    if (!window.confirm("Reverse this entry? (append-only — a correcting entry is recorded)")) return;
    await pfApiSend(`${kind}/${id}/reverse`, "POST");
    await mutate();
  }

  const tone = kind === "income" ? "text-emerald-700" : "text-rose-700";

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold capitalize tracking-tight">{kind}</h1>
        <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : `+ Add ${kind}`}</Button>
      </div>

      {open && (
        <Card className="mb-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Category">
                <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">{categories && categories.length === 0 ? "No categories yet" : "Uncategorised"}</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Date">
                <DateInput value={form.occurredOn} onChange={(v) => setForm({ ...form, occurredOn: v })} />
              </Field>
              <Field label="Amount">
                <MoneyInput currency={form.currency} value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
              </Field>
              <Field label="Currency">
                <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {PF_CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </Select>
              </Field>
            </div>
            {form.currency !== "BDT" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Converted amount (optional)" hint="No automatic conversion — record it if you want.">
                  <MoneyInput currency={form.convertedCurrency} value={form.convertedAmount} onChange={(v) => setForm({ ...form, convertedAmount: v })} />
                </Field>
                <Field label="Converted currency">
                  <Select value={form.convertedCurrency} onChange={(e) => setForm({ ...form, convertedCurrency: e.target.value })}>
                    {PF_CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </Select>
                </Field>
              </div>
            )}
            <Field label="Note">
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            {err && <ErrorNote message={err} />}
            <Button type="submit" disabled={busy || !form.amount}>{busy ? "Saving…" : `Save ${kind}`}</Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {entries && entries.length === 0 && <EmptyState title={`No ${kind} yet`} />}
      {entries && entries.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {entries.map((x) => {
            const isReversal = !!x.reversesId;
            const isReversed = reversedIds.has(x.id);
            return (
              <li key={x.id} className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${isReversed || isReversal ? "opacity-50" : ""}`}>
                <div>
                  <span className="font-medium">{x.categoryId ? catName.get(x.categoryId) ?? "—" : "Uncategorised"}</span>
                  {isReversal && <span className="ml-2"><Badge tone="red">reversal</Badge></span>}
                  {x.source === "business_payout" && <span className="ml-2"><Badge tone="blue">business payout</Badge></span>}
                  <div className="mt-0.5 text-xs text-gray-500">
                    {formatDate(x.occurredOn)}
                    {x.note ? ` · ${x.note}` : ""}
                    {x.convertedAmount ? ` · ≈ ${pfMoney(x.convertedAmount, x.convertedCurrency ?? "BDT")}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`tabular-nums ${tone}`}>{pfMoney(x.amount, x.currency)}</span>
                  {!isReversal && !isReversed && x.source !== "business_payout" && (
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => reverse(x.id)}>delete</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
