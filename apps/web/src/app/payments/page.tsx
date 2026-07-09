"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { can, type PartyRow, type Payment, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { Badge, Button, Card, DateInput, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

const MEDIUMS = ["", "DBBL", "Bank", "bkash", "Nagad", "Sonali", "cash"];

const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};

export default function PaymentsPage() {
  const router = useRouter();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const [filter, setFilter] = useState<string | null>(null);
  const path = `payments${filter ? `?counterpartyPartyId=${encodeURIComponent(filter)}` : ""}`;
  const { data, error, isLoading, mutate } = useApi<Payment[]>(path);

  const canCreate = can(me?.permissions, "billing:create");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    direction: "in",
    counterpartyPartyId: null as string | null,
    amount: "",
    paidAt: new Date().toISOString().slice(0, 10),
    medium: "",
    trxId: "",
    note: "",
  });

  const dirty = !!form.amount || !!form.counterpartyPartyId || !!form.trxId || !!form.note;
  const { confirmClose } = useUnsavedGuard(dirty);

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("");
      setFieldErrs({ amount: "Enter a valid amount" });
      return;
    }
    setBusy(true);
    setFormError("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(err));
      setFormError(bannerMessage(err, "Could not record payment") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Payments</h1>
        {canCreate && <Button onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Record payment"}</Button>}
      </div>

      {open && canCreate && (
        <Card className="mb-5">
          <form onSubmit={record} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Direction" hint="in = money received · out = money paid out" error={fieldErrs.direction}>
                <Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                  <option value="in">in (received)</option>
                  <option value="out">out (paid)</option>
                </Select>
              </Field>
              <Field label="Amount" required error={fieldErrs.amount}>
                <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
              </Field>
            </div>
            <Field label="Counterparty" hint="The client (in) or writer (out) on the other side." error={fieldErrs.counterpartyPartyId}>
              <EntityPicker placeholder="Search party…" search={searchParties} onPick={(i) => setForm({ ...form, counterpartyPartyId: i?.id ?? null })} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Paid on" error={fieldErrs.paidAt}>
                <DateInput value={form.paidAt} onChange={(v) => setForm({ ...form, paidAt: v })} />
              </Field>
              <Field label="Medium" error={fieldErrs.medium}>
                <Select value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })}>
                  {MEDIUMS.map((m) => (
                    <option key={m} value={m}>
                      {m || "—"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Transaction id" error={fieldErrs.trxId}>
                <Input value={form.trxId} onChange={(e) => setForm({ ...form, trxId: e.target.value })} />
              </Field>
            </div>
            <Field label="Note" error={fieldErrs.note}>
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
      {data && (
        <DataTable<Payment>
          tableId="payments"
          exportName="payments"
          rows={data}
          getRowId={(p) => p.id}
          onRowClick={(p) => router.push(`/payments/${p.id}`)}
          emptyTitle="No payments"
          emptyHint="Record a client collection or a writer payout."
          columns={[
            {
              key: "direction",
              header: "Dir",
              align: "center",
              sortable: true,
              filter: "select",
              filterOptions: ["in", "out"],
              render: (p) => (
                <span className="inline-flex items-center gap-1">
                  <Badge tone={p.direction === "in" ? "green" : "blue"}>{p.direction}</Badge>
                  {p.reversesPaymentId && <Badge tone="red">rev</Badge>}
                </span>
              ),
              value: (p) => p.direction,
            },
            {
              key: "counterparty",
              header: "Counterparty",
              render: (p) => (p.counterpartyPartyId ? <PartyName id={p.counterpartyPartyId} /> : <span className="text-gray-400">—</span>),
              value: (p) => p.counterpartyPartyId ?? "",
            },
            { key: "amount", header: "Amount", align: "right", sortable: true, format: "money", total: true, value: (p) => (p.amount == null ? "" : Number(p.amount)) },
            { key: "paidAt", header: "Date", sortable: true, format: "date", value: (p) => p.paidAt },
            { key: "medium", header: "Medium", filter: "text", value: (p) => p.medium ?? "" },
            { key: "trxId", header: "Trx", value: (p) => p.trxId ?? "" },
          ]}
        />
      )}
    </AppShell>
  );
}
