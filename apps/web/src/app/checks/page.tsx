"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  can,
  type CheckBatchRow,
  type CheckChannel,
  type CheckPnl,
  type CheckToolAccount,
  type PartyRow,
  type WhoAmI,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import {
  Badge,
  Button,
  Card,
  DateInput,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Money,
  Select,
  Spinner,
  StateBadge,
} from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);
const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};

export default function ChecksPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canApprove = can(me?.permissions, "checks:approve");

  const { data: channels, error: channelsError, isLoading: channelsLoading, mutate: mutateChannels } = useApi<CheckChannel[]>("checks/channels");
  const { data: accounts, mutate: mutateAccounts } = useApi<CheckToolAccount[]>("checks/tool-accounts");
  const { data: batches, error, isLoading, mutate } = useApi<CheckBatchRow[]>("checks/batches");
  const { data: pnl } = useApi<CheckPnl>(canApprove ? "checks/pnl" : null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [boardErr, setBoardErr] = useState("");
  const [resetSeq, setResetSeq] = useState(0); // force-remount the customer picker on submit
  const [form, setForm] = useState({
    channelId: "",
    toolAccountId: "",
    periodDate: today(),
    filesChecked: "",
    filesPaid: "",
    amountCollected: "",
    customerPartyId: null as string | null,
    note: "",
  });

  async function record(e: React.FormEvent) {
    e.preventDefault();
    if (!form.channelId) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("checks/batches", "POST", {
        channelId: form.channelId,
        toolAccountId: form.toolAccountId || undefined,
        periodDate: form.periodDate,
        filesChecked: Number(form.filesChecked || 0),
        filesPaid: Number(form.filesPaid || 0),
        amountCollected: Number(form.amountCollected || 0),
        customerPartyId: form.customerPartyId ?? undefined,
        note: form.note || undefined,
      });
      setForm({ ...form, filesChecked: "", filesPaid: "", amountCollected: "", note: "", customerPartyId: null });
      setResetSeq((n) => n + 1); // clear the customer picker so it can't carry over
      await mutate();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not record batch");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id: string) {
    setConfirmingId(id);
    setBoardErr("");
    try {
      await apiSend(`checks/batches/${id}/confirm`, "POST");
      await mutate();
    } catch (e2) {
      setBoardErr(e2 instanceof Error ? e2.message : "Could not confirm");
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Checks</h1>

      {/* Admin: the unit P&L (derived; confirmed batches only). */}
      {canApprove && pnl && (
        <Card className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Unit P&amp;L (confirmed)</p>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-gray-500">revenue</div><div className="font-medium"><Money value={pnl.revenue} /></div></div>
            <div><div className="text-xs text-gray-500">account cost</div><div className="font-medium"><Money value={pnl.accountCost} /></div></div>
            <div><div className="text-xs text-gray-500">worker pay</div><div className="font-medium"><Money value={pnl.workerComp} /></div></div>
            <div><div className="text-xs text-gray-500">net</div><div className="font-semibold"><Money value={pnl.net} /></div></div>
            <div><div className="text-xs text-gray-500">files checked</div><div className="font-medium">{pnl.filesChecked}</div></div>
            <div><div className="text-xs text-gray-500">files paid</div><div className="font-medium">{pnl.filesPaid}</div></div>
            <div><div className="text-xs text-gray-500">margin per check</div><div className="font-medium">{pnl.marginPerCheck == null ? "—" : <Money value={pnl.marginPerCheck} />}</div></div>
          </div>
        </Card>
      )}

      {/* Capture: record today's tally (a claim → admin confirms). */}
      <Card className="mb-5">
        <p className="mb-2 text-sm font-semibold text-gray-700">Record a batch</p>
        {channelsLoading ? (
          <Spinner />
        ) : channelsError ? (
          <ErrorNote message={channelsError.message} />
        ) : channels && channels.length === 0 ? (
          <EmptyState title="No channel yet" hint="Register a WhatsApp account/channel below first." />
        ) : (
          <form onSubmit={record} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Channel (WhatsApp account)">
                <Select value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })} required>
                  <option value="">Select channel…</option>
                  {(channels ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tool account">
                <Select value={form.toolAccountId} onChange={(e) => setForm({ ...form, toolAccountId: e.target.value })}>
                  <option value="">(none)</option>
                  {(accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Date"><DateInput value={form.periodDate} onChange={(v) => setForm({ ...form, periodDate: v })} /></Field>
              <Field label="Files checked"><Input type="number" min="0" value={form.filesChecked} onChange={(e) => setForm({ ...form, filesChecked: e.target.value })} /></Field>
              <Field label="Files paid"><Input type="number" min="0" value={form.filesPaid} onChange={(e) => setForm({ ...form, filesPaid: e.target.value })} /></Field>
              <Field label="Collected (৳)"><Input type="number" min="0" step="0.01" value={form.amountCollected} onChange={(e) => setForm({ ...form, amountCollected: e.target.value })} /></Field>
            </div>
            <Field label="Customer (optional — stand-alone if blank)">
              <EntityPicker key={resetSeq} placeholder="Search customer…" search={searchParties} onPick={(i) => setForm({ ...form, customerPartyId: i?.id ?? null })} />
            </Field>
            <Field label="Note"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            {err && <ErrorNote message={err} />}
            <Button type="submit" disabled={busy || !form.channelId}>{busy ? "Saving…" : "Record batch"}</Button>
          </form>
        )}
      </Card>

      {/* The board: recent batches. */}
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Recent batches</h2>
      {boardErr && <ErrorNote message={boardErr} />}
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {batches && batches.length === 0 && <EmptyState title="No batches yet" />}
      {batches && batches.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {batches.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="text-sm">
                <span className="font-medium">{b.channelLabel}</span>
                {b.customerPartyId && (
                  <span className="ml-2 text-xs text-gray-500">· <PartyName id={b.customerPartyId} /></span>
                )}
                <div className="mt-0.5 text-xs text-gray-500">
                  {formatDate(b.periodDate)} · checked {b.filesChecked} · paid {b.filesPaid} · <Money value={b.amountCollected} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StateBadge state={b.status} />
                {canApprove && b.status === "proposed" && (
                  <Button variant="secondary" className="px-2 text-xs" disabled={confirmingId === b.id} onClick={() => confirm(b.id)}>
                    {confirmingId === b.id ? "Confirming…" : "Confirm"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Admin setup: channels, tool accounts + credits, top-ups. */}
      {canApprove && (
        <AdminSetup
          channels={channels ?? []}
          accounts={accounts ?? []}
          onChannels={mutateChannels}
          onAccounts={mutateAccounts}
        />
      )}
    </AppShell>
  );
}

function AdminSetup({
  channels,
  accounts,
  onChannels,
  onAccounts,
}: {
  channels: CheckChannel[];
  accounts: CheckToolAccount[];
  onChannels: () => void;
  onAccounts: () => void;
}) {
  const [chLabel, setChLabel] = useState("");
  const [chEmployee, setChEmployee] = useState<string | null>(null);
  const [accLabel, setAccLabel] = useState("");
  const [topup, setTopup] = useState({ toolAccountId: "", credits: "", cost: "", purchasedAt: today() });
  const [err, setErr] = useState("");

  async function addChannel(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await apiSend("checks/channels", "POST", { label: chLabel, employeePartyId: chEmployee ?? undefined });
      setChLabel("");
      setChEmployee(null);
      onChannels();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add channel");
    }
  }
  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await apiSend("checks/tool-accounts", "POST", { label: accLabel });
      setAccLabel("");
      onAccounts();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add account");
    }
  }
  async function addTopup(e: React.FormEvent) {
    e.preventDefault();
    if (!topup.toolAccountId) return;
    setErr("");
    try {
      await apiSend(`checks/tool-accounts/${topup.toolAccountId}/topups`, "POST", {
        credits: Number(topup.credits || 0),
        cost: Number(topup.cost || 0),
        purchasedAt: topup.purchasedAt,
      });
      setTopup({ toolAccountId: "", credits: "", cost: "", purchasedAt: today() });
      onAccounts();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not record top-up");
    }
  }

  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Accounts &amp; credits (admin)</h2>
      {err && <ErrorNote message={err} />}

      {/* Tool accounts + derived credit balances */}
      <Card>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Tool accounts</p>
        {accounts.length === 0 ? (
          <EmptyState title="No tool accounts" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium">{a.label}</span>
                {a.credit && (
                  <span className="text-xs text-gray-500">
                    {a.credit.remaining} credits left · {a.credit.consumed} used · <Money value={a.credit.costPerCredit} />/credit
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addAccount} className="mt-3 flex gap-2">
          <Input placeholder="New tool account (e.g. AcademyCX #2)" value={accLabel} onChange={(e) => setAccLabel(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={!accLabel.trim()}>Add</Button>
        </form>
      </Card>

      {/* Record a credit top-up (the cost basis) */}
      <Card>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Record a credit top-up</p>
        <form onSubmit={addTopup} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Select value={topup.toolAccountId} onChange={(e) => setTopup({ ...topup, toolAccountId: e.target.value })}>
            <option value="">Account…</option>
            {accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
          </Select>
          <Input type="number" min="0" placeholder="Credits" value={topup.credits} onChange={(e) => setTopup({ ...topup, credits: e.target.value })} />
          <Input type="number" min="0" step="0.01" placeholder="Cost (৳)" value={topup.cost} onChange={(e) => setTopup({ ...topup, cost: e.target.value })} />
          <Button type="submit" variant="secondary" disabled={!topup.toolAccountId || !topup.credits}>Add top-up</Button>
        </form>
      </Card>

      {/* Channels */}
      <Card>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Channels ({channels.length})</p>
        <form onSubmit={addChannel} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input placeholder="Channel label (WhatsApp acct)" value={chLabel} onChange={(e) => setChLabel(e.target.value)} />
          <EntityPicker placeholder="Employee…" search={searchParties} onPick={(i) => setChEmployee(i?.id ?? null)} />
          <Button type="submit" variant="secondary" disabled={!chLabel.trim()}>Add channel</Button>
        </form>
      </Card>
    </section>
  );
}
