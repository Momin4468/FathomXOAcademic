"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, useApi } from "@/lib/api";
import { can, type WhoAmI, type WorkListRow } from "@/lib/types";
import { PartyName } from "./PartyName";
import { Badge, Button, Card, Chip, EmptyState, ErrorNote, Money, Select, Spinner, StateBadge, cx } from "./ui";

type GroupKey = "none" | "course" | "client" | "writer";
type View = "grid" | "board";
const WORK_STATES = ["draft", "pending", "confirmed", "delivered"] as const;
const NEXT: Record<string, string | undefined> = { draft: "pending", pending: "confirmed", confirmed: "delivered" };

/** Inline number/text cell — click to edit, Enter/blur to save, Esc to cancel. */
function EditCell({ value, onSave, kind = "text", canEdit, className }: {
  value: string | number | null | undefined;
  onSave: (v: string) => Promise<void> | void;
  kind?: "text" | "number";
  canEdit: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = value == null || value === "" ? "—" : String(value);
  if (!canEdit) return <span className={className}>{shown}</span>;
  if (!editing) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); setV(value == null ? "" : String(value)); setEditing(true); }}
        className={cx("rounded px-1 text-left hover:bg-gold-400/10 hover:ring-1 hover:ring-gold-400/40", className)}>
        {shown}
      </button>
    );
  }
  const commit = async () => {
    setBusy(true);
    try { await onSave(v.trim()); } finally { setBusy(false); setEditing(false); }
  };
  return (
    <input autoFocus disabled={busy} value={v} inputMode={kind === "number" ? "decimal" : undefined}
      onChange={(e) => setV(kind === "number" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") setEditing(false); }}
      onBlur={() => void commit()}
      className={cx("w-full rounded border border-gold-400 bg-ink-850 px-1 text-sm text-slate-100 outline-none", className)} />
  );
}

function groupRows(rows: WorkListRow[], key: GroupKey) {
  if (key === "none") return [{ id: "all", label: "", rows }];
  const map = new Map<string, WorkListRow[]>();
  for (const r of rows) {
    const gid = key === "course" ? (r.courseCode ?? "—") : key === "client" ? (r.clientPartyId ?? r.sourcePartyId ?? "—") : (r.doerPartyId ?? "—");
    (map.get(gid) ?? map.set(gid, []).get(gid)!).push(r);
  }
  return [...map.entries()].map(([id, rs]) => ({ id, label: id, rows: rs, key }));
}
const sum = (rs: WorkListRow[], f: (r: WorkListRow) => number | null | undefined) => rs.reduce((s, r) => s + (Number(f(r)) || 0), 0);

export function WorkBoard() {
  const router = useRouter();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const perms = me?.permissions;
  const canMoney = can(perms, "work:approve");
  const canEdit = can(perms, "work:edit");
  // Approvers see the whole board; a writer sees only their own jobs (§4.5).
  const listPath = !me ? null : canMoney ? "work" : me.party?.id ? `work?doerPartyId=${me.party.id}` : "work";
  const { data, error, isLoading, mutate } = useApi<WorkListRow[]>(listPath);
  const [groupBy, setGroupBy] = useState<GroupKey>("course");
  const [view, setView] = useState<View>("grid");
  const [q, setQ] = useState("");
  const [actionErr, setActionErr] = useState("");

  const rows = useMemo(() => {
    const list = data ?? [];
    const query = q.trim().toLowerCase();
    return query ? list.filter((r) => `${r.title} ${r.courseCode ?? ""} ${r.doerName ?? ""}`.toLowerCase().includes(query)) : list;
  }, [data, q]);
  const groups = useMemo(() => groupRows(rows, groupBy), [rows, groupBy]);

  async function patchLine(lineId: string | null | undefined, body: Record<string, unknown>) {
    if (!lineId) return;
    setActionErr("");
    try { await apiSend(`work/lines/${lineId}`, "PATCH", body); await mutate(); }
    catch (e) { setActionErr(e instanceof Error ? e.message : "Could not save"); }
  }
  async function patchJob(id: string, body: Record<string, unknown>) {
    setActionErr("");
    try { await apiSend(`work/${id}`, "PATCH", body); await mutate(); }
    catch (e) { setActionErr(e instanceof Error ? e.message : "Could not save"); }
  }
  async function advance(row: WorkListRow) {
    const to = NEXT[row.workState];
    if (!to) return;
    setActionErr("");
    try { await apiSend(`work/${row.id}/transition`, "POST", { toState: to }); await mutate(); }
    catch (e) { setActionErr(e instanceof Error ? e.message : "Action failed"); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs…"
          className="min-h-[38px] w-full max-w-xs rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400 sm:w-56" />
        <label className="flex items-center gap-1.5 text-xs text-slate-400">Group
          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupKey)} className="min-h-[38px] w-auto">
            <option value="course">Course</option><option value="client">Client</option><option value="writer">Writer</option><option value="none">None</option>
          </Select>
        </label>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-ink-700 p-0.5">
          {(["grid", "board"] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={cx("rounded-md px-2.5 py-1 text-xs capitalize", view === v ? "bg-gold-400 text-ink-950" : "text-slate-300 hover:bg-ink-800")}>
              {v === "board" ? "Kanban" : "Grid"}
            </button>
          ))}
        </div>
      </div>
      {actionErr && <ErrorNote message={actionErr} />}
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}

      {data && (rows.length === 0 ? (
        <EmptyState title="No jobs" hint="Log one to get started." />
      ) : view === "grid" ? (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-700 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Assignment</th>
                  <th className="px-3 py-2 font-medium">Size @ rate</th>
                  <th className="px-3 py-2 font-medium">Writer</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                  {!canMoney && <th className="px-3 py-2 text-right font-medium">My fee</th>}
                  {canMoney && <th className="px-3 py-2 text-right font-medium">Client</th>}
                  {canMoney && <th className="px-3 py-2 text-right font-medium">Margin</th>}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.id} className="border-b border-ink-800 last:border-0">
                  {groupBy !== "none" && (
                    <tr className="bg-ink-800/60 text-xs font-medium">
                      <td colSpan={5} className="px-3 py-1.5">
                        {groupBy === "course" ? <Chip>{g.label}</Chip> : <PartyName id={g.label} />}
                        <span className="ml-2 text-slate-500">{g.rows.length} job{g.rows.length === 1 ? "" : "s"}</span>
                      </td>
                      {!canMoney && <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400"><Money value={sum(g.rows, (r) => r.myFee)} /></td>}
                      {canMoney && <td className="px-3 py-1.5 text-right tabular-nums"><Money value={sum(g.rows, (r) => r.clientAmount)} /></td>}
                      {canMoney && <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400"><Money value={sum(g.rows, (r) => r.margin)} /></td>}
                    </tr>
                  )}
                  {g.rows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/work/${r.id}`)} className="cursor-pointer border-t border-ink-800/60 hover:bg-ink-800/40">
                      <td className="px-3 py-2">{r.courseCode ? <Chip>{r.courseCode}</Chip> : <span className="text-slate-500">—</span>}</td>
                      <td className="px-3 py-2"><EditCell value={r.title} canEdit={canEdit} onSave={(v) => patchJob(r.id, { title: v })} className="font-medium" /></td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        <EditCell value={r.wordCount} kind="number" canEdit={canEdit && !!r.consumerLineId} onSave={(v) => patchLine(r.consumerLineId, { wordCount: Number(v) })} />
                        {" "}{r.unitLabel ?? "words"}
                        {canMoney && (<> @ <EditCell value={r.clientRate ? Number(r.clientRate) : null} kind="number" canEdit={canEdit && !!r.consumerLineId} onSave={(v) => patchLine(r.consumerLineId, { clientRate: Number(v) })} /></>)}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.doerName ?? <span className="text-slate-500">—</span>}</td>
                      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-1">
                          <StateBadge state={r.workState} />
                          {canEdit && NEXT[r.workState] && (
                            <button type="button" onClick={() => void advance(r)} title={`Mark ${NEXT[r.workState]}`} className="text-xs text-gold-600 hover:underline dark:text-gold-400">→</button>
                          )}
                        </span>
                      </td>
                      {!canMoney && <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400"><Money value={r.myFee} /></td>}
                      {canMoney && <td className="px-3 py-2 text-right tabular-nums"><Money value={r.clientAmount} /></td>}
                      {canMoney && <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400"><Money value={r.margin} /></td>}
                    </tr>
                  ))}
                </tbody>
              ))}
              {canMoney && (
                <tfoot className="border-t border-ink-700 bg-ink-800/60 text-sm font-medium">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right text-xs text-slate-500">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums"><Money value={sum(rows, (r) => r.clientAmount)} /></td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400"><Money value={sum(rows, (r) => r.margin)} /></td>
                  </tr>
                </tfoot>
              )}
              {!canMoney && (
                <tfoot className="border-t border-ink-700 bg-ink-800/60 text-sm font-medium">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right text-xs text-slate-500">You&apos;re owed</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400"><Money value={sum(rows, (r) => r.myFee)} /></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {WORK_STATES.map((st) => {
            const col = rows.filter((r) => r.workState === st);
            return (
              <div key={st} className="rounded-xl border border-ink-700 bg-ink-850">
                <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
                  <span className="text-sm font-semibold capitalize">{st}</span>
                  <span className="text-xs text-slate-500">{col.length}{canMoney ? ` · ` : ""}{canMoney && <Money value={sum(col, (r) => r.margin)} />}</span>
                </div>
                <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
                  {col.map((r) => (
                    <button key={r.id} type="button" onClick={() => router.push(`/work/${r.id}`)} className="block w-full rounded-lg border border-ink-800 bg-ink-900/40 p-2 text-left text-sm hover:border-gold-400/40">
                      <div className="flex items-center gap-2">{r.courseCode && <Chip>{r.courseCode}</Chip>}<span className="truncate font-medium">{r.title}</span></div>
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                        <span>{r.doerName ?? "—"}</span>
                        {canMoney && <span className="tabular-nums">margin <Money value={r.margin} /></span>}
                      </div>
                    </button>
                  ))}
                  {col.length === 0 && <p className="px-1 py-3 text-center text-xs text-slate-500">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
