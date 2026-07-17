"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { pfAttachmentDownloadUrl, pfUploadNoteFile } from "@/lib/pf-upload";
import { formatDateTime } from "@/lib/format";
import { NOTE_COLORS, type PfNote, type PfNoteAttachment, type PfNoteItem } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { PF, PfBtn, PfCard, PfField, PfInput, PfBadge, PfNote as PfBanner, PfLoading, PfTextBtn, NOTE_STRIP, pfInputStyle } from "@/components/pf-dc";

export default function PfNoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading, mutate } = usePfApi<PfNote>(`notes/${id}`);
  return (
    <PfShell>
      <div style={{ marginBottom: 16 }}>
        <Link href="/personal-finance/notes" style={{ fontSize: 11, color: PF.onGradSub, textDecoration: "none" }}>← All notes</Link>
      </div>
      {isLoading && <PfLoading />}
      {error && <PfBanner tone="red">{error.message}</PfBanner>}
      {data && <Editor key={data.id} note={data} onChanged={mutate} />}
    </PfShell>
  );
}

function Editor({ note, onChanged }: { note: PfNote; onChanged: () => void }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [title, setTitle] = useState(note.title ?? "");
  const [body, setBody] = useState(note.body ?? "");
  const [items, setItems] = useState<PfNoteItem[]>(note.items ?? []);
  const [color, setColor] = useState(note.color ?? "default");
  const [pinned, setPinned] = useState(note.pinned);
  const [remindOn, setRemindOn] = useState(note.remindOn ?? "");
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  // Dirty = local edits differ from the loaded note (recomputed reactively).
  useEffect(() => {
    const cur = JSON.stringify({ title: title.trim(), body, items, color, pinned, remindOn: remindOn || "" });
    const orig = JSON.stringify({
      title: (note.title ?? "").trim(),
      body: note.body ?? "",
      items: note.items ?? [],
      color: note.color ?? "default",
      pinned: note.pinned,
      remindOn: note.remindOn ?? "",
    });
    setDirty(cur !== orig);
  }, [title, body, items, color, pinned, remindOn, note]);

  // Warn before leaving with unsaved edits (the editor persists only on Save).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function save() {
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend(`notes/${note.id}`, "PATCH", {
        title: title.trim(),
        body,
        items,
        color,
        pinned,
        remindOn: remindOn || undefined,
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onChanged();
    } catch (e) {
      setFieldErrs(fieldErrorMap(e));
      setErr(bannerMessage(e, "Could not save") ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function archiveToggle() {
    if (note.archivedAt) {
      await pfApiSend(`notes/${note.id}/restore`, "POST");
      onChanged();
    } else {
      if (!(await confirm({ title: "Archive this note?", body: "You can restore it from the Archived view.", danger: true, confirmLabel: "Archive" }))) return;
      await pfApiSend(`notes/${note.id}/archive`, "POST");
      router.push("/personal-finance/notes");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PfCard style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 6, flexShrink: 0, borderRadius: 999, background: NOTE_STRIP[color] ?? NOTE_STRIP.default }} />
        <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 12 }}>
          <input aria-label="Note title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ ...pfInputStyle, fontSize: 15, fontWeight: 600 }} />
          <textarea aria-label="Note body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write anything…" style={{ ...pfInputStyle, minHeight: 140, resize: "vertical", lineHeight: 1.5 }} />

          {/* Checklist */}
          <div style={{ display: "grid", gap: 6 }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox" aria-label={`Toggle: ${it.text || "item"}`} checked={it.done}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                  style={{ height: 18, width: 18, flexShrink: 0, accentColor: PF.accent }}
                />
                <input
                  aria-label="Checklist item" value={it.text}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  style={{ ...pfInputStyle, flex: 1, textDecoration: it.done ? "line-through" : "none", color: it.done ? PF.muted2 : PF.text }}
                />
                <PfTextBtn danger onClick={() => setItems(items.filter((_, j) => j !== i))}>remove</PfTextBtn>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 18, flexShrink: 0 }} />
              <input
                value={newItem} onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newItem.trim()) {
                    e.preventDefault();
                    setItems([...items, { text: newItem.trim(), done: false }]);
                    setNewItem("");
                  }
                }}
                placeholder="+ Add a checklist item (Enter)"
                style={{ ...pfInputStyle, flex: 1 }}
              />
            </div>
          </div>

          {/* Meta row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <PfField label="Remind me on" hint="An email reminder fires on this day." error={fieldErrs.remindOn}>
              <PfInput type="date" value={remindOn} onChange={(e) => setRemindOn(e.target.value)} />
            </PfField>
            <PfField label="Colour" error={fieldErrs.color}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 2 }}>
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c} type="button" aria-label={`Colour: ${c}`} onClick={() => setColor(c)}
                    style={{ height: 26, width: 26, borderRadius: 999, cursor: "pointer", background: NOTE_STRIP[c], border: color === c ? `2px solid ${PF.accent}` : `2px solid transparent`, outline: color === c ? `1px solid ${PF.accent}` : "none", outlineOffset: 2 }}
                  />
                ))}
              </div>
            </PfField>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: PF.text }}>
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} style={{ height: 16, width: 16, accentColor: PF.accent }} /> Pin to top
            </label>
            {note.archivedAt && <PfBadge tone="gray">archived</PfBadge>}
          </div>

          {err && <PfBanner tone="red">{err}</PfBanner>}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <PfBtn onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save" : "Saved"}</PfBtn>
            {saved && <span style={{ fontSize: 11, color: PF.light }}>Saved</span>}
            <span style={{ marginLeft: "auto" }}>
              <PfBtn variant={note.archivedAt ? "secondary" : "danger"} onClick={archiveToggle}>{note.archivedAt ? "Restore" : "Archive"}</PfBtn>
            </span>
          </div>
          <p style={{ fontSize: 11, color: PF.muted2, margin: 0 }}>Updated {formatDateTime(note.updatedAt)}</p>
        </div>
      </PfCard>

      <Attachments noteId={note.id} attachments={note.attachments ?? []} onChanged={onChanged} />
    </div>
  );
}

function Attachments({ noteId, attachments, onChanged }: { noteId: string; attachments: PfNoteAttachment[]; onChanged: () => void }) {
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend(`notes/${noteId}/attachments/link`, "POST", { url: url.trim(), filename: linkName.trim() || undefined });
      setUrl("");
      setLinkName("");
      setLinkOpen(false);
      onChanged();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not add link") ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setErr("");
    try {
      await pfUploadNoteFile(noteId, file);
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not upload");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function remove(id: string) {
    if (!(await confirm({ title: "Remove this attachment?", danger: true, confirmLabel: "Remove" }))) return;
    await pfApiSend(`attachments/${id}`, "DELETE");
    onChanged();
  }

  return (
    <PfCard>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <p style={{ fontSize: 12.5, fontWeight: 700, color: PF.text, margin: 0 }}>Attachments</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PfBtn variant="secondary" onClick={() => setLinkOpen((o) => !o)}>{linkOpen ? "Cancel" : "+ Link"}</PfBtn>
          <PfBtn variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "…" : "Upload file"}</PfBtn>
          <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </div>
      </div>

      {linkOpen && (
        <form onSubmit={addLink} style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}><PfField label="URL" error={fieldErrs.url}><PfInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></PfField></div>
          <div style={{ width: 200 }}><PfField label="Label (optional)" error={fieldErrs.filename}><PfInput value={linkName} onChange={(e) => setLinkName(e.target.value)} /></PfField></div>
          <PfBtn type="submit" variant="secondary" disabled={busy || !url.trim()}>Add</PfBtn>
        </form>
      )}
      {err && <div style={{ marginTop: 8 }}><PfBanner tone="red">{err}</PfBanner></div>}

      {attachments.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 11, color: PF.muted2 }}>No attachments. Add a link or upload a file (large files → link).</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
          {attachments.map((a, i) => (
            <li key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: i === 0 ? undefined : `1px solid ${PF.hair}`, fontSize: 12.5 }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.isLink ? (
                  <a href={a.url} target="_blank" rel="noreferrer" style={{ color: PF.blue, textDecoration: "none" }}>{a.filename || a.url}</a>
                ) : (
                  <a href={pfAttachmentDownloadUrl(a.id)} target="_blank" rel="noreferrer" style={{ color: PF.text, textDecoration: "none" }}>{a.filename || "file"}</a>
                )}
                <span style={{ marginLeft: 8, fontSize: 10.5, color: PF.muted2 }}>{a.isLink ? "link" : a.mime ?? "file"}</span>
              </span>
              <PfTextBtn danger onClick={() => remove(a.id)}>remove</PfTextBtn>
            </li>
          ))}
        </ul>
      )}
    </PfCard>
  );
}
