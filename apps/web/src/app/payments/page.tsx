"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { sanitizeAmount } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { can, type PartyRow, type Payment, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { Badge, Card, DGrid, Field, GoldButton, Loading, Note, Page, StatCards, T, cell, dcInput, fmtDay, money, type Stat } from "@/components/dc";

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

  // Summary is derived from the RLS-visible legs only (redacted amounts are absent).
  const rows = data ?? [];
  const sumIn = rows.filter((p) => p.direction === "in" && p.amount != null).reduce((s, p) => s + Number(p.amount), 0);
  const sumOut = rows.filter((p) => p.direction === "out" && p.amount != null).reduce((s, p) => s + Number(p.amount), 0);
  const inCount = rows.filter((p) => p.direction === "in").length;
  const outCount = rows.filter((p) => p.direction === "out").length;
  const stats: Stat[] = [
    { label: "Received (in)", value: money(sumIn), tone: "green", note: `${inCount} payment${inCount === 1 ? "" : "s"}` },
    { label: "Paid out", value: money(sumOut), tone: "gray", note: `${outCount} payment${outCount === 1 ? "" : "s"}` },
    { label: "Net", value: money(sumIn - sumOut), tone: sumIn - sumOut < 0 ? "red" : "green" },
  ];

  return (
    <AppShell>
      <Page
        title="Payments"
        sub="append-only money ledger — correct with a reversing entry, never an edit or delete"
        action={canCreate ? <GoldButton onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Record payment"}</GoldButton> : undefined}
      >
        {data && <StatCards items={stats} min={180} />}

        {open && canCreate && (
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <form onSubmit={record} style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <Field label="Direction" hint="in = money received · out = money paid out" error={fieldErrs.direction}>
                  <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} style={dcInput}>
                    <option value="in">in (received)</option>
                    <option value="out">out (paid)</option>
                  </select>
                </Field>
                <Field label="Amount" required error={fieldErrs.amount}>
                  <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: sanitizeAmount(e.target.value) })} placeholder="৳ amount" style={{ ...dcInput, textAlign: "right" }} />
                </Field>
              </div>
              <Field label="Counterparty" hint="The client (in) or writer (out) on the other side." error={fieldErrs.counterpartyPartyId}>
                <EntityPicker placeholder="Search party…" search={searchParties} onPick={(i) => setForm({ ...form, counterpartyPartyId: i?.id ?? null })} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <Field label="Paid on" error={fieldErrs.paidAt}>
                  <input type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} style={dcInput} />
                </Field>
                <Field label="Medium" error={fieldErrs.medium}>
                  <select value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} style={dcInput}>
                    {MEDIUMS.map((m) => (
                      <option key={m} value={m}>{m || "—"}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Transaction id" error={fieldErrs.trxId}>
                  <input value={form.trxId} onChange={(e) => setForm({ ...form, trxId: e.target.value })} style={dcInput} />
                </Field>
              </div>
              <Field label="Note" error={fieldErrs.note}>
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={dcInput} />
              </Field>
              {formError && <Note>{formError}</Note>}
              <div>
                <GoldButton type="submit" disabled={busy || !form.amount}>{busy ? "Saving…" : "Record payment"}</GoldButton>
              </div>
            </form>
          </Card>
        )}

        <Card style={{ padding: 16, marginBottom: 16 }}>
          <Field label="Filter by counterparty">
            <EntityPicker placeholder="Any party…" search={searchParties} onPick={(i) => setFilter(i?.id ?? null)} />
          </Field>
        </Card>

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <DGrid<Payment>
            rows={data}
            keyOf={(p) => p.id}
            search
            exportName="payments"
            cols={[
              {
                label: "Dir",
                text: (p) => (p.reversesPaymentId ? `${p.direction} rev` : p.direction),
                render: (p) => (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <Badge tone={p.direction === "in" ? "green" : "gray"}>{p.direction}</Badge>
                    {p.reversesPaymentId && <Badge tone="red">rev</Badge>}
                  </span>
                ),
              },
              { label: "Counterparty", text: (p) => p.counterpartyPartyId ?? "", render: (p) => (p.counterpartyPartyId ? <PartyName id={p.counterpartyPartyId} /> : <span style={{ color: T.muted2 }}>—</span>) },
              { label: "Amount", align: "right", text: (p) => (p.amount == null ? "" : Number(p.amount)), render: (p) => cell(money(p.amount), { nums: true, weight: 600, color: p.direction === "in" ? T.green : T.ink2 }) },
              { label: "Date", text: (p) => p.paidAt, render: (p) => <span style={{ color: T.muted2 }}>{fmtDay(p.paidAt)}</span> },
              { label: "Medium", text: (p) => p.medium ?? "", render: (p) => p.medium ?? "—" },
              { label: "Trx", text: (p) => p.trxId ?? "", render: (p) => (p.trxId ? cell(p.trxId, { mono: true }) : <span style={{ color: T.muted2 }}>—</span>) },
            ]}
            actions={[{ label: "open →", onClick: () => {}, href: (p) => `/payments/${p.id}` }]}
            empty="No payments. Record a client collection or a writer payout."
            foot={`${rows.length} payment${rows.length === 1 ? "" : "s"} · money is append-only — reverse to correct, never edit or delete.`}
          />
        )}
      </Page>
    </AppShell>
  );
}
