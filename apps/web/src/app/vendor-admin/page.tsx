"use client";
import { apiSend, useApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { useConfirm } from "@/components/confirm";
import { Badge, cell, DGrid, fmtDay, GhostButton, GoldButton, Loading, money, Note, Page, T } from "@/components/dc";

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
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = useApi<ClaimRow[]>("vendor-admin/claims");

  async function decide(id: string, status: "approved" | "rejected") {
    if (!(await confirm({ title: status === "approved" ? "Approve this claim?" : "Reject this claim?", danger: status === "rejected", confirmLabel: status === "approved" ? "Approve" : "Reject" }))) return;
    await apiSend(`vendor-admin/claims/${id}/decide`, "POST", { status });
    await mutate();
  }

  const total = (data ?? []).reduce((s, c) => s + Number(c.amount || 0), 0);

  return (
    <AppShell>
      <Page title="Vendor claims" sub="approving is a decision only — post the actual payment leg on the job; the vendor sees the status here">
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <DGrid<ClaimRow>
            rows={data}
            keyOf={(c) => c.id}
            cols={[
              { label: "Vendor", render: (c) => cell(c.vendorName ?? c.vendorPartyId, { weight: 500 }) },
              { label: "Amount", align: "right", render: (c) => cell(money(c.amount), { nums: true, weight: 600 }) },
              { label: "Note", render: (c) => <span style={{ color: T.ink2 }}>{c.note ?? "—"}</span> },
              { label: "Date", render: (c) => <span style={{ color: T.muted2 }}>{fmtDay(c.createdAt)}</span> },
              { label: "Status", align: "center", render: (c) => <Badge tone={c.status === "approved" ? "green" : c.status === "rejected" ? "red" : "amber"}>{c.status}</Badge> },
              {
                label: "",
                align: "right",
                render: (c) =>
                  c.status === "proposed" ? (
                    <span style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end" }}>
                      <GoldButton onClick={() => void decide(c.id, "approved")}>Approve</GoldButton>
                      <GhostButton danger onClick={() => void decide(c.id, "rejected")}>Reject</GhostButton>
                    </span>
                  ) : null,
              },
            ]}
            empty="No vendor claims — submitted invoices will appear here."
            foot={<>Total submitted · {money(total)}</>}
          />
        )}
      </Page>
    </AppShell>
  );
}
