"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api";
import { type PartyRow, type RefEntity } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { Badge, Button, Card, ErrorNote, Field, Input, MoneyInput, cx } from "@/components/ui";

interface Part { detail: string; wordCount: string; clientAmount: string; writerAmount: string }
const blankPart = (): Part => ({ detail: "", wordCount: "", clientAmount: "", writerAmount: "" });

const searchCourse = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<RefEntity[]>(`reference?kind=course&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.canonical, sub: r.status }));
};
const searchParty = (type: string) => async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?type=${type}&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: (r.partyType ?? []).join(", ") }));
};

/**
 * Add course / thesis / project (handoff §3) — one parent + N priced parts in a
 * single entry, instead of logging N separate jobs. Each part gets a client price
 * and a writer fee; the money chain is created so margins derive per part. The
 * combined total is shown live.
 */
export default function BundlePage() {
  const router = useRouter();
  const [kind, setKind] = useState<"course" | "thesis" | "project">("course");
  const [title, setTitle] = useState("");
  const [courseRefId, setCourseRefId] = useState<string | null>(null);
  const [clientPartyId, setClientPartyId] = useState<string | null>(null);
  const [doerPartyId, setDoerPartyId] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>([blankPart(), blankPart()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setPart = (i: number, k: keyof Part, v: string) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const combined = parts.reduce((a, p) => a + (Number(p.clientAmount) || 0), 0);
  const valid = title.trim() && parts.some((p) => p.detail.trim());

  async function save() {
    if (!valid) return;
    setBusy(true); setErr("");
    try {
      const res = await apiSend<{ projectId: string; parts: string[] }>("work/bundle", "POST", {
        kind,
        title: title.trim(),
        courseRefId: courseRefId ?? undefined,
        clientPartyId: clientPartyId ?? undefined,
        doerPartyId: doerPartyId ?? undefined,
        parts: parts.filter((p) => p.detail.trim()).map((p) => ({
          detail: p.detail.trim(),
          wordCount: p.wordCount ? Number(p.wordCount) : undefined,
          clientAmount: p.clientAmount ? Number(p.clientAmount) : undefined,
          writerAmount: p.writerAmount ? Number(p.writerAmount) : undefined,
        })),
      });
      router.push(`/work?highlight=${res.projectId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the bundle");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Add course / thesis / project</h1>
      <p className="mb-4 text-xs text-slate-400">One parent, priced by parts — instead of logging each assignment separately. Each part gets its own client price + writer fee; margins derive per part.</p>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["course", "thesis", "project"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={cx("rounded-full border px-3 py-1 text-xs font-semibold capitalize", kind === k ? "border-ink-950 bg-ink-950 text-gold-300" : "border-ink-700 text-slate-400 hover:bg-ink-800")}>
              {k}
            </button>
          ))}
          <Badge tone="purple">{kind.toUpperCase()}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. MBA Term 1 — Mujahid" /></Field>
          <Field label="Course code" hint="optional"><EntityPicker placeholder="Search course…" search={searchCourse} onPick={(i) => setCourseRefId(i?.id ?? null)} /></Field>
          <Field label="Client" hint="optional"><EntityPicker placeholder="Search client…" search={searchParty("client")} onPick={(i) => setClientPartyId(i?.id ?? null)} /></Field>
          <Field label="Writer" hint="optional"><EntityPicker placeholder="Search writer…" search={searchParty("writer")} onPick={(i) => setDoerPartyId(i?.id ?? null)} /></Field>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parts</span>
            <span className="text-xs text-slate-400">Combined client total <strong className="tabular-nums text-slate-100">৳{combined.toLocaleString()}</strong></span>
          </div>
          <div className="space-y-2">
            {parts.map((p, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-ink-700 p-2 sm:grid-cols-[1.6fr_80px_110px_110px_auto]">
                <Input value={p.detail} onChange={(e) => setPart(i, "detail", e.target.value)} placeholder={`Part ${i + 1} — Assignment 1, Chapter 2…`} />
                <Input value={p.wordCount} onChange={(e) => setPart(i, "wordCount", e.target.value)} placeholder="Words" inputMode="numeric" className="text-right" />
                <MoneyInput value={p.clientAmount} onChange={(v) => setPart(i, "clientAmount", v)} />
                <MoneyInput value={p.writerAmount} onChange={(v) => setPart(i, "writerAmount", v)} />
                <button type="button" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} disabled={parts.length <= 1}
                  className="inline-flex items-center justify-center rounded-lg px-2 text-slate-400 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <button type="button" onClick={() => setParts((ps) => [...ps, blankPart()])} className="font-semibold text-gold-600 hover:underline dark:text-gold-400">+ add part</button>
            <span>· client ৳ (top) and writer ৳ (per part)</span>
          </div>
        </div>

        {err && <ErrorNote message={err} />}
        <div className="flex gap-2">
          <Button disabled={busy || !valid} onClick={save}>{busy ? "Creating…" : `Create ${kind} (${parts.filter((p) => p.detail.trim()).length} parts)`}</Button>
          <Button variant="ghost" onClick={() => router.push("/work")}>Cancel</Button>
        </div>
      </Card>
    </AppShell>
  );
}
