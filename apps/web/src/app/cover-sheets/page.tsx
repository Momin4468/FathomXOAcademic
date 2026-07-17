"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { fileSrc } from "@/lib/upload";
import { can, type CoverSheet, type FileMeta, type RefEntity, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { FileUpload } from "@/components/FileUpload";
import {
  Card, DGrid, EmptyBox, Field, GoldButton, Loading, Note, Page, T,
  cell, dcInput, fmtDay, type DCol,
} from "@/components/dc";

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
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", universityRefId: null as string | null, programmeRefId: null as string | null, notes: "" });
  const [file, setFile] = useState<FileMeta | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(err));
      setFormError(bannerMessage(err, "Could not create cover sheet") ?? "");
    } finally {
      setBusy(false);
    }
  }

  const cols: DCol<CoverSheet>[] = [
    { label: "Name", render: (cs) => cell(cs.name, { weight: 600, sub: cs.notes || undefined }) },
    { label: "Updated", render: (cs) => cell(fmtDay(cs.updatedAt), { color: T.muted2 }) },
    {
      label: "File", align: "right", render: (cs) =>
        cs.fileObjectId ? (
          <a href={fileSrc(cs.fileObjectId)} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 600, color: T.blue, textDecoration: "none" }}>
            Download
          </a>
        ) : (
          <span style={{ color: T.muted2 }}>—</span>
        ),
    },
  ];

  return (
    <AppShell>
      <Page
        title="Cover sheets"
        action={canManage ? <GoldButton onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ New cover sheet"}</GoldButton> : undefined}
      >
        {open && canManage && (
          <Card style={{ marginBottom: 16 }}>
            <form onSubmit={create} style={{ padding: 16, display: "grid", gap: 14 }}>
              <Field label="Name" error={fieldErrs.name}>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={dcInput} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <Field label="University" error={fieldErrs.universityRefId}>
                  <EntityPicker placeholder="Search university…" search={searchRef("university")} onPick={(i) => setForm((f) => ({ ...f, universityRefId: i?.id ?? null }))} />
                </Field>
                <Field label="Programme / course" error={fieldErrs.programmeRefId}>
                  <EntityPicker placeholder="Search course…" search={searchRef("course")} onPick={(i) => setForm((f) => ({ ...f, programmeRefId: i?.id ?? null }))} />
                </Field>
              </div>
              <Field label="Template file" error={fieldErrs.fileObjectId}>
                <FileUpload kind="cover_sheet" label={file ? "Replace file" : "Upload template"} onUploaded={setFile} />
                {file && <p style={{ marginTop: 6, fontSize: 11, color: T.muted }}>📎 {file.filename ?? file.id}</p>}
              </Field>
              <Field label="Notes" error={fieldErrs.notes}>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={dcInput} />
              </Field>
              {formError && <Note>{formError}</Note>}
              <div>
                <GoldButton type="submit" disabled={busy || !form.name}>{busy ? "Saving…" : "Save cover sheet"}</GoldButton>
              </div>
            </form>
          </Card>
        )}

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (data.length === 0 ? (
          <EmptyBox title="No cover sheets yet" />
        ) : (
          <DGrid cols={cols} rows={data} keyOf={(cs) => cs.id} minWidth={480} />
        ))}
      </Page>
    </AppShell>
  );
}
