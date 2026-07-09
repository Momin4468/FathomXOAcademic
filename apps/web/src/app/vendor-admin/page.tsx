"use client";
import { apiSend, useApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { Badge, Button, ErrorNote, Money, Spinner } from "@/components/ui";

/**
 * Admin review queue for vendor-submitted invoices (audit item 13). Approve/reject
 * is a governance decision; the actual business→vendor leg is posted in the job
 * flow (chain context), keeping the money ledger unconflated.
 */
interface ClaimRow {
  id: string;
  vendorPartyId: string;
  vendorName: string | null;
  amount: string;
  note: string | null;
  status: string;
  createdAt: string;
}

export default function VendorAdminPage() {
  const { data, error, isLoading, mutate } = useApi<ClaimRow[]>("vendor-admin/claims");

  async function decide(id: string, status: "approved" | "rejected") {
    await apiSend(`vendor-admin/claims/${id}/decide`, "POST", { status });
    await mutate();
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Vendor claims</h1>
      <p className="mb-5 text-xs text-gray-500">
        Approving is a decision only — post the actual payment leg on the job. The vendor sees the status here.
      </p>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <DataTable<ClaimRow>
          tableId="vendor-admin-claims"
          exportName="vendor-claims"
          rows={data}
          getRowId={(c) => c.id}
          emptyTitle="No vendor claims"
          emptyHint="Submitted invoices will appear here."
          columns={[
            { key: "vendor", header: "Vendor", sortable: true, value: (c) => c.vendorName ?? c.vendorPartyId },
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
              render: (c) =>
                c.status === "proposed" ? (
                  <Badge tone="amber">proposed</Badge>
                ) : (
                  <Badge tone={c.status === "approved" ? "green" : "red"}>{c.status}</Badge>
                ),
              value: (c) => c.status,
            },
            {
              key: "action",
              header: "",
              align: "right",
              render: (c) =>
                c.status === "proposed" ? (
                  <span className="flex items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        decide(c.id, "approved");
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        decide(c.id, "rejected");
                      }}
                    >
                      Reject
                    </Button>
                  </span>
                ) : null,
            },
          ]}
        />
      )}
    </AppShell>
  );
}
