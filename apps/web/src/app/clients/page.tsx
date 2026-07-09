"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/api";
import { type PartyRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { Badge, Card, ErrorNote, Field, Input, Spinner } from "@/components/ui";

export default function ClientsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const { data, error, isLoading } = useApi<PartyRow[]>(`parties?type=client${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);

  return (
    <AppShell>
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Clients</h1>
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
          ]}
        />
      )}
    </AppShell>
  );
}
