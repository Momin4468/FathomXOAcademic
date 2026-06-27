"use client";
import { useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type Invoice, type PartyRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Select, Spinner, StateBadge } from "@/components/ui";

const STATUSES = ["", "open", "sent", "partial", "paid", "void"];

const searchClients = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?type=client&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.externalRef ?? undefined }));
};

export default function InvoicesPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const qs = new URLSearchParams();
  if (clientFilter) qs.set("clientPartyId", clientFilter);
  if (status) qs.set("status", status);
  const path = `invoices${qs.toString() ? `?${qs}` : ""}`;
  const { data, error, isLoading, mutate } = useApi<Invoice[]>(path);

  const canCreate = can(me?.permissions, "billing:create");
  const [open, setOpen] = useState(false);
  const [newClient, setNewClient] = useState<string | null>(null);
  const [isEstimate, setIsEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newClient) return;
    setBusy(true);
    setFormError("");
    try {
      await apiSend("invoices", "POST", { clientPartyId: newClient, isEstimate });
      setOpen(false);
      setNewClient(null);
      setIsEstimate(false);
      await mutate();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Invoices</h1>
        {canCreate && <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ New invoice"}</Button>}
      </div>

      {open && canCreate && (
        <Card className="mb-5">
          <form onSubmit={create} className="space-y-3">
            <Field label="Client" hint="Pick the client this invoice bills.">
              <EntityPicker placeholder="Search client…" search={searchClients} onPick={(i) => setNewClient(i?.id ?? null)} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={isEstimate} onChange={(e) => setIsEstimate(e.target.checked)} />
              This is an estimate
            </label>
            {formError && <ErrorNote message={formError} />}
            <Button type="submit" disabled={busy || !newClient}>
              {busy ? "Creating…" : "Create invoice"}
            </Button>
          </form>
        </Card>
      )}

      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Filter by client">
            <EntityPicker placeholder="Any client…" search={searchClients} onPick={(i) => setClientFilter(i?.id ?? null)} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s || "Any status"}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No invoices" hint="Bill a job line to start a client's invoice." />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {data.map((inv) => (
            <li key={inv.id}>
              <Link href={`/invoices/${inv.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                <div className="text-sm">
                  <span className="font-medium">
                    <PartyName id={inv.clientPartyId} />
                  </span>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    {formatDate(inv.createdAt)}
                    {inv.isEstimate && <Badge tone="amber">estimate</Badge>}
                    {inv.supersedesInvoiceId && <Badge tone="gray">final</Badge>}
                  </div>
                </div>
                <StateBadge state={inv.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
