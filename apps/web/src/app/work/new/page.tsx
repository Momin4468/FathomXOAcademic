"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import type { PartyRow, RefEntity, WorkItem } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";

// Stable search/create fns (module scope) so the picker's effect deps don't churn.
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

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [courseRefId, setCourseRefId] = useState<string | null>(null);
  const [assignmentTypeRefId, setAssignmentTypeRefId] = useState<string | null>(null);
  const [sourcePartyId, setSourcePartyId] = useState<string | null>(null);
  const [doerPartyId, setDoerPartyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const dirty =
    !!title || !!details || !!courseRefId || !!assignmentTypeRefId || !!sourcePartyId || !!doerPartyId;
  const { confirmClose } = useUnsavedGuard(dirty);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    setFieldErrs({});
    try {
      const item = await apiSend<WorkItem>("work", "POST", {
        title: title.trim(),
        details: details.trim() || undefined,
        courseRefId: courseRefId ?? undefined,
        assignmentTypeRefId: assignmentTypeRefId ?? undefined,
        sourcePartyId: sourcePartyId ?? undefined,
        doerPartyId: doerPartyId ?? undefined,
      });
      router.replace(`/work/${item.id}`);
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setError(bannerMessage(err, "Could not create job") ?? "");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Log a job</h1>
      <p className="mb-5 text-xs text-gray-500">
        Capture the essentials now — pick from existing reference data, complete the rest later.
      </p>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Title" required hint="Required. Everything else can wait." error={fieldErrs.title}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ICT701 A3" required />
          </Field>
          <Field label="Detail" hint="Optional — a quick note now (word count, deadline, instructions)." error={fieldErrs.details}>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. 2000 words, due Fri, APA" />
          </Field>
          <Field label="Course" hint="Pick the canonical course, or add a provisional one." error={fieldErrs.courseRefId}>
            <EntityPicker
              placeholder="Search course…"
              search={searchRef("course")}
              onCreate={createRef("course")}
              onPick={(i) => setCourseRefId(i?.id ?? null)}
            />
          </Field>
          <Field label="Assignment type" error={fieldErrs.assignmentTypeRefId}>
            <EntityPicker
              placeholder="Search type (A1, CW1…)"
              search={searchRef("assignment_type")}
              onCreate={createRef("assignment_type")}
              onPick={(i) => setAssignmentTypeRefId(i?.id ?? null)}
            />
          </Field>
          <Field label="Client (source)" error={fieldErrs.sourcePartyId}>
            <EntityPicker placeholder="Search client…" search={searchParty("client")} onPick={(i) => setSourcePartyId(i?.id ?? null)} />
          </Field>
          <Field label="Writer (doer)" error={fieldErrs.doerPartyId}>
            <EntityPicker placeholder="Search writer…" search={searchParty("writer")} onPick={(i) => setDoerPartyId(i?.id ?? null)} />
          </Field>
          {error && <ErrorNote message={error} />}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? "Saving…" : "Save draft"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => confirmClose(() => router.back())}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </AppShell>
  );
}
