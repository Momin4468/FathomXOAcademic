"use client";
import { useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate } from "@/lib/format";
import { can, type FileMeta, type KnowledgeArticleRow, type RefEntity, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { FileUpload } from "@/components/FileUpload";
import { linkFile } from "@/lib/upload";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Select, Spinner, Textarea } from "@/components/ui";

const TYPES = ["", "doc", "prompt_pack", "blog"];
const TYPE_LABEL: Record<string, string> = { doc: "doc", prompt_pack: "prompt pack", blog: "blog" };

const searchRef = (kind: string) => async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<RefEntity[]>(`reference?kind=${kind}&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.canonical, sub: r.status }));
};

export default function KnowledgePage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const [type, setType] = useState("");
  const [universityRefId, setUniversityRefId] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (type) qs.set("type", type);
  if (universityRefId) qs.set("universityRefId", universityRefId);
  const path = `knowledge/articles${qs.toString() ? `?${qs}` : ""}`;
  const { data, error, isLoading, mutate } = useApi<KnowledgeArticleRow[]>(path);

  const canCreate = can(me?.permissions, "knowledge:create");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ type: "doc", title: "", body: "", universityRefId: null as string | null, programmeRefId: null as string | null });
  const [attachments, setAttachments] = useState<FileMeta[]>([]);
  const [linkUrl, setLinkUrl] = useState("");

  async function addLink() {
    if (!linkUrl.trim()) return;
    try {
      const f = await linkFile(linkUrl.trim(), "knowledge");
      setAttachments((a) => [...a, f]);
      setLinkUrl("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not add link");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    setFieldErrs({});
    try {
      await apiSend("knowledge/articles", "POST", {
        type: form.type,
        title: form.title,
        body: form.body || undefined,
        universityRefId: form.universityRefId ?? undefined,
        programmeRefId: form.programmeRefId ?? undefined,
        attachmentFileIds: attachments.map((a) => a.id),
      });
      setOpen(false);
      setForm({ type: "doc", title: "", body: "", universityRefId: null, programmeRefId: null });
      setAttachments([]);
      await mutate();
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setFormError(bannerMessage(err, "Could not create article") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Knowledge base</h1>
        {canCreate && <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ New article"}</Button>}
      </div>

      {open && canCreate && (
        <Card className="mb-5">
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Type" error={fieldErrs.type}>
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="doc">doc</option>
                  <option value="prompt_pack">prompt pack</option>
                  <option value="blog">blog</option>
                </Select>
              </Field>
              <Field label="Title" required error={fieldErrs.title}>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
            </div>
            <Field label="Body" error={fieldErrs.body}>
              <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="University (optional)" error={fieldErrs.universityRefId}>
                <EntityPicker placeholder="Search university…" search={searchRef("university")} onPick={(i) => setForm((f) => ({ ...f, universityRefId: i?.id ?? null }))} />
              </Field>
              <Field label="Programme / course (optional)" error={fieldErrs.programmeRefId}>
                <EntityPicker placeholder="Search course…" search={searchRef("course")} onPick={(i) => setForm((f) => ({ ...f, programmeRefId: i?.id ?? null }))} />
              </Field>
            </div>
            <Field label="Media" hint="Small files (≤10 MB) are stored; large files / video → paste a link.">
              <FileUpload kind="knowledge" onUploaded={(f) => setAttachments((a) => [...a, f])} />
              <div className="mt-2 flex gap-2">
                <Input
                  placeholder="https://… (video / large file link)"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
                <Button type="button" variant="secondary" disabled={!linkUrl.trim()} onClick={addLink}>
                  Add link
                </Button>
              </div>
              {attachments.length > 0 && (
                <ul className="mt-2 text-xs text-slate-300">
                  {attachments.map((a) => (
                    <li key={a.id}>{a.isLink ? "🔗" : "📎"} {a.filename ?? a.url ?? a.id}</li>
                  ))}
                </ul>
              )}
            </Field>
            {formError && <ErrorNote message={formError} />}
            <Button type="submit" disabled={busy || !form.title}>
              {busy ? "Saving…" : "Publish article"}
            </Button>
          </form>
        </Card>
      )}

      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{t || "Any type"}</option>
              ))}
            </Select>
          </Field>
          <Field label="University">
            <EntityPicker placeholder="Any university…" search={searchRef("university")} onPick={(i) => setUniversityRefId(i?.id ?? null)} />
          </Field>
        </div>
      </Card>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No articles yet" hint="Anyone can author a doc, prompt pack, or blog." />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
          {data.map((a) => (
            <li key={a.id}>
              <Link href={`/knowledge/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-ink-800">
                <div className="text-sm">
                  <span className="font-medium">{a.title}</span>
                  <div className="mt-0.5 text-xs text-slate-400">updated {formatDate(a.updatedAt)}</div>
                </div>
                <Badge tone="blue">{TYPE_LABEL[a.type] ?? a.type}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
