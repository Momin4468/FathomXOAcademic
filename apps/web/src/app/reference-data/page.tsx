"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { apiSend, useApi } from "@/lib/api";
import { can, type RefEntity, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, Chip, EmptyState, ErrorNote, Field, Input, Spinner, cx } from "@/components/ui";
import { useToast } from "@/components/toast";

/**
 * Academic directory (your chosen structure): universities are the top level, each
 * holding its courses + cover sheets + referencing styles. Pre-filled by the seed
 * so real users just search-and-pick when logging a job ("Other → add" is always
 * available via the job form's picker). New entries are provisional until a
 * data-steward confirms them.
 */
export default function AcademicDirectoryPage() {
  const { mutate } = useSWRConfig();
  const { toast } = useToast();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canApprove = can(me?.permissions, "reference:approve");
  const canCreate = can(me?.permissions, "reference:create");

  const uniKey = "reference?kind=university";
  const courseKey = "reference?kind=course";
  const styleKey = "reference?kind=referencing_style";
  const { data: unis, isLoading } = useApi<RefEntity[]>(uniKey);
  const { data: courses } = useApi<RefEntity[]>(courseKey);
  const { data: styles } = useApi<RefEntity[]>(styleKey);

  const [selId, setSelId] = useState<string | null>(null);
  const sel = (unis ?? []).find((u) => u.id === selId) ?? (unis ?? [])[0] ?? null;
  const selCourses = (courses ?? []).filter((c) => c.parentId === sel?.id);

  const [newUni, setNewUni] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add(kind: string, raw: string, parentId?: string) {
    if (!raw.trim()) return;
    setBusy(true); setErr("");
    try {
      await apiSend("reference/resolve", "POST", { kind, raw: raw.trim(), ...(parentId ? { parentId } : {}) });
      await Promise.all([mutate(uniKey), mutate(courseKey)]);
      toast({ title: "Added", description: `"${raw.trim()}" is provisional — confirm to make it canonical.`, variant: "success" });
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not add"); }
    finally { setBusy(false); }
  }
  async function confirm(id: string, key: string) {
    await apiSend(`reference/${id}/confirm`, "POST");
    await mutate(key);
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Academic directory</h1>
      <p className="mb-4 text-xs text-slate-400">Universities hold their courses, cover sheets, and referencing style. Pre-filled — users just search &amp; pick when logging a job.</p>
      {err && <ErrorNote message={err} />}
      {isLoading && <Spinner />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Universities */}
        <Card className="p-0">
          <h2 className="border-b border-ink-700 px-4 py-2.5 text-sm font-semibold">Universities</h2>
          <ul className="max-h-[60vh] overflow-y-auto">
            {(unis ?? []).map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => setSelId(u.id)}
                  className={cx("flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-ink-800/50", sel?.id === u.id && "bg-gold-400/10")}>
                  <span className="truncate">{u.canonical}</span>
                  {u.status !== "confirmed" && <Badge tone="amber">new</Badge>}
                </button>
              </li>
            ))}
            {(unis ?? []).length === 0 && <li className="px-4 py-4"><EmptyState title="No universities yet" /></li>}
          </ul>
          {canCreate && (
            <div className="flex items-end gap-2 border-t border-ink-700 p-3">
              <Field label="Add a university"><Input value={newUni} onChange={(e) => setNewUni(e.target.value)} placeholder="e.g. UWE Bristol" /></Field>
              <Button type="button" disabled={busy || !newUni.trim()} onClick={() => add("university", newUni).then(() => setNewUni(""))}>Add</Button>
            </div>
          )}
        </Card>

        {/* Selected university → courses + referencing styles */}
        <div className="space-y-5 lg:col-span-2">
          {sel && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{sel.canonical}
                  {sel.status !== "confirmed" && canApprove && <button type="button" onClick={() => void confirm(sel.id, uniKey)} className="ml-2 text-xs text-gold-600 hover:underline dark:text-gold-400">confirm</button>}
                </h2>
              </div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Courses</p>
              {selCourses.length === 0 ? (
                <p className="text-xs text-slate-500">No courses under this university yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {selCourses.map((c) => (
                    <li key={c.id}><span className="inline-flex items-center gap-1"><Chip>{c.canonical}</Chip>{c.status !== "confirmed" && canApprove && <button type="button" onClick={() => void confirm(c.id, courseKey)} className="text-[10px] text-gold-600 hover:underline dark:text-gold-400">✓</button>}</span></li>
                  ))}
                </ul>
              )}
              {canCreate && (
                <div className="mt-3 flex items-end gap-2">
                  <Field label="Add a course to this university"><Input value={newCourse} onChange={(e) => setNewCourse(e.target.value)} placeholder="e.g. ICT701" /></Field>
                  <Button type="button" disabled={busy || !newCourse.trim()} onClick={() => add("course", newCourse, sel.id).then(() => setNewCourse(""))}>Add</Button>
                </div>
              )}
              <p className="mt-4 text-xs text-slate-500">Cover sheets for this university live under <a href="/cover-sheets" className="text-gold-600 hover:underline dark:text-gold-400">Cover sheets</a>.</p>
            </Card>
          )}

          <Card>
            <h2 className="mb-2 text-sm font-semibold">Referencing styles</h2>
            {!styles || styles.length === 0 ? (
              <p className="text-xs text-slate-500">None yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">{styles.map((s) => <li key={s.id}><Chip>{s.canonical}</Chip></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
