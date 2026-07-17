"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
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
import {
  Badge, Card, DGrid, EmptyBox, Field, GhostButton, GoldButton,
  Loading, Note, Page, StatCards, T, cell, dcInput, fmtDay, money,
  type DCol, type Stat,
} from "@/components/dc";

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

  const cols: DCol<Outcome>[] = [
    { label: "Writer", render: (o) => cell(o.writerPartyId ? <PartyName id={o.writerPartyId} /> : "—", { weight: 600 }) },
    {
      label: "Result", render: (o) => (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {o.onTime === false && <Badge tone="amber">late{o.daysLate ? ` ${o.daysLate}d` : ""}</Badge>}
          {o.onTime === true && <Badge tone="green">on-time</Badge>}
          {o.failed && <Badge tone="red">failed</Badge>}
          {o.complaint && <Badge tone="red">complaint</Badge>}
          {o.revisionCount > 0 && <Badge tone="gray">{o.revisionCount} rev{o.revisionFault ? ` (${o.revisionFault})` : ""}</Badge>}
          {o.satisfaction && <Badge tone={o.satisfaction === "high" ? "green" : o.satisfaction === "low" ? "red" : "gray"}>{o.satisfaction}</Badge>}
        </span>
      ),
    },
    { label: "Grade", render: (o) => o.grade ?? "—" },
    { label: "Rework", align: "right", render: (o) => money(o.reworkCost) },
    { label: "Recorded", render: (o) => cell(fmtDay(o.recordedAt), { color: T.muted2 }) },
  ];

  return (
    <AppShell>
      <Page title="Outcomes" sub={`${canSeeAll ? "all writers" : "your own work"} · reputation is derived, never hand-edited`}>
        {canSeeAll && <ReputationCard defaultPartyId={me?.party?.id ?? null} />}
        {!canSeeAll && me?.party?.id && <ReputationCard defaultPartyId={me.party.id} lockSelf />}

        {canRecord && <RecordOutcome onDone={mutate} />}

        {canSeeAll && (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ padding: 14 }}>
              <Field label="Filter by writer (optional)">
                <EntityPicker placeholder="All writers…" search={searchWriters} onPick={(i) => setWriterFilter(i?.id ?? null)} />
              </Field>
            </div>
          </Card>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, margin: "18px 0 8px" }}>Recorded outcomes</div>
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {outcomes && (outcomes.length === 0 ? (
          <EmptyBox title="No outcomes yet" />
        ) : (
          <DGrid cols={cols} rows={outcomes} keyOf={(o) => o.id} minWidth={620} />
        ))}
      </Page>
    </AppShell>
  );
}

