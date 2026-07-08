"use client";
import { useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type PartyRow, type Payment, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, Money, MoneyInput, Select, Spinner } from "@/components/ui";

const MEDIUMS = ["", "DBBL", "Bank", "bkash", "Nagad", "Sonali", "cash"];

const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};

export default function PaymentsPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const [filter, setFilter] = useState<string | null>(null);
  const path = `payments${filter ? `?counterpartyPartyId=${encodeURIComponent(filter)}` : ""}`;
  const { data, error, isLoading, mutate } = useApi<Payment[]>(path);

  const canCreate = can(me?.permissions, "billing:create");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    direction: "in",
    counterpartyPartyId: null as string | null,
    amount: "",
    paidAt: new Date().toISOString().slice(0, 10),
    medium: "",
    trxId: "",
    note: "",
  });

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter a valid amount");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await apiSend("payments", "POST", {
        direction: form.direction,
        counterpartyPartyId: form.counterpartyPartyId ?? undefined,
        amount,
        paidAt: form.paidAt,
        medium: form.medium || undefined,
        trxId: form.trxId || undefined,
        note: form.note || undefined,
      });
      setOpen(false);
      setForm({ ...form, amount: "", trxId: "", note: "", counterpartyPartyId: null });
      await mutate();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not record payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Payments</h1>
        {canCreate && <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Record payment"}</Button>}
      </div>

      {open && canCreate && (
        <Card className="mb-5">
          <form onSubmit={record} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Direction" hint="in = money received · out = money paid out">
                <Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                  <option value="in">in (received)</option>
                  <option value="out">out (paid)</option>
                </Select>
              </Field>
              <Field label="Amount">
                <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
              </Field>
            </div>
            <Field label="Counterparty" hint="The client (in) or writer (out) on the other side.">
              <EntityPicker placeholder="Search party…" search={searchParties} onPick={(i) => setForm({ ...form, counterpartyPartyId: i?.id ?? null })} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Paid on">
                <DateInput value={form.paidAt} onChange={(v) => setForm({ ...form, paidAt: v })} />
              </Field>
              <Field label="Medium">
                <Select value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })}>
                  {MEDIUMS.map((m) => (
                    <option key={m} value={m}>
                      {m || "—"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Transaction id">
                <Input value={form.trxId} onChange={(e) => setForm({ ...form, trxId: e.target.value })} />
              </Field>
            </div>
            <Field label="Note">
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            {formError && <ErrorNote message={formError} />}
            <Button type="submit" disabled={busy || !form.amount}>
              {busy ? "Saving…" : "Record payment"}
            </Button>
          </form>
        </Card>
      )}

      <Card className="mb-5">
        <Field label="Filter by counterparty">
          <EntityPicker placeholder="Any party…" search={searchParties} onPick={(i) => setFilter(i?.id ?? null)} />
        </Field>
      </Card>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No payments" hint="Record a client collection or a writer payout." />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {data.map((p) => {
            const reversal = !!p.reversesPaymentId;
            return (
              <li key={p.id}>
                <Link href={`/payments/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="text-sm">
                    <span className="inline-flex items-center gap-2">
                      <Badge tone={p.direction === "in" ? "green" : "blue"}>{p.direction}</Badge>
                      {p.counterpartyPartyId ? <PartyName id={p.counterpartyPartyId} /> : <span className="text-gray-400">no counterparty</span>}
                      {reversal && <Badge tone="red">reversal</Badge>}
                    </span>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {formatDate(p.paidAt)}
                      {p.medium ? ` · ${p.medium}` : ""}
                      {p.trxId ? ` · ${p.trxId}` : ""}
                    </div>
                  </div>
                  <span className="text-sm font-medium">
                    <Money value={p.amount} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
