"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import type { PartyRow, RefEntity, WorkItem } from "@/lib/types";
import { EntityPicker, type PickItem } from "./EntityPicker";
import { Button, Card, Collapsible, ErrorNote, Field, Input, MoneyInput, Select, Textarea } from "./ui";

// Stable search/create fns (module scope) so the picker effect deps don't churn.
const searchRef = (kind: string) => async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<RefEntity[]>(`reference?kind=${kind}&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.canonical, sub: r.status }));
};
const createRef = (kind: string) => async (raw: string): Promise<PickItem> => {
  const res = await apiSend<{ entity: RefEntity }>("reference/resolve", "POST", { kind, raw });
  return { id: res.entity.id, label: res.entity.canonical };
};
const searchParty = (type: string) => async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=${type}`);
  return rows.map((p) => ({ id: p.id, label: p.displayName, sub: p.externalRef ?? undefined }));
};

/**
 * The job create/edit form (Phase 4C). Every §3.1 field is present and editable —
 * common fields shown by default, the rest grouped into expandable sections so the
 * form isn't one long wall. `clientPartyId` (paying student) is distinct from
 * `sourcePartyId` (referral/source that drives profit-share). Capture-first: only
 * the title is required; everything else can be completed later.
 */
export function JobForm({ initial }: { initial?: WorkItem }) {
  const router = useRouter();
  const editing = !!initial;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [courseRefId, setCourseRefId] = useState<string | null>(initial?.courseRefId ?? null);
  const [assignmentTypeRefId, setAssignmentTypeRefId] = useState<string | null>(initial?.assignmentTypeRefId ?? null);
  const [universityRefId, setUniversityRefId] = useState<string | null>(initial?.universityRefId ?? null);
  const [sourcePartyId, setSourcePartyId] = useState<string | null>(initial?.sourcePartyId ?? null);
  const [clientPartyId, setClientPartyId] = useState<string | null>(initial?.clientPartyId ?? null);
  const [doerPartyId, setDoerPartyId] = useState<string | null>(initial?.doerPartyId ?? null);
  const [moduleName, setModuleName] = useState(initial?.moduleName ?? "");
  const [wordCount, setWordCount] = useState(initial?.wordCount ? String(initial.wordCount) : "");
  const [groupKind, setGroupKind] = useState(initial?.groupKind ?? "individual");
  const [groupScope, setGroupScope] = useState(initial?.groupScope ?? "full");
  const [groupNote, setGroupNote] = useState(initial?.groupNote ?? "");
  const [deliveryDate, setDeliveryDate] = useState(initial?.deliveryDate ?? "");
  const [submissionDate, setSubmissionDate] = useState(initial?.submissionDate ?? "");
  const [writerFee, setWriterFee] = useState(""); // create-only: seeds the writer's line
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const dirty = !editing && (!!title || !!courseRefId || !!clientPartyId || !!doerPartyId || !!details);
  const { confirmClose } = useUnsavedGuard(dirty);

  function fields() {
    return {
      title: title.trim(),
      details: details.trim() || undefined,
      notes: notes.trim() || undefined,
      courseRefId: courseRefId ?? undefined,
      assignmentTypeRefId: assignmentTypeRefId ?? undefined,
      universityRefId: universityRefId ?? undefined,
      sourcePartyId: sourcePartyId ?? undefined,
      clientPartyId: clientPartyId ?? undefined,
      doerPartyId: doerPartyId ?? undefined,
      moduleName: moduleName.trim() || undefined,
      wordCount: wordCount ? Number(wordCount) : undefined,
      groupKind,
      groupScope: groupKind === "group" ? groupScope : undefined,
      groupNote: groupKind === "group" ? groupNote.trim() || undefined : undefined,
      deliveryDate: deliveryDate || undefined,
      submissionDate: submissionDate || undefined,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    setFieldErrs({});
    try {
      if (editing) {
        await apiSend<WorkItem>(`work/${initial!.id}`, "PATCH", fields());
        router.replace(`/work/${initial!.id}`);
      } else {
        const item = await apiSend<WorkItem>("work", "POST", fields());
        // Optional writer fee at intake → seed the writer's producer line.
        const fee = Number(writerFee);
        if (doerPartyId && fee > 0) {
          await apiSend(`work/${item.id}/lines`, "POST", { lineKind: "part", writerPartyId: doerPartyId, fixedAmount: fee });
        }
        router.replace(`/work/${item.id}`);
      }
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setError(bannerMessage(err, editing ? "Could not save changes" : "Could not create job") ?? "");
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        {/* Essentials — always visible */}
        <Field label="Title" required hint="Required. Everything else can wait." error={fieldErrs.title}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ICT701 A3" required />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Course / module" error={fieldErrs.courseRefId}>
            <EntityPicker placeholder="Search course…" search={searchRef("course")} onCreate={createRef("course")} onPick={(i) => setCourseRefId(i?.id ?? null)} />
          </Field>
          <Field label="Assignment type" error={fieldErrs.assignmentTypeRefId}>
            <EntityPicker placeholder="A1, CW1…" search={searchRef("assignment_type")} onCreate={createRef("assignment_type")} onPick={(i) => setAssignmentTypeRefId(i?.id ?? null)} />
          </Field>
          <Field label="Client (paying student)" hint="Who pays — distinct from the referral/source." error={fieldErrs.clientPartyId}>
            <EntityPicker placeholder="Search client…" search={searchParty("client")} onPick={(i) => setClientPartyId(i?.id ?? null)} />
          </Field>
          <Field label="Writer (doer)" error={fieldErrs.doerPartyId}>
            <EntityPicker placeholder="Search writer…" search={searchParty("writer")} onPick={(i) => setDoerPartyId(i?.id ?? null)} />
          </Field>
        </div>
        {editing && (
          <p className="text-xs text-slate-500">
            Linked pickers show current values only after you search &amp; re-pick; leaving one untouched keeps what&rsquo;s set.
          </p>
        )}

        {/* Source & referral */}
        <Collapsible title="Source &amp; referral" hint="drives profit-share">
          <Field label="Referral / source" hint="Who introduced/sourced this job (drives profit-share). Leave blank for a direct job.">
            <EntityPicker placeholder="Search referrer / partner / channel…" search={searchParty("referrer")} onPick={(i) => setSourcePartyId(i?.id ?? null)} />
          </Field>
        </Collapsible>

        {/* Academic details */}
        <Collapsible title="Academic details">
          <Field label="University">
            <EntityPicker placeholder="Search university…" search={searchRef("university")} onCreate={createRef("university")} onPick={(i) => setUniversityRefId(i?.id ?? null)} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Module name" hint="e.g. Information & Communication Technology">
              <Input value={moduleName} onChange={(e) => setModuleName(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Word count / size">
              <Input inputMode="numeric" value={wordCount} onChange={(e) => setWordCount(e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 2000" />
            </Field>
          </div>
        </Collapsible>

        {/* Dates */}
        <Collapsible title="Dates">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Delivery date">
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </Field>
            <Field label="Submission date">
              <Input type="date" value={submissionDate} onChange={(e) => setSubmissionDate(e.target.value)} />
            </Field>
          </div>
        </Collapsible>

        {/* Group vs individual */}
        <Collapsible title="Group vs individual">
          <Field label="Kind">
            <Select value={groupKind} onChange={(e) => setGroupKind(e.target.value)}>
              <option value="individual">Individual</option>
              <option value="group">Group</option>
            </Select>
          </Field>
          {groupKind === "group" && (
            <>
              <Field label="Scope" hint="Full group, or only part of it?">
                <Select value={groupScope} onChange={(e) => setGroupScope(e.target.value)}>
                  <option value="full">Full group</option>
                  <option value="partial">Partial group</option>
                </Select>
              </Field>
              <Field label="Group note" hint="e.g. which members, shared deliverable paid by one">
                <Input value={groupNote} onChange={(e) => setGroupNote(e.target.value)} placeholder="Optional" />
              </Field>
            </>
          )}
        </Collapsible>

        {/* Pricing — create only (edit fees live on the lines / reprice) */}
        {!editing && (
          <Collapsible title="Writer fee (optional)" hint="seeds the writer's line">
            <Field label="Writer fee" hint="Optional — records the doer's fee now (pricing can also lag delivery).">
              <MoneyInput value={writerFee} onChange={setWriterFee} />
            </Field>
          </Collapsible>
        )}

        {/* Notes */}
        <Collapsible title="Notes">
          <Field label="Detail" hint="Word count, deadline, instructions — free text.">
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. 2000 words, due Fri, APA" />
          </Field>
          <Field label="Internal notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </Collapsible>

        {error && <ErrorNote message={error} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? "Saving…" : editing ? "Save changes" : "Save job"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => confirmClose(() => router.back())}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
