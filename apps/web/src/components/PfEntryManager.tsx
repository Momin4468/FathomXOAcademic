"use client";
import { useMemo, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { pfMoney, PF_CURRENCIES, type PfCategory, type PfEntry } from "@/lib/pf-types";
import { DataTable } from "@/components/DataTable";
import { Badge, Button, Card, DateInput, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

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
      {entries && (
        <DataTable<PfEntry>
          tableId={`pf-${kind}`}
          exportName={kind}
          rows={entries}
          getRowId={(x) => x.id}
          emptyTitle={`No ${kind} yet`}
          columns={[
            {
              key: "category",
              header: "Category",
              sortable: true,
              filter: "text",
              render: (x) => (
                <span>
                  {x.categoryId ? catName.get(x.categoryId) ?? "—" : "Uncategorised"}
                  {x.source === "business_payout" && <span className="ml-2"><Badge tone="blue">business payout</Badge></span>}
                </span>
              ),
              value: (x) => (x.categoryId ? catName.get(x.categoryId) ?? "" : "Uncategorised"),
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              sortable: true,
              total: true,
              // Per-row currency: render with pfMoney; numeric value drives sort/total.
              render: (x) => <span className={`tabular-nums ${tone}`}>{pfMoney(x.amount, x.currency)}</span>,
              value: (x) => (x.amount == null ? "" : Number(x.amount)),
            },
            { key: "occurredOn", header: "Date", sortable: true, format: "date", value: (x) => x.occurredOn },
            { key: "note", header: "Note", filter: "text", value: (x) => x.note ?? "" },
            {
              key: "flags",
              header: "",
              align: "center",
              render: (x) => (x.reversesId ? <Badge tone="red">reversal</Badge> : reversedIds.has(x.id) ? <Badge tone="gray">reversed</Badge> : null),
              value: (x) => (x.reversesId ? "reversal" : reversedIds.has(x.id) ? "reversed" : ""),
            },
            {
              key: "action",
              header: "",
              align: "right",
              render: (x) =>
                !x.reversesId && !reversedIds.has(x.id) && x.source !== "business_payout" ? (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      reverse(x.id);
                    }}
                  >
                    delete
                  </button>
                ) : null,
            },
          ]}
        />
      )}
    </>
  );
}
