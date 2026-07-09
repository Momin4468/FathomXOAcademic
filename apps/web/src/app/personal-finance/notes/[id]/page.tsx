"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { pfAttachmentDownloadUrl, pfUploadNoteFile } from "@/lib/pf-upload";
import { formatDateTime } from "@/lib/format";
import { NOTE_COLORS, NOTE_COLOR_BG, type PfNote, type PfNoteAttachment, type PfNoteItem } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, DateInput, ErrorNote, Field, Input, Spinner, Textarea, cx } from "@/components/ui";

export default function PfNoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading, mutate } = usePfApi<PfNote>(`notes/${id}`);
  return (
    <PfShell>
      <div className="mb-4">
        <Link href="/personal-finance/notes" className="text-xs text-gray-500 hover:underline">← All notes</Link>
      </div>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
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
    <div className="space-y-4">
      <Card className="flex gap-3">
        <div className={`w-1.5 shrink-0 rounded-full ${NOTE_COLOR_BG[color] ?? NOTE_COLOR_BG.default}`} />
        <div className="min-w-0 flex-1 space-y-3">
          <Input aria-label="Note title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="text-base font-medium" />
          <Textarea aria-label="Note body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write anything…" className="min-h-[140px]" />

          {/* Checklist */}
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Toggle: ${it.text || "item"}`}
                  checked={it.done}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                  className="h-5 w-5 shrink-0"
                />
                <input
                  aria-label="Checklist item"
                  className={cx("min-h-[44px] flex-1 rounded-md border border-gray-200 px-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900", it.done && "text-gray-400 line-through")}
                  value={it.text}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                />
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setItems(items.filter((_, j) => j !== i))}>remove</button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-4" />
              <Input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newItem.trim()) {
                    e.preventDefault();
                    setItems([...items, { text: newItem.trim(), done: false }]);
                    setNewItem("");
                  }
                }}
                placeholder="+ Add a checklist item (Enter)"
                className="min-h-[36px] text-sm"
              />
            </div>
          </div>

          {/* Meta row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Remind me on" hint="An email reminder fires on this day." error={fieldErrs.remindOn}>
              <DateInput value={remindOn} onChange={setRemindOn} />
            </Field>
            <Field label="Colour" error={fieldErrs.color}>
              <div className="flex items-center gap-2 pt-1">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour: ${c}`}
                    onClick={() => setColor(c)}
                    className={cx("h-7 w-7 rounded-full ring-offset-2", NOTE_COLOR_BG[c], color === c && "ring-2 ring-gray-900")}
                  />
                ))}
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4" /> Pin to top
            </label>
            {note.archivedAt && <Badge tone="gray">archived</Badge>}
          </div>

          {err && <ErrorNote message={err} />}
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save" : "Saved"}</Button>
            {saved && <span className="text-xs text-emerald-800">Saved</span>}
            <Button variant={note.archivedAt ? "ghost" : "danger"} className="ml-auto px-3 text-xs" onClick={archiveToggle}>
              {note.archivedAt ? "Restore" : "Archive"}
            </Button>
          </div>
          <p className="text-xs text-gray-400">Updated {formatDateTime(note.updatedAt)}</p>
        </div>
      </Card>

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
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Attachments</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="px-2 text-xs" onClick={() => setLinkOpen((o) => !o)}>{linkOpen ? "Cancel" : "+ Link"}</Button>
          <Button variant="secondary" className="px-2 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "…" : "Upload file"}</Button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </div>
      </div>

      {linkOpen && (
        <form onSubmit={addLink} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1"><Field label="URL" error={fieldErrs.url}><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field></div>
          <div className="sm:w-48"><Field label="Label (optional)" error={fieldErrs.filename}><Input value={linkName} onChange={(e) => setLinkName(e.target.value)} /></Field></div>
          <Button type="submit" variant="secondary" disabled={busy || !url.trim()}>Add</Button>
        </form>
      )}
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}

      {attachments.length === 0 ? (
        <p className="mt-3 text-xs text-gray-400">No attachments. Add a link or upload a file (large files → link).</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {a.isLink ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{a.filename || a.url}</a>
                ) : (
                  <a href={pfAttachmentDownloadUrl(a.id)} target="_blank" rel="noreferrer" className="text-gray-800 hover:underline">{a.filename || "file"}</a>
                )}
                <span className="ml-2 text-xs text-gray-400">{a.isLink ? "link" : a.mime ?? "file"}</span>
              </span>
              <button type="button" className="shrink-0 text-xs text-red-600 hover:underline" onClick={() => remove(a.id)}>remove</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
