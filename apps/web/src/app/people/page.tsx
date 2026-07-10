"use client";
import Link from "next/link";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { apiGet, useApi } from "@/lib/api";
import { type PartyRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { PartyForm, type PartyFormInitial } from "@/components/PartyForm";
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";

const TYPES = ["writer", "vendor", "partner", "referrer", "client", "employee"] as const;

/**
 * People directory (Phase 3) — full CRUD over every party type (writers, vendors,
 * partners, referrers, …), closing the master-data gap that previously left these
 * creatable only implicitly at job intake. Reuses POST/PATCH /parties.
 */
export default function PeoplePage() {
  const { mutate } = useSWRConfig();
  const [type, setType] = useState<string>("writer");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PartyFormInitial | null>(null);
  const key = `parties?type=${type}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
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
        <h1 className="text-lg font-semibold tracking-tight">People</h1>
        {!creating && !editing && <Button onClick={() => setCreating(true)}>+ New person</Button>}
      </div>

      {(creating || editing) && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">{editing ? "Edit person" : "New person"}</h2>
          <PartyForm
            initial={editing ?? undefined}
            presetType={editing ? undefined : type}
            onSaved={refresh}
            onCancel={() => { setCreating(false); setEditing(null); }}
          />
        </Card>
      )}

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </Select>
          </Field>
          <Field label="Search">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" />
          </Field>
        </div>
      </Card>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <DataTable<PartyRow>
          tableId={`people-${type}`}
          exportName="people"
          rows={data}
          getRowId={(p) => p.id}
          emptyTitle={`No ${type}s found`}
          columns={[
            {
              key: "displayName",
              header: "Name",
              sortable: true,
              value: (p) => p.displayName,
              render: (p) => (
                <Link href={`/people/${p.id}`} className="font-medium text-gold-600 hover:underline dark:text-gold-400">{p.displayName}</Link>
              ),
            },
            {
              key: "partyType",
              header: "Type",
              render: (p) => <span className="flex flex-wrap gap-1">{(p.partyType ?? []).map((t) => <Badge key={t} tone="gray">{t}</Badge>)}</span>,
              value: (p) => (p.partyType ?? []).join(", "),
            },
            { key: "externalRef", header: "Ref", value: (p) => p.externalRef ?? "" },
            {
              key: "actions",
              header: "",
              align: "right",
              render: (p) => (
                <button type="button" onClick={() => void openEdit(p.id)} className="text-xs text-gold-600 hover:underline dark:text-gold-400">
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
