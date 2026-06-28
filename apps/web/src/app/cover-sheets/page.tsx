"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fileSrc } from "@/lib/upload";
import { formatDate } from "@/lib/format";
import { can, type CoverSheet, type FileMeta, type RefEntity, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { FileUpload } from "@/components/FileUpload";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Spinner } from "@/components/ui";

const searchRef = (kind: string) => async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<RefEntity[]>(`reference?kind=${kind}&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.canonical, sub: r.status }));
};

export default function CoverSheetsPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data, error, isLoading, mutate } = useApi<CoverSheet[]>("knowledge/cover-sheets");
  const canManage = can(me?.permissions, "knowledge:approve");

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ name: "", universityRefId: null as string | null, programmeRefId: null as string | null, notes: "" });
  const [file, setFile] = useState<FileMeta | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await apiSend("knowledge/cover-sheets", "POST", {
        name: form.name,
        universityRefId: form.universityRefId ?? undefined,
        programmeRefId: form.programmeRefId ?? undefined,
        fileObjectId: file?.id,
        notes: form.notes || undefined,
      });
      setOpen(false);
      setForm({ name: "", universityRefId: null, programmeRefId: null, notes: "" });
      setFile(null);
      await mutate();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create cover sheet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Cover sheets</h1>
        {canManage && <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ New cover sheet"}</Button>}
      </div>

      {open && canManage && (
        <Card className="mb-5">
          <form onSubmit={create} className="space-y-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="University">
                <EntityPicker placeholder="Search university…" search={searchRef("university")} onPick={(i) => setForm((f) => ({ ...f, universityRefId: i?.id ?? null }))} />
              </Field>
              <Field label="Programme / course">
                <EntityPicker placeholder="Search course…" search={searchRef("course")} onPick={(i) => setForm((f) => ({ ...f, programmeRefId: i?.id ?? null }))} />
              </Field>
            </div>
            <Field label="Template file">
              <FileUpload kind="cover_sheet" label={file ? "Replace file" : "Upload template"} onUploaded={setFile} />
              {file && <p className="mt-1 text-xs text-gray-600">📎 {file.filename ?? file.id}</p>}
            </Field>
            <Field label="Notes">
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            {formError && <ErrorNote message={formError} />}
            <Button type="submit" disabled={busy || !form.name}>
              {busy ? "Saving…" : "Save cover sheet"}
            </Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No cover sheets yet" />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {data.map((cs) => (
            <li key={cs.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="text-sm">
                <span className="font-medium">{cs.name}</span>
                {cs.notes ? <div className="mt-0.5 text-xs text-gray-500">{cs.notes}</div> : null}
                <div className="mt-0.5 text-xs text-gray-400">updated {formatDate(cs.updatedAt)}</div>
              </div>
              {cs.fileObjectId && (
                <a href={fileSrc(cs.fileObjectId)} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">
                  Download
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
