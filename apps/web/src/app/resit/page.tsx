"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import {
  can,
  type PartyRow,
  type WhoAmI,
  type WorkDetail,
  type WorkListRow,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Money,
  MoneyInput,
  Select,
  Spinner,
} from "@/components/ui";

const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};
const searchWriters = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=writer`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.externalRef ?? undefined }));
};

/**
 * Resit / fail handling (§3/§6/§8). An admin (work:approve) redoes a failed job
 * on the SAME job: reopen, the resit writer's line/leg, the original writer's
 * reduction (auto reversing-leg vs clawback), and an optional client re-bill to 0.
 * The job P&L (the truthful net loss) is shown via the money-gated job detail.
 */
export default function ResitPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canApprove = can(me?.permissions, "work:approve");
  const { data: jobs } = useApi<WorkListRow[]>("work");

  const [jobId, setJobId] = useState("");
  const { data: detail, mutate: refreshDetail } = useApi<WorkDetail>(jobId ? `work/${jobId}` : null);
  const pnl = detail?.pnl;

  const [origWriter, setOrigWriter] = useState<string | null>(null);
  const [origFrom, setOrigFrom] = useState<string | null>(null);
  const [reduction, setReduction] = useState("");
  const [hasResitWriter, setHasResitWriter] = useState(false);
  const [resitWriter, setResitWriter] = useState<string | null>(null);
  const [resitFrom, setResitFrom] = useState<string | null>(null);
  const [resitAmount, setResitAmount] = useState("");
  const [zeroClient, setZeroClient] = useState(false);
  const [clientFrom, setClientFrom] = useState<string | null>(null);
  const [clientTo, setClientTo] = useState<string | null>(null);
  const [clientAmount, setClientAmount] = useState("");
  const [reworkCost, setReworkCost] = useState("");
  const [note, setNote] = useState("");
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobId || !origWriter) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    setMsg("");
    try {
      const body: Record<string, unknown> = {
        originalWriterPartyId: origWriter,
        originalWriterFromPartyId: origFrom ?? undefined,
        originalWriterReduction: Number(reduction || 0),
        zeroClientBilling: zeroClient,
        reworkCost: reworkCost ? Number(reworkCost) : undefined,
        note: note || undefined,
      };
      if (hasResitWriter && resitWriter && resitFrom) {
        body.resitWriter = {
          partyId: resitWriter,
          fromPartyId: resitFrom,
          amount: Number(resitAmount || 0),
        };
      }
      if (zeroClient && clientFrom && clientTo) {
        body.clientReversal = { fromPartyId: clientFrom, toPartyId: clientTo, amount: Number(clientAmount || 0) };
      }
      await apiSend(`work/${jobId}/resit`, "POST", body);
      setMsg("Resit recorded.");
      setReduction("");
      setResitAmount("");
      setClientAmount("");
      setReworkCost("");
      setNote("");
      setOrigWriter(null);
      setOrigFrom(null);
      setResitWriter(null);
      setResitFrom(null);
      setClientFrom(null);
      setClientTo(null);
      setHasResitWriter(false);
      setZeroClient(false);
      setResetSeq((n) => n + 1);
      await refreshDetail();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not record resit") ?? "");
    } finally {
      setBusy(false);
    }
  }

  if (me && !canApprove) {
    return (
      <AppShell>
        <h1 className="mb-3 text-lg font-semibold tracking-tight">Resit</h1>
        <EmptyState title="No access" hint="Resit handling needs work:approve." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Resit a failed job</h1>

      <Card className="mb-5">
        <Field label="Job (must have a recorded fail)">
          <Select value={jobId} onChange={(e) => { setJobId(e.target.value); setResetSeq((n) => n + 1); }}>
            <option value="">Select job…</option>
            {(jobs ?? []).map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </Select>
        </Field>
        {jobId && pnl && (
          <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <span className="text-xs text-gray-500">job P&amp;L</span>{" "}
            revenue <Money value={pnl.revenue} /> · writer cost <Money value={pnl.writerCost} />
            {pnl.clawback ? <> · clawback <Money value={pnl.clawback} /></> : null}
            {pnl.reworkCost ? <> · rework <Money value={pnl.reworkCost} /></> : null}
            {" · "}net{" "}
            {pnl.isLoss ? <Badge tone="red">loss <Money value={pnl.net} /></Badge> : <span className="font-medium"><Money value={pnl.net} /></span>}
          </div>
        )}
      </Card>

      {jobId && (
        <form onSubmit={submit} className="space-y-5">
          <Card>
            <p className="mb-2 text-sm font-semibold text-gray-700">Original writer</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Writer" error={fieldErrs.originalWriterPartyId}><EntityPicker key={`ow${resetSeq}`} placeholder="Search writer…" search={searchWriters} onPick={(i) => setOrigWriter(i?.id ?? null)} /></Field>
              <Field label="Paid by (partner)" error={fieldErrs.originalWriterFromPartyId}><EntityPicker key={`of${resetSeq}`} placeholder="Search partner…" search={searchParties} onPick={(i) => setOrigFrom(i?.id ?? null)} /></Field>
              <Field label="Reduce pay by (৳)" hint="0 = unchanged; auto reversing-leg or clawback" error={fieldErrs.originalWriterReduction}><MoneyInput value={reduction} onChange={(v) => setReduction(v)} /></Field>
            </div>
          </Card>

          <Card>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input type="checkbox" checked={hasResitWriter} onChange={(e) => setHasResitWriter(e.target.checked)} /> Different writer does the resit
            </label>
            {hasResitWriter && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Resit writer"><EntityPicker key={`rw${resetSeq}`} placeholder="Search writer…" search={searchWriters} onPick={(i) => setResitWriter(i?.id ?? null)} /></Field>
                <Field label="Paid by (partner)"><EntityPicker key={`rf${resetSeq}`} placeholder="Search partner…" search={searchParties} onPick={(i) => setResitFrom(i?.id ?? null)} /></Field>
                <Field label="Resit pay (৳)"><MoneyInput value={resitAmount} onChange={(v) => setResitAmount(v)} /></Field>
              </div>
            )}
          </Card>

          <Card>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input type="checkbox" checked={zeroClient} onChange={(e) => setZeroClient(e.target.checked)} /> Re-bill the whole job to 0 (client)
            </label>
            {zeroClient && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Client"><EntityPicker key={`cf${resetSeq}`} placeholder="Search client…" search={searchParties} onPick={(i) => setClientFrom(i?.id ?? null)} /></Field>
                <Field label="Paid to (partner)"><EntityPicker key={`ct${resetSeq}`} placeholder="Search partner…" search={searchParties} onPick={(i) => setClientTo(i?.id ?? null)} /></Field>
                <Field label="Revenue to reverse (৳)"><MoneyInput value={clientAmount} onChange={(v) => setClientAmount(v)} /></Field>
              </div>
            )}
          </Card>

          <Card>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Rework cost (৳, optional)" error={fieldErrs.reworkCost}><MoneyInput value={reworkCost} onChange={(v) => setReworkCost(v)} /></Field>
              <Field label="Note" error={fieldErrs.note}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </div>
          </Card>

          {err && <ErrorNote message={err} />}
          {msg && <p className="text-xs text-green-700">{msg}</p>}
          <Button type="submit" disabled={busy || !origWriter}>{busy ? "Recording…" : "Record resit"}</Button>
        </form>
      )}

      {!jobId && <Spinner label="Pick a job to begin." />}
    </AppShell>
  );
}
