"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { can, type Invoice, type PartyRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { Badge, Button, Card, ErrorNote, Field, Select, Spinner } from "@/components/ui";

const STATUSES = ["", "open", "sent", "partial", "paid", "void"];

const searchClients = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?type=client&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.externalRef ?? undefined }));
};

export default function InvoicesPage() {
  const router = useRouter();
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
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const dirty = !!newClient || isEstimate;
  const { confirmClose } = useUnsavedGuard(dirty);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newClient) return;
    setBusy(true);
    setFormError("");
    setFieldErrs({});
    try {
      await apiSend("invoices", "POST", { clientPartyId: newClient, isEstimate });
      setOpen(false);
      setNewClient(null);
      setIsEstimate(false);
      await mutate();
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setFormError(bannerMessage(err, "Could not create invoice") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Invoices</h1>
        {canCreate && <Button onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ New invoice"}</Button>}
      </div>

      {open && canCreate && (
        <Card className="mb-5">
          <form onSubmit={create} className="space-y-3">
            <Field label="Client" required hint="Pick the client this invoice bills." error={fieldErrs.clientPartyId}>
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
      {data && (
        <DataTable<Invoice>
          tableId="invoices"
          exportName="invoices"
          rows={data}
          getRowId={(inv) => inv.id}
          onRowClick={(inv) => router.push(`/invoices/${inv.id}`)}
          emptyTitle="No invoices"
          emptyHint="Bill a job line to start a client's invoice."
          columns={[
            {
              key: "client",
              header: "Client",
              render: (inv) => <PartyName id={inv.clientPartyId} />,
              value: (inv) => inv.clientPartyId ?? "",
            },
            {
              key: "status",
              header: "Status",
              align: "center",
              sortable: true,
              filter: "select",
              filterOptions: ["open", "sent", "partial", "paid", "void"],
              format: "badge",
              value: (inv) => inv.status,
            },
            {
              key: "estimate",
              header: "Estimate",
              align: "center",
              sortable: true,
              filter: "select",
              filterOptions: ["estimate", "final"],
              render: (inv) => (inv.isEstimate ? <Badge tone="amber">estimate</Badge> : inv.supersedesInvoiceId ? <Badge tone="gray">final</Badge> : <span className="text-gray-400">—</span>),
              value: (inv) => (inv.isEstimate ? "estimate" : inv.supersedesInvoiceId ? "final" : ""),
            },
            { key: "createdAt", header: "Date", sortable: true, format: "date", value: (inv) => inv.createdAt },
          ]}
        />
      )}
    </AppShell>
  );
}
