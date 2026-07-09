"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, MoneyInput, Money, Spinner } from "@/components/ui";

/**
 * The vendor self-view (audit item 13). Shows ONLY this vendor's own slice —
 * their handoff earnings + balance (chain/client price redacted by RLS) — plus a
 * "submit an invoice" form and the status of their submitted claims.
 */
type VendorHandoff = { id: string; workItemId: string; amount: string; createdAt: string };
type VendorClaim = { id: string; amount: string; note: string | null; status: string; createdAt: string };
interface VendorMe {
  balance: { earnings: { owed: number; paid: number; outstanding: number } };
  handoffs: VendorHandoff[];
  claims: VendorClaim[];
}

export default function VendorMePage() {
  const { data, error, isLoading, mutate } = useApi<VendorMe>("vendor/me");
  const earnings = data?.balance?.earnings;

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">My invoices</h1>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}

      {data && (
        <>
          <Card className="mb-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Your earnings</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">earned</div>
                <div className="font-semibold"><Money value={earnings?.owed} /></div>
              </div>
              <div>
                <div className="text-xs text-gray-500">paid out</div>
                <div className="font-medium"><Money value={earnings?.paid} /></div>
              </div>
              <div>
                <div className="text-xs text-gray-500">outstanding</div>
                <div className="font-medium"><Money value={earnings?.outstanding} /></div>
              </div>
            </div>
          </Card>

          <SubmitClaim onSaved={mutate} />

          <h2 className="mb-2 text-sm font-semibold text-gray-700">Submitted invoices</h2>
          <div className="mb-6">
            <DataTable<VendorClaim>
              tableId="vendor-me-claims"
              exportName="my-claims"
              rows={data.claims}
              getRowId={(c) => c.id}
              emptyTitle="No invoices submitted"
              emptyHint="Submit one above; an admin will review it."
              columns={[
                { key: "amount", header: "Amount", align: "right", sortable: true, format: "money", total: true, value: (c) => (c.amount == null ? "" : Number(c.amount)) },
                { key: "note", header: "Note", filter: "text", value: (c) => c.note ?? "" },
                { key: "createdAt", header: "Date", sortable: true, format: "date", value: (c) => c.createdAt },
                {
                  key: "status",
                  header: "Status",
                  align: "center",
                  sortable: true,
                  filter: "select",
                  filterOptions: ["proposed", "approved", "rejected"],
                  render: (c) => <Badge tone={c.status === "approved" ? "green" : c.status === "rejected" ? "red" : "amber"}>{c.status}</Badge>,
                  value: (c) => c.status,
                },
              ]}
            />
          </div>

          <h2 className="mb-2 text-sm font-semibold text-gray-700">Your handoffs (paid via the ledger)</h2>
          <DataTable<VendorHandoff>
            tableId="vendor-me-handoffs"
            exportName="my-handoffs"
            rows={data.handoffs}
            getRowId={(h) => h.id}
            emptyTitle="No handoffs yet"
            emptyHint="Jobs paid to you will appear here."
            columns={[
              { key: "createdAt", header: "Date", sortable: true, format: "date", value: (h) => h.createdAt },
              { key: "amount", header: "Amount", align: "right", sortable: true, format: "money", total: true, value: (h) => (h.amount == null ? "" : Number(h.amount)) },
            ]}
          />
        </>
      )}
    </AppShell>
  );
}

function SubmitClaim({ onSaved }: { onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0)) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("vendor/claims", "POST", { amount: amt, note: note.trim() || undefined });
      setAmount("");
      setNote("");
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Submit an invoice</p>
      <form onSubmit={submit} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Amount (৳)">
          <MoneyInput value={amount} onChange={(v) => setAmount(v)} />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it's for" />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={busy || !(Number(amount) > 0)}>
            {busy ? "Submitting…" : "Submit invoice"}
          </Button>
        </div>
        {err && <div className="sm:col-span-2"><ErrorNote message={err} /></div>}
      </form>
    </Card>
  );
}
