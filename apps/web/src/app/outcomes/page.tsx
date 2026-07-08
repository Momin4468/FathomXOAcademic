"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  can,
  type Outcome,
  type PartyRow,
  type WhoAmI,
  type WorkListRow,
  type WriterCard,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, MoneyInput, Money, Select, Spinner } from "@/components/ui";

const FAULTS = ["", "writer", "brief_change", "client"];
const SATISFACTION = ["", "high", "neutral", "low"];
const searchWriters = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=writer`);
  return rows.map((r) => ({ id: r.id, label: r.displayName }));
};

export default function OutcomesPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canRecord = can(me?.permissions, "outcomes:create");
  const canSeeAll = can(me?.permissions, "outcomes:edit") || can(me?.permissions, "outcomes:approve");

  const [writerFilter, setWriterFilter] = useState<string | null>(null);
  const { data: outcomes, error, isLoading, mutate } = useApi<Outcome[]>(
    `outcomes${writerFilter ? `?writerPartyId=${writerFilter}` : ""}`,
  );

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Outcomes</h1>
      <p className="mb-4 text-xs text-gray-500">{canSeeAll ? "All writers" : "Your own work"} · reputation is derived, never hand-edited.</p>

      {canSeeAll && (
        <ReputationCard defaultPartyId={me?.party?.id ?? null} />
      )}
      {!canSeeAll && me?.party?.id && <ReputationCard defaultPartyId={me.party.id} lockSelf />}

      {canRecord && <RecordOutcome onDone={mutate} />}

      {canSeeAll && (
        <Card className="mb-4">
          <Field label="Filter by writer (optional)">
            <EntityPicker placeholder="All writers…" search={searchWriters} onPick={(i) => setWriterFilter(i?.id ?? null)} />
          </Field>
        </Card>
      )}

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Recorded outcomes</h2>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {outcomes && outcomes.length === 0 && <EmptyState title="No outcomes yet" />}
      {outcomes && outcomes.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {outcomes.map((o) => (
            <li key={o.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{o.writerPartyId ? <PartyName id={o.writerPartyId} /> : "—"}</span>
                <span className="flex flex-wrap items-center gap-1">
                  {o.onTime === false && <Badge tone="amber">late{o.daysLate ? ` ${o.daysLate}d` : ""}</Badge>}
                  {o.onTime === true && <Badge tone="green">on-time</Badge>}
                  {o.failed && <Badge tone="red">failed</Badge>}
                  {o.complaint && <Badge tone="red">complaint</Badge>}
                  {o.revisionCount > 0 && <Badge tone="gray">{o.revisionCount} rev{o.revisionFault ? ` (${o.revisionFault})` : ""}</Badge>}
                  {o.satisfaction && <Badge tone={o.satisfaction === "high" ? "green" : o.satisfaction === "low" ? "red" : "gray"}>{o.satisfaction}</Badge>}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {formatDate(o.recordedAt)}{o.grade ? ` · grade ${o.grade}` : ""}{o.reworkCost ? <> · rework <Money value={o.reworkCost} /></> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function ReputationCard({ defaultPartyId, lockSelf }: { defaultPartyId: string | null; lockSelf?: boolean }) {
  const [partyId, setPartyId] = useState<string | null>(defaultPartyId);
  const { data: card } = useApi<WriterCard>(partyId ? `outcomes/writers/${partyId}` : null, { shouldRetryOnError: false });
  const rep = card?.reputation;
  return (
    <Card className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Reputation</p>
        {!lockSelf && (
          <div className="w-56"><EntityPicker placeholder="Pick a writer…" search={searchWriters} onPick={(i) => setPartyId(i?.id ?? defaultPartyId)} /></div>
        )}
      </div>
      {!card ? (
        <EmptyState title="Pick a writer" hint="Their derived reputation will show here." />
      ) : (
        <>
          <p className="text-sm font-medium">{card.profile.displayName} <Badge tone={card.load.atCapacity ? "red" : "green"}>{card.load.availability}</Badge></p>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="reliability" value={rep?.reliabilityScore == null ? "—" : `${rep.reliabilityScore}`} />
            <Stat label="jobs" value={`${rep?.jobCount ?? 0}`} />
            <Stat label="on-time" value={rep?.onTime.rate == null ? "—" : `${Math.round(rep.onTime.rate * 100)}%`} />
            <Stat label="fail rate" value={rep?.failRate == null ? "—" : `${Math.round(rep.failRate * 100)}%`} />
            <Stat label="complaints" value={`${rep?.complaint.count ?? 0}`} />
            <Stat label="open jobs" value={`${card.load.openJobs}`} />
          </div>
          {card.courseHistory.length > 0 && (
            <div className="mt-3 text-xs text-gray-500">
              Courses: {card.courseHistory.slice(0, 6).map((c) => `${c.courseName ?? c.courseRefId.slice(0, 6)} (${c.jobCount})`).join(" · ")}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div><div className="text-xs text-gray-500">{label}</div><div className="font-medium">{value}</div></div>
  );
}

function RecordOutcome({ onDone }: { onDone: () => void }) {
  const { data: jobs } = useApi<WorkListRow[]>("work");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    workItemId: "", onTime: "", daysLate: "", revisionCount: "", revisionFault: "",
    grade: "", complaint: false, failed: false, aiScore: "", satisfaction: "", reworkCost: "", markerFeedback: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.workItemId) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("outcomes", "POST", {
        workItemId: form.workItemId,
        onTime: form.onTime === "" ? undefined : form.onTime === "yes",
        daysLate: form.daysLate ? Number(form.daysLate) : undefined,
        revisionCount: form.revisionCount ? Number(form.revisionCount) : undefined,
        revisionFault: form.revisionFault || undefined,
        grade: form.grade || undefined,
        complaint: form.complaint,
        failed: form.failed,
        aiScore: form.aiScore ? Number(form.aiScore) : undefined,
        satisfaction: form.satisfaction || undefined,
        reworkCost: form.reworkCost ? Number(form.reworkCost) : undefined,
        markerFeedback: form.markerFeedback || undefined,
      });
      setOpen(false);
      setForm({ ...form, workItemId: "", grade: "", markerFeedback: "", reworkCost: "" });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not record outcome");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Record an outcome</p>
        <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Open"}</Button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <Field label="Job">
            <Select value={form.workItemId} onChange={(e) => setForm({ ...form, workItemId: e.target.value })}>
              <option value="">{jobs && jobs.length === 0 ? "No jobs yet" : "Select job…"}</option>
              {(jobs ?? []).map((j) => (<option key={j.id} value={j.id}>{j.title}</option>))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="On time?">
              <Select value={form.onTime} onChange={(e) => setForm({ ...form, onTime: e.target.value })}>
                <option value="">—</option><option value="yes">yes</option><option value="no">no</option>
              </Select>
            </Field>
            <Field label="Days late"><Input type="number" min="0" value={form.daysLate} onChange={(e) => setForm({ ...form, daysLate: e.target.value })} /></Field>
            <Field label="Revisions"><Input type="number" min="0" value={form.revisionCount} onChange={(e) => setForm({ ...form, revisionCount: e.target.value })} /></Field>
            <Field label="Revision fault">
              <Select value={form.revisionFault} onChange={(e) => setForm({ ...form, revisionFault: e.target.value })}>
                {FAULTS.map((f) => <option key={f} value={f}>{f || "—"}</option>)}
              </Select>
            </Field>
            <Field label="Grade"><Input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} /></Field>
            <Field label="AI score"><Input type="number" min="0" max="100" value={form.aiScore} onChange={(e) => setForm({ ...form, aiScore: e.target.value })} /></Field>
            <Field label="Satisfaction">
              <Select value={form.satisfaction} onChange={(e) => setForm({ ...form, satisfaction: e.target.value })}>
                {SATISFACTION.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
              </Select>
            </Field>
            <Field label="Rework cost (৳)"><MoneyInput value={form.reworkCost} onChange={(v) => setForm({ ...form, reworkCost: v })} /></Field>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.complaint} onChange={(e) => setForm({ ...form, complaint: e.target.checked })} /> complaint</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.failed} onChange={(e) => setForm({ ...form, failed: e.target.checked })} /> failed</label>
          </div>
          <Field label="Marker feedback"><Input value={form.markerFeedback} onChange={(e) => setForm({ ...form, markerFeedback: e.target.value })} /></Field>
          {err && <ErrorNote message={err} />}
          <Button type="submit" disabled={busy || !form.workItemId}>{busy ? "Saving…" : "Record outcome"}</Button>
        </form>
      )}
    </Card>
  );
}
