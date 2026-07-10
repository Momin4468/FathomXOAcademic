"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { apiGet, useApi } from "@/lib/api";
import { type PartyRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { PartyForm, type PartyFormInitial } from "@/components/PartyForm";
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner } from "@/components/ui";

export default function ClientsPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PartyFormInitial | null>(null);
  const key = `parties?type=client${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
  const { data, error, isLoading } = useApi<PartyRow[]>(key);

  function refresh() {
    setCreating(false);
    setEditing(null);
    void mutate(key);
  }
  async function openEdit(id: string) {
    const p = await apiGet<PartyFormInitial>(`parties/${id}`);
    setCreating(false);
    setEditing(p);
  }

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Clients</h1>
        {!creating && !editing && <Button onClick={() => setCreating(true)}>+ New client</Button>}
      </div>

      {(creating || editing) && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">{editing ? "Edit client" : "New client"}</h2>
          <PartyForm
            initial={editing ?? undefined}
            presetType="client"
            onSaved={refresh}
            onCancel={() => { setCreating(false); setEditing(null); }}
          />
        </Card>
      )}

      <Card className="mb-4">
        <Field label="Search">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients by name…" />
        </Field>
      </Card>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <DataTable<PartyRow>
          tableId="clients"
          exportName="clients"
          rows={data}
          getRowId={(p) => p.id}
          onRowClick={(p) => router.push(`/clients/${p.id}`)}
          emptyTitle="No clients found"
          columns={[
            { key: "displayName", header: "Name", sortable: true, value: (p) => p.displayName },
            {
              key: "partyType",
              header: "Type",
              render: (p) => <span className="flex gap-1">{(p.partyType ?? []).map((t) => <Badge key={t} tone="gray">{t}</Badge>)}</span>,
              value: (p) => (p.partyType ?? []).join(", "),
            },
            { key: "externalRef", header: "Ref", value: (p) => p.externalRef ?? "" },
            {
              key: "actions",
              header: "",
              align: "right",
              render: (p) => (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void openEdit(p.id); }}
                  className="text-xs text-gold-600 hover:underline dark:text-gold-400"
                >
                  Edit
                </button>
              ),
            },
          ]}
        />
      )}
    </AppShell>
  );
}
