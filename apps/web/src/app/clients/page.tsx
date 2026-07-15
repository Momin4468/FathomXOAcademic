"use client";
import { useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { Pencil } from "lucide-react";
import { apiGet, useApi } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataGrid, type DataGridColumn } from "@/components/DataGrid";
import { PartyForm, type PartyFormInitial } from "@/components/PartyForm";
import { Card, Money } from "@/components/ui";

/** A client directory row (the batched read-model with masked contact + AR). */
interface ClientRow {
  id: string;
  displayName: string;
  externalRef: string | null;
  programme: string | null;
  university: string | null;
  addedBy: string | null;
  contact: string | null;
  contactMasked: boolean;
  expected: number;
  paid: number;
  remaining: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Clients directory (handoff §10) — a shared grid: name · university/programme ·
 * student ID · contact (server-side MASKED unless you're granted) · added-by
 * (admin-only) · expected/paid/remaining (derived AR). The client name links to
 * the Client 360. Writers never reach this (no reference:view); a plain viewer
 * sees masked contacts.
 */
export default function ClientsPage() {
  const { mutate } = useSWRConfig();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canEdit = can(me?.permissions, "reference:edit");
  const canCreate = can(me?.permissions, "reference:create");

  const key = "parties/clients";
  const { data: rows, isLoading } = useApi<ClientRow[]>(key);
  const [editing, setEditing] = useState<PartyFormInitial | null>(null);

  async function openEdit(id: string) {
    const p = await apiGet<PartyFormInitial>(`parties/${id}`);
    setEditing(p);
  }
  function refresh() { setEditing(null); void mutate(key); }

  const columns: DataGridColumn<ClientRow>[] = [
    { key: "displayName", label: "Client", render: (r) => <Link href={`/clients/${r.id}`} className="font-medium text-gold-600 hover:underline dark:text-gold-400">{r.displayName}</Link> },
    { key: "university", label: "University / programme", render: (r) => <span>{[r.university, r.programme].filter(Boolean).join(" · ") || <span className="text-slate-500">—</span>}</span> },
    { key: "externalRef", label: "Student ID", kind: "mono" },
    { key: "contact", label: "Contact", render: (r) => r.contactMasked ? <span className="text-xs text-slate-500">🔒 masked</span> : (r.contact ?? <span className="text-slate-500">—</span>) },
    { key: "addedBy", label: "Added by", adminOnly: true },
    { key: "expected", label: "Expected", kind: "money", align: "right" },
    { key: "paid", label: "Paid", kind: "money", align: "right" },
    { key: "remaining", label: "Remaining", kind: "money", align: "right" },
  ];

  const totals = (rows ?? []).reduce((a, r) => ({ e: a.e + r.expected, p: a.p + r.paid, o: a.o + r.remaining }), { e: 0, p: 0, o: 0 });

  return (
    <AppShell>
      {editing && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">Edit client</h2>
          <PartyForm initial={editing} onSaved={refresh} onCancel={() => setEditing(null)} />
        </Card>
      )}
      <DataGrid<ClientRow>
        title="Clients"
        sub="Shared directory — name, university & student ID visible to all; contact masked until granted. Money is derived from invoices − payments."
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        isAdmin={canEdit || canCreate}
        loading={isLoading}
        emptyTitle="No clients yet"
        rowActions={canEdit ? () => [{ icon: Pencil, label: "Edit", onClick: (r: ClientRow) => void openEdit(r.id) }] : undefined}
        stats={[
          { label: "Total expected", value: <Money value={round2(totals.e)} /> },
          { label: "Collected", value: <Money value={round2(totals.p)} />, tone: "green" },
          { label: "Outstanding", value: <Money value={round2(totals.o)} />, tone: totals.o > 0 ? "red" : "neutral" },
        ]}
        addButton="+ Add client"
        addForm={<PartyForm presetType="client" onSaved={refresh} onCancel={() => { /* DataGrid closes on toggle */ }} />}
        foot="Writers, partners, vendors and admins can all log a client. Phone & email are hidden from viewers without contact access."
      />
    </AppShell>
  );
}
