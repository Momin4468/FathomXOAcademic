"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pin } from "lucide-react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { formatDate } from "@/lib/format";
import { type PfNote } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { PF, PfBtn, PfCard, PfBadge, PfNote as PfBanner, PfEmpty, PfLoading, NOTE_STRIP } from "@/components/pf-dc";

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Notes</h1>
        <PfBtn onClick={newNote} disabled={busy}>{busy ? "…" : "+ New note"}</PfBtn>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <input
          aria-label="Search notes" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, border: `1px solid ${PF.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 12.5, background: PF.card, color: PF.text, outlineColor: PF.accentDeep }}
        />
        <PfBtn variant={archived ? "solid" : "secondary"} onClick={() => setArchived((a) => !a)}>{archived ? "Archived" : "Active"}</PfBtn>
      </div>
      {createErr && <div style={{ marginBottom: 12 }}><PfBanner tone="red">{createErr}</PfBanner></div>}

      {isLoading && <PfLoading />}
      {error && <PfBanner tone="red">{error.message}</PfBanner>}
      {data && data.length === 0 && (
        <PfEmpty title={archived ? "No archived notes" : "No notes yet"} hint={archived ? undefined : "Create one — a list, a reminder, or just a thought."} />
      )}
      {data && data.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
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
    <Link href={`/personal-finance/notes/${note.id}`} style={{ textDecoration: "none", display: "block" }}>
      <PfCard style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 6, flexShrink: 0, borderRadius: 999, background: NOTE_STRIP[note.color ?? "default"] ?? NOTE_STRIP.default }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600, color: PF.text }}>{note.title?.trim() || "(untitled)"}</span>
            {note.pinned && <Pin aria-label="Pinned" style={{ height: 15, width: 15, flexShrink: 0, fill: PF.light, color: PF.accentDeep }} />}
          </div>
          {snippet && <p style={{ margin: "3px 0 0", fontSize: 11, color: PF.muted, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{snippet}</p>}
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {items.length > 0 && <PfBadge tone="gray">{done}/{items.length} done</PfBadge>}
            {note.remindOn && <PfBadge tone="amber">remind {formatDate(note.remindOn)}</PfBadge>}
          </div>
        </div>
      </PfCard>
    </Link>
  );
}
