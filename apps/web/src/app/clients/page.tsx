"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { type PartyRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, EmptyState, ErrorNote, Field, Input, Spinner } from "@/components/ui";

export default function ClientsPage() {
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
      {data && data.length === 0 && <EmptyState title="No clients found" />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {data.map((p) => (
            <li key={p.id}>
              <Link href={`/clients/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-gray-50">
                <span className="font-medium">{p.displayName}</span>
                <span className="flex gap-1">{(p.partyType ?? []).map((t) => <Badge key={t} tone="gray">{t}</Badge>)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
