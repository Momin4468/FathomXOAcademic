"use client";
import { useState } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate } from "@/lib/format";
import { can, type FileMeta, type KnowledgeArticleRow, type RefEntity, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { FileUpload } from "@/components/FileUpload";
import { linkFile } from "@/lib/upload";
import { Card, EmptyBox, Field, GoldButton, GhostButton, Loading, Note, Page, T, dcInput } from "@/components/dc";

const TYPES = ["", "doc", "prompt_pack", "blog"];
const TYPE_LABEL: Record<string, string> = { doc: "doc", prompt_pack: "prompt pack", blog: "blog" };

// Navy "publish" action (design: ink bg + gold text), matches the handoff compose card.
const navyBtn: CSSProperties = {
  background: T.ink, color: "#F0D08C", fontWeight: 700, fontSize: 12.5,
  padding: "8px 16px", borderRadius: 8, cursor: "pointer", border: "none",
};

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
      <Page
        title="Knowledge base"
        sub="best-practice posts, prompt packs & video links — anyone can write"
        action={canCreate ? <GoldButton onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ New article"}</GoldButton> : undefined}
      >
        {open && canCreate && (
          <Card style={{ padding: 14, marginBottom: 16, borderColor: T.parchBorder }}>
            <form onSubmit={create} style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                <Field label="Type" error={fieldErrs.type}>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={dcInput}>
                    <option value="doc">doc</option>
                    <option value="prompt_pack">prompt pack</option>
                    <option value="blog">blog</option>
                  </select>
                </Field>
                <Field label="Title" required error={fieldErrs.title}>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required style={dcInput} />
                </Field>
              </div>
              <Field label="Body" error={fieldErrs.body}>
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} style={{ ...dcInput, resize: "vertical", lineHeight: 1.6 }} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                <Field label="University (optional)" error={fieldErrs.universityRefId}>
                  <EntityPicker placeholder="Search university…" search={searchRef("university")} onPick={(i) => setForm((f) => ({ ...f, universityRefId: i?.id ?? null }))} />
                </Field>
                <Field label="Programme / course (optional)" error={fieldErrs.programmeRefId}>
                  <EntityPicker placeholder="Search course…" search={searchRef("course")} onPick={(i) => setForm((f) => ({ ...f, programmeRefId: i?.id ?? null }))} />
                </Field>
              </div>
              <Field label="Media" hint="Small files (≤10 MB) are stored; large files / video → paste a link.">
                <FileUpload kind="knowledge" onUploaded={(f) => setAttachments((a) => [...a, f])} />
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <input
                    placeholder="https://… (video / large file link)"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    style={dcInput}
                  />
                  <GhostButton type="button" disabled={!linkUrl.trim()} onClick={addLink}>Add link</GhostButton>
                </div>
                {attachments.length > 0 && (
                  <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", fontSize: 12, color: T.muted }}>
                    {attachments.map((a) => (
                      <li key={a.id}>{a.isLink ? "🔗" : "📎"} {a.filename ?? a.url ?? a.id}</li>
                    ))}
                  </ul>
                )}
              </Field>
              {formError && <Note>{formError}</Note>}
              <div>
                <button type="submit" disabled={busy || !form.title} style={{ ...navyBtn, opacity: busy || !form.title ? 0.5 : 1, cursor: busy || !form.title ? "not-allowed" : "pointer" }}>
                  {busy ? "Saving…" : "Publish article"}
                </button>
              </div>
            </form>
          </Card>
        )}

        <Card style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label="Type">
              <select value={type} onChange={(e) => setType(e.target.value)} style={dcInput}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t || "Any type"}</option>
                ))}
              </select>
            </Field>
            <Field label="University">
              <EntityPicker placeholder="Any university…" search={searchRef("university")} onPick={(i) => setUniversityRefId(i?.id ?? null)} />
            </Field>
          </div>
        </Card>

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && data.length === 0 && <EmptyBox title="No articles yet" hint="Anyone can author a doc, prompt pack, or blog." />}
        {data && data.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 14 }}>
            {data.map((a) => (
              <Link
                key={a.id}
                href={`/knowledge/${a.id}`}
                style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 18px", textDecoration: "none", color: T.ink, display: "flex", flexDirection: "column", gap: 8 }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.goldDeep }}>{TYPE_LABEL[a.type] ?? a.type}</span>
                <span style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 17, fontWeight: 600, lineHeight: 1.25 }}>{a.title}</span>
                <span style={{ fontSize: 11, color: T.muted2, borderTop: `1px solid ${T.hair}`, paddingTop: 8, marginTop: "auto" }}>
                  updated {formatDate(a.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Page>
    </AppShell>
  );
}
