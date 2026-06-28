"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { NOTE_COLOR_BG, type PfNote } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Spinner } from "@/components/ui";

export default function PfNotesPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const key = `notes?${archived ? "archived=true&" : ""}q=${encodeURIComponent(q)}`;
  const { data, error, isLoading } = usePfApi<PfNote[]>(key);
  const [busy, setBusy] = useState(false);
  const [createErr, setCreateErr] = useState("");

  async function newNote() {
    setBusy(true);
    setCreateErr("");
    try {
      const n = await pfApiSend<PfNote>("notes", "POST", { title: "" });
      router.push(`/personal-finance/notes/${n.id}`);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Could not create a note");
      setBusy(false);
    }
  }

  return (
    <PfShell>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Notes</h1>
        <Button onClick={newNote} disabled={busy}>{busy ? "…" : "+ New note"}</Button>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="flex-1"><Input placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button variant={archived ? "primary" : "secondary"} className="shrink-0" onClick={() => setArchived((a) => !a)}>
          {archived ? "Archived" : "Active"}
        </Button>
      </div>
      {createErr && <div className="mb-3"><ErrorNote message={createErr} /></div>}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && (
        <EmptyState title={archived ? "No archived notes" : "No notes yet"} hint={archived ? undefined : "Create one — a list, a reminder, or just a thought."} />
      )}
      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.map((n) => <NoteCard key={n.id} note={n} />)}
        </div>
      )}
    </PfShell>
  );
}

function NoteCard({ note }: { note: PfNote }) {
  const items = note.items ?? [];
  const done = items.filter((i) => i.done).length;
  const snippet = (note.body ?? "").trim().slice(0, 140);
  return (
    <Link href={`/personal-finance/notes/${note.id}`} className="block">
      <Card className="flex gap-3 transition hover:border-gray-300">
        <div className={`w-1.5 shrink-0 rounded-full ${NOTE_COLOR_BG[note.color ?? "default"] ?? NOTE_COLOR_BG.default}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{note.title?.trim() || "(untitled)"}</span>
            {note.pinned && <span title="Pinned" className="shrink-0 text-amber-500">★</span>}
          </div>
          {snippet && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{snippet}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {items.length > 0 && <Badge tone="gray">{done}/{items.length} done</Badge>}
            {note.remindOn && <Badge tone="amber">remind {formatDate(note.remindOn)}</Badge>}
          </div>
        </div>
      </Card>
    </Link>
  );
}
