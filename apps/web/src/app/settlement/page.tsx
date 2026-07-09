"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import {
  can,
  type PartyRow,
  type SettlementResult,
  type SettlementTransfer,
  type WhoAmI,
  type WorkListRow,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Money, Select, Spinner } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);
const searchPartners = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=partner`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.externalRef ?? undefined }));
};
const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};

export default function SettlementPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canCreate = can(me?.permissions, "billing:create");
  const canApprove = can(me?.permissions, "billing:approve");

  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const pairReady = !!a && !!b;
  const { data: pos, error, isLoading, mutate } = useApi<SettlementResult>(
    pairReady ? `settlement?partnerA=${a}&partnerB=${b}` : null,
  );
  const { data: transfers, mutate: mutateTransfers } = useApi<SettlementTransfer[]>(
    pairReady ? `settlement/transfers?partyId=${a}` : null,
  );

  const refresh = () => {
    void mutate();
    void mutateTransfers();
  };

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Settlement</h1>
      <p className="mb-4 text-xs text-gray-500">Shared partner figures only — never a partner&rsquo;s private legs (§4.4).</p>

      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Partner A"><EntityPicker placeholder="Pick a partner…" search={searchPartners} onPick={(i) => setA(i?.id ?? null)} /></Field>
          <Field label="Partner B"><EntityPicker placeholder="Pick a partner…" search={searchPartners} onPick={(i) => setB(i?.id ?? null)} /></Field>
        </div>
      </Card>

      {!pairReady && <EmptyState title="Pick both partners" hint="Choose the two partners to see their shared position." />}
      {pairReady && isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}

      {pos && (
        <Card className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Position</p>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><div className="text-xs text-gray-500">shared jobs</div><div className="font-medium">{pos.jobCount}</div></div>
            <div><div className="text-xs text-gray-500">total pool</div><div className="font-medium"><Money value={pos.totalPool} /></div></div>
            <div><div className="text-xs text-gray-500">transfers net</div><div className="font-medium"><Money value={pos.transfersNet} /></div></div>
            <div><div className="text-xs text-gray-500">accrual <PartyName id={pos.partnerA} /></div><div className="font-medium"><Money value={pos.accrual.partyA} /></div></div>
            <div><div className="text-xs text-gray-500">accrual <PartyName id={pos.partnerB} /></div><div className="font-medium"><Money value={pos.accrual.partyB} /></div></div>
          </div>
          <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            {pos.net.amount === 0 || !pos.net.owedBy ? (
              <Badge tone="green">settled</Badge>
            ) : (
              <span>
                <PartyName id={pos.net.owedBy} /> owes <PartyName id={pos.net.owedTo} />{" "}
                <span className="font-semibold"><Money value={pos.net.amount} /></span>
              </span>
            )}
          </div>
        </Card>
      )}

      {pairReady && (
        <>
          {canCreate && <RecordTransfer key={`${a}:${b}`} a={a!} b={b!} onDone={refresh} />}
          {canCreate && <PlatformFee onDone={refresh} />}

          <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Transfers</h2>
          {transfers && (
            <DataTable<SettlementTransfer>
              tableId="settlement-transfers"
              exportName="transfers"
              rows={transfers}
              getRowId={(t) => t.id}
              emptyTitle="No transfers yet"
              columns={[
                {
                  key: "from",
                  header: "From",
                  render: (t) => <PartyName id={t.fromPartyId} />,
                  value: (t) => t.fromPartyId ?? "",
                },
                {
                  key: "to",
                  header: "To",
                  render: (t) => <PartyName id={t.toPartyId} />,
                  value: (t) => t.toPartyId ?? "",
                },
                { key: "amount", header: "Amount", align: "right", sortable: true, format: "money", total: true, value: (t) => (t.amount == null ? "" : Number(t.amount)) },
                { key: "transferredAt", header: "Date", sortable: true, format: "date", value: (t) => t.transferredAt },
                { key: "medium", header: "Medium", filter: "text", value: (t) => t.medium ?? "" },
                { key: "createdByName", header: "By", value: (t) => t.createdByName ?? "" },
                {
                  key: "reversal",
                  header: "",
                  align: "center",
                  render: (t) =>
                    t.reversesTransferId ? (
                      <Badge tone="red">reversal</Badge>
                    ) : canApprove && Number(t.amount) > 0 ? (
                      <ReverseTransfer id={t.id} onDone={refresh} />
                    ) : null,
                  value: (t) => (t.reversesTransferId ? "reversal" : ""),
                },
              ]}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

function RecordTransfer({ a, b, onDone }: { a: string; b: string; onDone: () => void }) {
  const [form, setForm] = useState({ from: a, amount: "", transferredAt: today(), medium: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const to = form.from === a ? b : a;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("settlement/transfers", "POST", {
        fromPartyId: form.from,
        toPartyId: to,
        amount: Number(form.amount),
        transferredAt: form.transferredAt,
        medium: form.medium || undefined,
        note: form.note || undefined,
      });
      setForm({ ...form, amount: "", medium: "", note: "" });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not record transfer");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-4">
      <p className="mb-2 text-sm font-semibold text-gray-700">Record a transfer</p>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="From">
          <Select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
            <option value={a}>Partner A</option>
            <option value={b}>Partner B</option>
          </Select>
        </Field>
        <Field label="Amount (৳)"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
        <Field label="Date"><DateInput value={form.transferredAt} onChange={(v) => setForm({ ...form, transferredAt: v })} /></Field>
        <Field label="Medium"><Input value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} placeholder="bkash / cash …" /></Field>
        <div className="sm:col-span-2">
          <Field label="Note"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
        {err && <div className="sm:col-span-2"><ErrorNote message={err} /></div>}
        <div className="sm:col-span-2"><Button type="submit" variant="secondary" disabled={busy || !form.amount}>{busy ? "Saving…" : "Record transfer"}</Button></div>
      </form>
    </Card>
  );
}

function ReverseTransfer({ id, onDone }: { id: string; onDone: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  async function run() {
    const reason = await confirm({
      title: "Reverse this transfer?",
      danger: true,
      confirmLabel: "Reverse",
      reasonField: { label: "Reason (optional)", placeholder: "why…" },
    });
    if (reason === false) return;
    setBusy(true);
    try {
      await apiSend("settlement/transfers/reverse", "POST", { originalId: id, reason });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="text-xs text-red-600 hover:underline disabled:opacity-50" disabled={busy} onClick={run}>
      reverse
    </button>
  );
}

function PlatformFee({ onDone }: { onDone: () => void }) {
  const { data: jobs } = useApi<WorkListRow[]>("work");
  const [party, setParty] = useState<string | null>(null);
  const [workItemId, setWorkItemId] = useState("");
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!party || !workItemId) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await apiSend<{ amount: number }>("settlement/platform-fee", "POST", { partyId: party, workItemId });
      setMsg(`Applied platform fee.`);
      setParty(null);
      setWorkItemId("");
      setResetSeq((n) => n + 1);
      void r;
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not apply platform fee");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-4">
      <p className="mb-2 text-sm font-semibold text-gray-700">Apply platform fee</p>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Party"><EntityPicker key={`p${resetSeq}`} placeholder="Party charged…" search={searchParties} onPick={(i) => setParty(i?.id ?? null)} /></Field>
        <Field label="Job">
          <Select value={workItemId} onChange={(e) => setWorkItemId(e.target.value)}>
            <option value="">{jobs && jobs.length === 0 ? "No jobs yet" : "Select job…"}</option>
            {(jobs ?? []).map((j) => (<option key={j.id} value={j.id}>{j.title}</option>))}
          </Select>
        </Field>
        {err && <div className="sm:col-span-2"><ErrorNote message={err} /></div>}
        {msg && <p className="sm:col-span-2 text-xs text-green-700">{msg}</p>}
        <div className="sm:col-span-2"><Button type="submit" variant="secondary" disabled={busy || !party || !workItemId}>{busy ? "Applying…" : "Apply fee"}</Button></div>
      </form>
    </Card>
  );
}
