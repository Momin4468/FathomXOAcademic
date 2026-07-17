"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api";
import { type PartyRow, type RefEntity } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { MoneyInput } from "@/components/ui";
import { Badge, Card, Field, GhostButton, GoldButton, money, Note, Page, Pill, T, dcInput } from "@/components/dc";

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

  const partCount = parts.filter((p) => p.detail.trim()).length;

  return (
    <AppShell>
      <Page
        title="Add course / thesis / project"
        sub="one parent, priced by parts — margins derive per part"
      >
        <Card style={{ padding: 16, display: "grid", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {(["course", "thesis", "project"] as const).map((k) => (
              <Pill key={k} active={kind === k} onClick={() => setKind(k)}>
                <span style={{ textTransform: "capitalize" }}>{k}</span>
              </Pill>
            ))}
            <Badge tone="purple">{kind.toUpperCase()}</Badge>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <Field label="Title" required>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. MBA Term 1 — Mujahid" style={dcInput} />
            </Field>
            <Field label="Course code" hint="optional">
              <EntityPicker placeholder="Search course…" search={searchCourse} onPick={(i) => setCourseRefId(i?.id ?? null)} />
            </Field>
            <Field label="Client" hint="optional">
              <EntityPicker placeholder="Search client…" search={searchParty("client")} onPick={(i) => setClientPartyId(i?.id ?? null)} />
            </Field>
            <Field label="Writer" hint="optional">
              <EntityPicker placeholder="Search writer…" search={searchParty("writer")} onPick={(i) => setDoerPartyId(i?.id ?? null)} />
            </Field>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.muted }}>Parts</span>
              <span style={{ fontSize: 11.5, color: T.muted }}>
                Combined client total <strong style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{money(combined)}</strong>
              </span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {parts.map((p, i) => (
                <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.6fr 84px 120px 120px auto", alignItems: "center", border: `1px solid ${T.border}`, borderRadius: 10, padding: 8 }}>
                  <input value={p.detail} onChange={(e) => setPart(i, "detail", e.target.value)} placeholder={`Part ${i + 1} — Assignment 1, Chapter 2…`} style={dcInput} />
                  <input value={p.wordCount} onChange={(e) => setPart(i, "wordCount", e.target.value.replace(/[^\d]/g, ""))} placeholder="Words" inputMode="numeric" style={{ ...dcInput, textAlign: "right" }} />
                  <MoneyInput value={p.clientAmount} onChange={(v) => setPart(i, "clientAmount", v)} />
                  <MoneyInput value={p.writerAmount} onChange={(v) => setPart(i, "writerAmount", v)} />
                  <button type="button" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} disabled={parts.length <= 1}
                    aria-label="Remove part"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 6px", background: "none", border: "none", borderRadius: 8, color: T.muted2, cursor: parts.length <= 1 ? "not-allowed" : "pointer", opacity: parts.length <= 1 ? 0.4 : 1 }}>
                    <Trash2 style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: T.muted2 }}>
              <span onClick={() => setParts((ps) => [...ps, blankPart()])} style={{ fontWeight: 700, color: T.goldDeep, cursor: "pointer" }}>+ add part</span>
              <span>· client ৳ (left) and writer ৳ (right) per part</span>
            </div>
          </div>

          {err && <Note>{err}</Note>}
          <div style={{ display: "flex", gap: 8 }}>
            <GoldButton type="button" disabled={busy || !valid} onClick={save}>{busy ? "Creating…" : `Create ${kind} (${partCount} parts)`}</GoldButton>
            <GhostButton onClick={() => router.push("/work")}>Cancel</GhostButton>
          </div>
        </Card>
      </Page>
    </AppShell>
  );
}
