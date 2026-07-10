"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { apiGet, apiSend, useApi } from "@/lib/api";
import type { RefEntity } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";

const KINDS: Array<{ value: string; label: string }> = [
  { value: "university", label: "Universities" },
  { value: "course", label: "Courses / modules" },
  { value: "assignment_type", label: "Assignment types" },
  { value: "referencing_style", label: "Referencing styles" },
];

/**
 * Reference-data admin (Phase 3) — the canonical master list (universities,
 * courses, assignment types) was previously only fuzzy-created at capture and
 * never manageable. This surfaces list + create + confirm-provisional + add-alias
 * + merge-duplicate over the existing ReferenceService endpoints. (Canonical
 * rename / standalone archive aren't in the API — dedup is done via merge.)
 */
export default function ReferenceDataPage() {
  const { mutate } = useSWRConfig();
  const { toast } = useToast();
  const [kind, setKind] = useState("course");
  const [q, setQ] = useState("");
  const [newRaw, setNewRaw] = useState("");
  const [selected, setSelected] = useState<RefEntity | null>(null);
  const [alias, setAlias] = useState("");
  const [mergeTarget, setMergeTarget] = useState<PickItem | null>(null);
  const [busy, setBusy] = useState(false);

  const key = `reference?kind=${kind}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
  const { data, error, isLoading } = useApi<RefEntity[]>(key);

  const refresh = () => mutate(key);

  async function addNew() {
    const raw = newRaw.trim();
    if (!raw) return;
    setBusy(true);
    try {
      await apiSend("reference/resolve", "POST", { kind, raw });
      setNewRaw("");
      await refresh();
      toast({ title: "Added", description: `"${raw}" is provisional — confirm it to make it canonical.`, variant: "success" });
    } catch (e) {
      toast({ title: "Couldn't add", description: e instanceof Error ? e.message : "", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function confirmEntity() {
    if (!selected) return;
    setBusy(true);
    try {
      await apiSend(`reference/${selected.id}/confirm`, "POST");
      await refresh();
      setSelected({ ...selected, status: "confirmed" });
      toast({ title: "Confirmed", variant: "success" });
    } catch (e) {
      toast({ title: "Couldn't confirm", description: e instanceof Error ? e.message : "", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function addAlias() {
    if (!selected || !alias.trim()) return;
    setBusy(true);
    try {
      await apiSend(`reference/${selected.id}/aliases`, "POST", { alias: alias.trim() });
      setAlias("");
      toast({ title: "Alias added", description: "It now resolves to this entry.", variant: "success" });
    } catch (e) {
      toast({ title: "Couldn't add alias", description: e instanceof Error ? e.message : "", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function mergeInto() {
    if (!selected || !mergeTarget) return;
    setBusy(true);
    try {
      await apiSend("reference/merge", "POST", { sourceId: selected.id, targetId: mergeTarget.id });
      setSelected(null);
      setMergeTarget(null);
      await refresh();
      toast({ title: "Merged", description: `"${selected.canonical}" now resolves to "${mergeTarget.label}".`, variant: "success" });
    } catch (e) {
      toast({ title: "Couldn't merge", description: e instanceof Error ? e.message : "", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const searchSameKind = async (query: string): Promise<PickItem[]> => {
    const rows = await apiGet<RefEntity[]>(`reference?kind=${kind}&q=${encodeURIComponent(query)}`);
    return rows.filter((r) => r.id !== selected?.id).map((r) => ({ id: r.id, label: r.canonical, sub: r.status }));
  };

  return (
    <AppShell>
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Reference data</h1>

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kind">
            <Select value={kind} onChange={(e) => { setKind(e.target.value); setSelected(null); }}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
          <Field label="Search">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or alias…" />
          </Field>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <Field label="Add new (provisional)">
            <Input value={newRaw} onChange={(e) => setNewRaw(e.target.value)} placeholder="e.g. ICT701" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addNew(); } }} />
          </Field>
          <Button type="button" onClick={() => void addNew()} disabled={busy || !newRaw.trim()}>Add</Button>
        </div>
      </Card>

      {selected && (
        <Card className="mb-4 border-gold-400/40">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{selected.canonical}</span>
              <Badge tone={selected.status === "confirmed" ? "green" : "amber"}>{selected.status}</Badge>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:underline">close</button>
          </div>
          <div className="space-y-3">
            {selected.status !== "confirmed" && (
              <Button type="button" variant="secondary" onClick={() => void confirmEntity()} disabled={busy}>Confirm as canonical</Button>
            )}
            <div className="flex items-end gap-2">
              <Field label="Add alias (another spelling)">
                <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. ICT 701" />
              </Field>
              <Button type="button" variant="secondary" onClick={() => void addAlias()} disabled={busy || !alias.trim()}>Add alias</Button>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-300">Merge this into another (kills a duplicate)</span>
              <EntityPicker placeholder="Search the survivor…" search={searchSameKind} onPick={setMergeTarget} />
              <Button type="button" variant="danger" className="mt-2" onClick={() => void mergeInto()} disabled={busy || !mergeTarget}>
                Merge &ldquo;{selected.canonical}&rdquo; into {mergeTarget?.label ?? "…"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (data.length === 0 ? (
        <EmptyState title="Nothing here yet" hint="Add a provisional entry above, or capture one during job intake." />
      ) : (
        <Card>
          <ul className="divide-y divide-ink-800">
            {data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => { setSelected(r); setMergeTarget(null); setAlias(""); }}
                  className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-ink-800"
                >
                  <span className="text-sm">{r.canonical}</span>
                  <Badge tone={r.status === "confirmed" ? "green" : "amber"}>{r.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Showing up to 20 — narrow with search.</p>
        </Card>
      ))}
    </AppShell>
  );
}
