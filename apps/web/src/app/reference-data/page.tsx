"use client";
import { useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { Check } from "lucide-react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { can, type RefEntity, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataGrid, type DataGridColumn } from "@/components/DataGrid";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { Badge, Button, Field, Input } from "@/components/ui";
import { useToast } from "@/components/toast";

/** One flat Academic-directory row (the joined read-model). */
interface AcademicRow {
  id: string;
  code: string;
  course: string | null;
  university: string | null;
  universityId: string | null;
  program: string | null;
  reference: string | null;
  coverSheet: string | null;
  status: string;
}

const searchUniversity = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<RefEntity[]>(`reference?kind=university&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.canonical, sub: r.status }));
};
const createUniversity = async (raw: string): Promise<PickItem> => {
  const res = await apiSend<{ entity: RefEntity }>("reference/resolve", "POST", { kind: "university", raw });
  return { id: res.entity.id, label: res.entity.canonical };
};

/**
 * Academic directory (handoff §13) — the academic source of truth as ONE flat
 * grid: Code · Course · University · Program · Reference format · Cover sheet.
 * Codes are canonical (rename = merge/alias, not a free edit); course name /
 * program / referencing are inline-editable meta. Pre-filled — logging a task
 * picks a code and, if missing, creates it inline. Confirm/merge is steward-gated.
 */
export default function AcademicDirectoryPage() {
  const { mutate } = useSWRConfig();
  const { toast } = useToast();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canEdit = can(me?.permissions, "reference:edit");
  const canApprove = can(me?.permissions, "reference:approve");
  const canCreate = can(me?.permissions, "reference:create");

  const key = "reference/academic";
  const { data: rows, isLoading } = useApi<AcademicRow[]>(key);

  const [newCode, setNewCode] = useState("");
  const [newUni, setNewUni] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const META_KEY: Record<string, "name" | "program" | "referencing"> = { course: "name", program: "program", reference: "referencing" };
  async function onCellEdit(row: AcademicRow, colKey: string, value: string) {
    const metaKey = META_KEY[colKey];
    if (!metaKey) return;
    await apiSend(`reference/${row.id}/meta`, "PATCH", { [metaKey]: value });
    await mutate(key);
  }

  async function confirmCourse(row: AcademicRow) {
    await apiSend(`reference/${row.id}/confirm`, "POST");
    await mutate(key);
    toast({ title: "Confirmed", variant: "success" });
  }

  async function addCourse() {
    if (!newCode.trim() || !newUni) return;
    setBusy(true);
    try {
      await apiSend("reference/resolve", "POST", { kind: "course", raw: newCode.trim(), parentId: newUni });
      setNewCode("");
      await mutate(key);
      toast({ title: "Added", description: `"${newCode.trim()}" is provisional — confirm to make it canonical.`, variant: "success" });
    } catch (e) {
      toast({ title: "Could not add", description: e instanceof Error ? e.message : "", variant: "error" });
    } finally { setBusy(false); }
  }

  const columns: DataGridColumn<AcademicRow>[] = [
    { key: "code", label: "Code", kind: "mono" },
    { key: "course", label: "Course", editable: true },
    { key: "university", label: "University" },
    { key: "program", label: "Program", editable: true },
    { key: "reference", label: "Reference format", editable: true },
    {
      key: "coverSheet", label: "Cover sheet",
      render: (r) => r.coverSheet
        ? <span>{r.coverSheet}</span>
        : <Link href="/cover-sheets" className="text-xs text-gold-600 hover:underline dark:text-gold-400">+ add</Link>,
    },
    { key: "status", label: "Status", align: "center", render: (r) => <Badge tone={r.status === "confirmed" ? "green" : "amber"}>{r.status}</Badge> },
  ];

  const provisional = (rows ?? []).filter((r) => r.status !== "confirmed").length;
  const unis = new Set((rows ?? []).map((r) => r.universityId).filter(Boolean)).size;

  return (
    <AppShell>
      <DataGrid<AcademicRow>
        title="Academic directory"
        sub="The academic source of truth — university, program, code, reference format & cover sheet. Powers task auto-fill; add a missing code inline."
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        isAdmin={canEdit || canCreate}
        loading={isLoading}
        emptyTitle="No courses yet"
        onCellEdit={canEdit ? onCellEdit : undefined}
        rowActions={canApprove ? (r) => (r.status !== "confirmed" ? [{ icon: Check, label: "Confirm", tone: "blue", onClick: confirmCourse }] : []) : undefined}
        stats={[
          { label: "Courses", value: (rows ?? []).length },
          { label: "Universities", value: unis },
          { label: "Provisional", value: provisional, tone: provisional ? "gold" : "neutral" },
        ]}
        addButton="+ Add course"
        addForm={
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Code" hint="e.g. ICT701"><Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Course code" /></Field>
            <div className="min-w-[220px]">
              <Field label="University" hint="Pick or add a provisional one">
                <EntityPicker placeholder="Search university…" search={searchUniversity} onCreate={createUniversity} onPick={(i) => setNewUni(i?.id ?? null)} />
              </Field>
            </div>
            <Button disabled={busy || !newCode.trim() || !newUni} onClick={addCourse}>{busy ? "Adding…" : "Add course"}</Button>
          </div>
        }
        foot="Reference format & cover sheet auto-attach to a task from here. New codes are provisional until a steward confirms them; duplicates are merged (never renamed in place)."
      />
    </AppShell>
  );
}
