"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { sanitizeAmount } from "@/lib/format";
import {
  can,
  type PartyRow,
  type SettlementResult,
  type SettlementTransfer,
  type WhoAmI,
  type WorkListRow,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { useConfirm } from "@/components/confirm";
import { Money } from "@/components/ui";
import { Badge, Card, CardHead, DGrid, EmptyBox, Field, GhostButton, Loading, Note, Page, StatCards, T, cell, dcInput, fmtDay, type Stat } from "@/components/dc";

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

  // KPI tiles — money stays gated: <Money> renders NOTHING for an absent/redacted value.
  const posStats: Stat[] = pos
    ? [
        { label: "Shared jobs", value: pos.jobCount },
        { label: "Total pool", value: <Money value={pos.totalPool} /> },
        { label: "Transfers net", value: <Money value={pos.transfersNet} /> },
      ]
    : [];

  return (
    <AppShell>
      <Page title="Settlement" sub="Shared partner figures only — never a partner&rsquo;s private legs (§4.4).">
        <Card style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="Partner A"><EntityPicker placeholder="Pick a partner…" search={searchPartners} onPick={(i) => setA(i?.id ?? null)} /></Field>
            <Field label="Partner B"><EntityPicker placeholder="Pick a partner…" search={searchPartners} onPick={(i) => setB(i?.id ?? null)} /></Field>
          </div>
        </Card>

        {!pairReady && <EmptyBox title="Pick both partners" hint="Choose the two partners to see their shared position." />}
        {pairReady && isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}

        {pos && (
          <>
            <StatCards items={posStats} min={180} />
            <Card style={{ marginBottom: 20 }}>
              <CardHead>Position</CardHead>
              <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: T.muted }}>accrual <PartyName id={pos.partnerA} /></div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 3 }}><Money value={pos.accrual.partyA} /></div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: T.muted }}>accrual <PartyName id={pos.partnerB} /></div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 3 }}><Money value={pos.accrual.partyB} /></div>
                </div>
              </div>
              <div style={{ padding: "0 16px 16px" }}>
                {pos.net.amount === 0 || !pos.net.owedBy ? (
                  <Badge tone="green">settled</Badge>
                ) : (
                  <div style={{ background: T.hair, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.ink }}>
                    <PartyName id={pos.net.owedBy} /> owes <PartyName id={pos.net.owedTo} />{" "}
                    <span style={{ fontWeight: 700 }}><Money value={pos.net.amount} /></span>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}

        {pairReady && (
          <>
            {canCreate && <RecordTransfer key={`${a}:${b}`} a={a!} b={b!} onDone={refresh} />}
            {canCreate && <PlatformFee onDone={refresh} />}

            <h2 style={{ fontSize: 13, fontWeight: 700, color: T.ink, margin: "24px 0 8px" }}>Transfers</h2>
            {transfers && (
              <DGrid<SettlementTransfer>
                rows={transfers}
                keyOf={(t) => t.id}
                empty="No transfers yet"
                cols={[
                  { label: "From", render: (t) => <PartyName id={t.fromPartyId} /> },
                  { label: "To", render: (t) => <PartyName id={t.toPartyId} /> },
                  { label: "Amount", align: "right", render: (t) => cell(<Money value={t.amount} />, { weight: 600 }) },
                  { label: "Date", render: (t) => <span style={{ color: T.muted2 }}>{fmtDay(t.transferredAt)}</span> },
                  { label: "Medium", render: (t) => t.medium ?? "—" },
                  { label: "By", render: (t) => t.createdByName ?? "—" },
                  {
                    label: "",
                    align: "center",
                    render: (t) =>
                      t.reversesTransferId ? (
                        <Badge tone="red">reversal</Badge>
                      ) : canApprove && Number(t.amount) > 0 ? (
                        <ReverseTransfer id={t.id} onDone={refresh} />
                      ) : null,
                  },
                ]}
              />
            )}
          </>
        )}
      </Page>
    </AppShell>
  );
}

function RecordTransfer({ a, b, onDone }: { a: string; b: string; onDone: () => void }) {
  const [form, setForm] = useState({ from: a, amount: "", transferredAt: today(), medium: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const to = form.from === a ? b : a;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not record transfer") ?? "");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Record a transfer</div>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Field label="From" error={fieldErrs.fromPartyId}>
            <select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} style={dcInput}>
              <option value={a}>Partner A</option>
              <option value={b}>Partner B</option>
            </select>
          </Field>
          <Field label="Amount (৳)" error={fieldErrs.amount}>
            <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: sanitizeAmount(e.target.value) })} placeholder="৳ amount" style={{ ...dcInput, textAlign: "right" }} />
          </Field>
          <Field label="Date" error={fieldErrs.transferredAt}>
            <input type="date" value={form.transferredAt} onChange={(e) => setForm({ ...form, transferredAt: e.target.value })} style={dcInput} />
          </Field>
          <Field label="Medium" error={fieldErrs.medium}>
            <input value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} placeholder="bkash / cash …" style={dcInput} />
          </Field>
        </div>
        <Field label="Note" error={fieldErrs.note}>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={dcInput} />
        </Field>
        {err && <Note>{err}</Note>}
        <div>
          <GhostButton type="submit" disabled={busy || !form.amount}>{busy ? "Saving…" : "Record transfer"}</GhostButton>
        </div>
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
    <span onClick={busy ? undefined : run} title="Reverse this transfer" style={{ fontSize: 11, fontWeight: 600, color: T.red, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1 }}>
      reverse
    </span>
  );
}

function PlatformFee({ onDone }: { onDone: () => void }) {
  const { data: jobs } = useApi<WorkListRow[]>("work");
  const [party, setParty] = useState<string | null>(null);
  const [workItemId, setWorkItemId] = useState("");
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!party || !workItemId) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not apply platform fee") ?? "");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Apply platform fee</div>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <Field label="Party" error={fieldErrs.partyId}><EntityPicker key={`p${resetSeq}`} placeholder="Party charged…" search={searchParties} onPick={(i) => setParty(i?.id ?? null)} /></Field>
          <Field label="Job" error={fieldErrs.workItemId}>
            <select value={workItemId} onChange={(e) => setWorkItemId(e.target.value)} style={dcInput}>
              <option value="">{jobs && jobs.length === 0 ? "No jobs yet" : "Select job…"}</option>
              {(jobs ?? []).map((j) => (<option key={j.id} value={j.id}>{j.title}</option>))}
            </select>
          </Field>
        </div>
        {err && <Note>{err}</Note>}
        <div aria-live="polite">{msg && <p style={{ fontSize: 11.5, color: T.green, fontWeight: 600, margin: 0 }}>{msg}</p>}</div>
        <div>
          <GhostButton type="submit" disabled={busy || !party || !workItemId}>{busy ? "Applying…" : "Apply fee"}</GhostButton>
        </div>
      </form>
    </Card>
  );
}
