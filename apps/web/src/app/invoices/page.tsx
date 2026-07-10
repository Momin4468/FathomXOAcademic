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
import { Badge, Button, Card, Chip, ErrorNote, Field, Money, Select, Spinner } from "@/components/ui";

const STATUSES = ["", "open", "sent", "partial", "paid", "void"];
interface BillableLine { id: string; workItemId: string; title: string; courseCode: string | null; amount: number }

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

  // The client's unbilled work pool (Rule 3) + which lines to bill.
  const { data: billable } = useApi<BillableLine[]>(open && newClient ? `invoices/billable?clientPartyId=${newClient}` : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pickedTotal = (billable ?? []).filter((l) => picked.has(l.id)).reduce((s, l) => s + l.amount, 0);

  async function billSelected() {
    if (!newClient || picked.size === 0) return;
    setBusy(true);
    setFormError("");
    try {
      let invoiceId: string | undefined;
      for (const workLineId of picked) {
        const res = await apiSend<{ invoiceId: string }>("invoices/attach-line", "POST", { workLineId, ...(invoiceId ? { invoiceId } : {}) });
        invoiceId = invoiceId ?? res.invoiceId;
      }
      setOpen(false); setPicked(new Set()); setNewClient(null);
      if (invoiceId) router.push(`/invoices/${invoiceId}`); else await mutate();
    } catch (err) {
      setFormError(bannerMessage(err, "Could not bill the selected lines") ?? "");
    } finally {
      setBusy(false);
    }
  }

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

            {/* Bill from the work pool — the client's unbilled lines (Rule 3). */}
            {newClient && (
              <div className="rounded-lg border border-ink-700 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bill from the work pool</p>
                {!billable ? (
                  <Spinner />
                ) : billable.length === 0 ? (
                  <p className="text-xs text-slate-500">No unbilled work for this client.</p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {billable.map((l) => (
                        <li key={l.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-ink-800/50">
                            <input type="checkbox" checked={picked.has(l.id)} onChange={() => togglePick(l.id)} />
                            {l.courseCode && <Chip>{l.courseCode}</Chip>}
                            <span className="min-w-0 flex-1 truncate">{l.title}</span>
                            <span className="tabular-nums"><Money value={l.amount} /></span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex items-center justify-between border-t border-ink-800 pt-2">
                      <span className="text-xs text-slate-400">{picked.size} selected · <Money value={pickedTotal} /></span>
                      <Button type="button" disabled={busy || picked.size === 0} onClick={() => void billSelected()}>
                        {busy ? "Billing…" : `Bill ${picked.size} item${picked.size === 1 ? "" : "s"}`}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {formError && <ErrorNote message={formError} />}
            <Button type="submit" variant="secondary" disabled={busy || !newClient}>
              {busy ? "Creating…" : "Create empty invoice"}
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
