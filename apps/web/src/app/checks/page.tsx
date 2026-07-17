"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
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
  Badge, Card, CardHead, DGrid, EmptyBox, Field, GhostButton, GoldButton,
  Loading, Note, Page, StatCards, T, cell, dcInput, fmtDay, money,
  type DCol, type Stat,
} from "@/components/dc";

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
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
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
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not record batch") ?? "");
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

  // Admin: the unit P&L (derived; confirmed batches only) as a stat-card row.
  const pnlStats: Stat[] = pnl
    ? [
        { label: "Revenue", value: money(pnl.revenue), tone: "green" },
        { label: "Account cost", value: money(pnl.accountCost) },
        { label: "Worker pay", value: money(pnl.workerComp) },
        { label: "Net", value: money(pnl.net), tone: pnl.net < 0 ? "red" : "green" },
        { label: "Files checked", value: pnl.filesChecked },
        { label: "Files paid", value: pnl.filesPaid },
        { label: "Margin / check", value: pnl.marginPerCheck == null ? "—" : money(pnl.marginPerCheck) },
      ]
    : [];

  // The board: recent batches.
  const cols: DCol<CheckBatchRow>[] = [
    { label: "Channel", text: (b) => b.channelLabel, render: (b) => cell(b.channelLabel, { sub: b.customerPartyId ? <PartyName id={b.customerPartyId} /> : undefined }) },
    { label: "Date", text: (b) => b.periodDate, render: (b) => cell(fmtDay(b.periodDate), { color: T.muted2 }) },
    { label: "Checked", align: "right", text: (b) => b.filesChecked, render: (b) => b.filesChecked },
    { label: "Paid", align: "right", text: (b) => b.filesPaid, render: (b) => b.filesPaid },
    { label: "Collected", align: "right", text: (b) => Number(b.amountCollected), render: (b) => money(b.amountCollected) },
    { label: "State", align: "center", text: (b) => b.status, render: (b) => <Badge tone={b.status === "confirmed" ? "green" : b.status === "proposed" ? "amber" : "gray"}>{b.status}</Badge> },
    {
      label: "", align: "right", render: (b) =>
        canApprove && b.status === "proposed" ? (
          <span onClick={() => confirm(b.id)} style={{ fontSize: 11, fontWeight: 700, color: T.goldDeep, cursor: confirmingId === b.id ? "default" : "pointer" }}>
            {confirmingId === b.id ? "Confirming…" : "Confirm"}
          </span>
        ) : null,
    },
  ];

  return (
    <AppShell>
      <Page title="Checks" sub="record a batch → an admin confirms it; the unit P&L is derived from confirmed batches only">
        {canApprove && pnl && <StatCards items={pnlStats} min={150} />}

        {/* Capture: record today's tally (a claim → admin confirms). */}
        <Card style={{ marginBottom: 16 }}>
          <CardHead>Record a batch</CardHead>
          <div style={{ padding: 14 }}>
            {channelsLoading ? (
              <Loading />
            ) : channelsError ? (
              <Note>{channelsError.message}</Note>
            ) : channels && channels.length === 0 ? (
              <EmptyBox title="No channel yet" hint="Register a WhatsApp account/channel below first." />
            ) : (
              <form onSubmit={record} style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  <Field label="Channel (WhatsApp account)" error={fieldErrs.channelId}>
                    <select value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })} required style={dcInput}>
                      <option value="">Select channel…</option>
                      {(channels ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tool account" error={fieldErrs.toolAccountId}>
                    <select value={form.toolAccountId} onChange={(e) => setForm({ ...form, toolAccountId: e.target.value })} style={dcInput}>
                      <option value="">(none)</option>
                      {(accounts ?? []).map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                  <Field label="Date" error={fieldErrs.periodDate}>
                    <input type="date" value={form.periodDate} onChange={(e) => setForm({ ...form, periodDate: e.target.value })} style={dcInput} />
                  </Field>
                  <Field label="Files checked" error={fieldErrs.filesChecked}>
                    <input type="number" min="0" value={form.filesChecked} onChange={(e) => setForm({ ...form, filesChecked: e.target.value })} style={dcInput} />
                  </Field>
                  <Field label="Files paid" error={fieldErrs.filesPaid}>
                    <input type="number" min="0" value={form.filesPaid} onChange={(e) => setForm({ ...form, filesPaid: e.target.value })} style={dcInput} />
                  </Field>
                  <Field label="Collected (৳)" error={fieldErrs.amountCollected}>
                    <input inputMode="decimal" value={form.amountCollected} onChange={(e) => setForm({ ...form, amountCollected: e.target.value })} style={{ ...dcInput, textAlign: "right" }} />
                  </Field>
                </div>
                <Field label="Customer (optional — stand-alone if blank)" error={fieldErrs.customerPartyId}>
                  <EntityPicker key={resetSeq} placeholder="Search customer…" search={searchParties} onPick={(i) => setForm({ ...form, customerPartyId: i?.id ?? null })} />
                </Field>
                <Field label="Note" error={fieldErrs.note}>
                  <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={dcInput} />
                </Field>
                {err && <Note>{err}</Note>}
                <div>
                  <GoldButton type="submit" disabled={busy || !form.channelId}>{busy ? "Saving…" : "Record batch"}</GoldButton>
                </div>
              </form>
            )}
          </div>
        </Card>

        {/* The board: recent batches. */}
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, margin: "18px 0 8px" }}>Recent batches</div>
        {boardErr && <div style={{ marginBottom: 8 }}><Note>{boardErr}</Note></div>}
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {batches && <DGrid cols={cols} rows={batches} keyOf={(b) => b.id} empty="No batches yet." minWidth={620} search exportName="checks" />}

        {/* Admin setup: channels, tool accounts + credits, top-ups. */}
        {canApprove && (
          <AdminSetup
            channels={channels ?? []}
            accounts={accounts ?? []}
            onChannels={mutateChannels}
            onAccounts={mutateAccounts}
          />
        )}
      </Page>
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
    <section style={{ marginTop: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 12 }}>Accounts &amp; credits (admin)</div>
      {err && <div style={{ marginBottom: 12 }}><Note>{err}</Note></div>}

      {/* Tool accounts + derived credit balances */}
      <Card style={{ marginBottom: 14 }}>
        <CardHead>Tool accounts</CardHead>
        <div style={{ padding: 14 }}>
          {accounts.length === 0 ? (
            <EmptyBox title="No tool accounts" />
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {accounts.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 12.5 }}>
                  <span style={{ fontWeight: 600 }}>{a.label}</span>
                  {a.credit && (
                    <span style={{ fontSize: 11, color: T.muted2 }}>
                      {a.credit.remaining} credits left · {a.credit.consumed} used · {money(a.credit.costPerCredit)}/credit
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addAccount} style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input placeholder="New tool account (e.g. AcademyCX #2)" value={accLabel} onChange={(e) => setAccLabel(e.target.value)} style={dcInput} />
            <GhostButton type="submit" disabled={!accLabel.trim()}>Add</GhostButton>
          </form>
        </div>
      </Card>

      {/* Record a credit top-up (the cost basis) */}
      <Card style={{ marginBottom: 14 }}>
        <CardHead>Record a credit top-up</CardHead>
        <div style={{ padding: 14 }}>
          <form onSubmit={addTopup} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" }}>
            <select value={topup.toolAccountId} onChange={(e) => setTopup({ ...topup, toolAccountId: e.target.value })} style={dcInput}>
              <option value="">Account…</option>
              {accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
            </select>
            <input type="number" min="0" placeholder="Credits" value={topup.credits} onChange={(e) => setTopup({ ...topup, credits: e.target.value })} style={dcInput} />
            <input inputMode="decimal" placeholder="Cost (৳)" value={topup.cost} onChange={(e) => setTopup({ ...topup, cost: e.target.value })} style={{ ...dcInput, textAlign: "right" }} />
            <GhostButton type="submit" disabled={!topup.toolAccountId || !topup.credits}>Add top-up</GhostButton>
          </form>
        </div>
      </Card>

      {/* Channels */}
      <Card style={{ marginBottom: 14 }}>
        <CardHead>Channels ({channels.length})</CardHead>
        <div style={{ padding: 14 }}>
          <form onSubmit={addChannel} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, alignItems: "end" }}>
            <input placeholder="Channel label (WhatsApp acct)" value={chLabel} onChange={(e) => setChLabel(e.target.value)} style={dcInput} />
            <EntityPicker placeholder="Employee…" search={searchParties} onPick={(i) => setChEmployee(i?.id ?? null)} />
            <GhostButton type="submit" disabled={!chLabel.trim()}>Add channel</GhostButton>
          </form>
        </div>
      </Card>
    </section>
  );
}