function ReputationCard({ defaultPartyId, lockSelf }: { defaultPartyId: string | null; lockSelf?: boolean }) {
  const [partyId, setPartyId] = useState<string | null>(defaultPartyId);
  const { data: card } = useApi<WriterCard>(partyId ? `outcomes/writers/${partyId}` : null, { shouldRetryOnError: false });
  const rep = card?.reputation;
  const stats: Stat[] = rep
    ? [
        { label: "Reliability", value: rep.reliabilityScore == null ? "—" : `${rep.reliabilityScore}` },
        { label: "Jobs", value: `${rep.jobCount ?? 0}` },
        { label: "On-time", value: rep.onTime.rate == null ? "—" : `${Math.round(rep.onTime.rate * 100)}%`, tone: "green" },
        { label: "Fail rate", value: rep.failRate == null ? "—" : `${Math.round(rep.failRate * 100)}%`, tone: (rep.failRate ?? 0) > 0 ? "red" : "gray" },
        { label: "Complaints", value: `${rep.complaint.count ?? 0}` },
        { label: "Open jobs", value: `${card?.load.openJobs ?? 0}` },
      ]
    : [];
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${T.eyebrow}` }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Reputation</span>
        {!lockSelf && (
          <div style={{ width: 240 }}>
            <EntityPicker placeholder="Pick a writer…" search={searchWriters} onPick={(i) => setPartyId(i?.id ?? defaultPartyId)} />
          </div>
        )}
      </div>
      <div style={{ padding: 14 }}>
        {!card ? (
          <EmptyBox title="Pick a writer" hint="Their derived reputation will show here." />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
              {card.profile.displayName}
              <Badge tone={card.load.atCapacity ? "red" : "green"}>{card.load.availability}</Badge>
            </div>
            <StatCards items={stats} min={150} />
            {card.courseHistory.length > 0 && (
              <div style={{ fontSize: 11, color: T.muted2 }}>
                Courses: {card.courseHistory.slice(0, 6).map((c) => `${c.courseName ?? c.courseRefId.slice(0, 6)} (${c.jobCount})`).join(" · ")}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
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
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.workItemId) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not record outcome") ?? "");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: open ? `1px solid ${T.eyebrow}` : undefined }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Record an outcome</span>
        <GhostButton onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Open"}</GhostButton>
      </div>
      {open && (
        <form onSubmit={submit} style={{ padding: 14, display: "grid", gap: 12 }}>
          <Field label="Job" error={fieldErrs.workItemId}>
            <select value={form.workItemId} onChange={(e) => setForm({ ...form, workItemId: e.target.value })} style={dcInput}>
              <option value="">{jobs && jobs.length === 0 ? "No jobs yet" : "Select job…"}</option>
              {(jobs ?? []).map((j) => (<option key={j.id} value={j.id}>{j.title}</option>))}
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Field label="On time?" error={fieldErrs.onTime}>
              <select value={form.onTime} onChange={(e) => setForm({ ...form, onTime: e.target.value })} style={dcInput}>
                <option value="">—</option><option value="yes">yes</option><option value="no">no</option>
              </select>
            </Field>
            <Field label="Days late" error={fieldErrs.daysLate}><input type="number" min="0" value={form.daysLate} onChange={(e) => setForm({ ...form, daysLate: e.target.value })} style={dcInput} /></Field>
            <Field label="Revisions" error={fieldErrs.revisionCount}><input type="number" min="0" value={form.revisionCount} onChange={(e) => setForm({ ...form, revisionCount: e.target.value })} style={dcInput} /></Field>
            <Field label="Revision fault" error={fieldErrs.revisionFault}>
              <select value={form.revisionFault} onChange={(e) => setForm({ ...form, revisionFault: e.target.value })} style={dcInput}>
                {FAULTS.map((f) => <option key={f} value={f}>{f || "—"}</option>)}
              </select>
            </Field>
            <Field label="Grade" error={fieldErrs.grade}><input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} style={dcInput} /></Field>
            <Field label="AI score" error={fieldErrs.aiScore}><input type="number" min="0" max="100" value={form.aiScore} onChange={(e) => setForm({ ...form, aiScore: e.target.value })} style={dcInput} /></Field>
            <Field label="Satisfaction" error={fieldErrs.satisfaction}>
              <select value={form.satisfaction} onChange={(e) => setForm({ ...form, satisfaction: e.target.value })} style={dcInput}>
                {SATISFACTION.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
              </select>
            </Field>
            <Field label="Rework cost (৳)" error={fieldErrs.reworkCost}><input inputMode="decimal" value={form.reworkCost} onChange={(e) => setForm({ ...form, reworkCost: e.target.value })} style={{ ...dcInput, textAlign: "right" }} /></Field>
          </div>
          <div style={{ display: "flex", gap: 18, fontSize: 12.5, color: T.ink2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.complaint} onChange={(e) => setForm({ ...form, complaint: e.target.checked })} /> complaint</label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.failed} onChange={(e) => setForm({ ...form, failed: e.target.checked })} /> failed</label>
          </div>
          <Field label="Marker feedback" error={fieldErrs.markerFeedback}><input value={form.markerFeedback} onChange={(e) => setForm({ ...form, markerFeedback: e.target.value })} style={dcInput} /></Field>
          {err && <Note>{err}</Note>}
          <div><GoldButton type="submit" disabled={busy || !form.workItemId}>{busy ? "Saving…" : "Record outcome"}</GoldButton></div>
        </form>
      )}
    </Card>
  );
}
