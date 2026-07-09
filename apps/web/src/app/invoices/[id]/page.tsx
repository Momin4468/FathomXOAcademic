"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type Invoice, type InvoiceDetail, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PartyName } from "@/components/PartyName";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, EmptyState, ErrorNote, Money, Select, Spinner, StateBadge } from "@/components/ui";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const router = useRouter();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data, error, isLoading, mutate } = useApi<InvoiceDetail>(`invoices/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [movingLine, setMovingLine] = useState<string | null>(null);

  const canEdit = can(me?.permissions, "billing:edit");
  const inv = data?.invoice;

  // Sibling invoices for the same client (move-line targets).
  const { data: siblings } = useApi<Invoice[]>(inv ? `invoices?clientPartyId=${encodeURIComponent(inv.clientPartyId)}` : null);

  async function supersede() {
    if (!(await confirm({ title: "Create a final invoice from this estimate?", danger: true, confirmLabel: "Create final" }))) return;
    setBusy(true);
    setActionError("");
    try {
      const final = await apiSend<Invoice>(`invoices/${encodeURIComponent(id)}/supersede`, "POST");
      router.push(`/invoices/${final.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not create final");
      setBusy(false);
    }
  }

  async function moveLine(invoiceLineId: string, targetInvoiceId: string) {
    if (!(await confirm({ title: "Move this line to another invoice?", danger: true, confirmLabel: "Move" }))) return;
    setBusy(true);
    setActionError("");
    try {
      await apiSend("invoices/move-line", "POST", { invoiceLineId, targetInvoiceId });
      setMovingLine(null);
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not move line");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <Link href="/invoices" className="mb-3 inline-block text-xs text-gray-500 hover:underline">
        ← Invoices
      </Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {inv && data && (
        <div className="space-y-5">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">
                <PartyName id={inv.clientPartyId} />
              </h1>
              <StateBadge state={inv.status} />
              {inv.isEstimate && <Badge tone="amber">estimate</Badge>}
              {inv.supersedesInvoiceId && <Badge tone="gray">final</Badge>}
            </div>
            <p className="text-xs text-gray-500">
              created {formatDate(inv.createdAt)}
              {inv.issuedAt ? ` · issued ${formatDate(inv.issuedAt)}` : ""}
            </p>
            {inv.supersedesInvoiceId && (
              <Link href={`/invoices/${inv.supersedesInvoiceId}`} className="text-xs text-gray-500 hover:underline">
                ← supersedes an earlier estimate
              </Link>
            )}
            {canEdit && inv.isEstimate && inv.status !== "void" && (
              <div className="pt-1">
                <Button disabled={busy} onClick={supersede}>
                  {busy ? "Working…" : "Create final from estimate"}
                </Button>
              </div>
            )}
            {actionError && <ErrorNote message={actionError} />}
          </header>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Lines</h2>
            {data.lines.length === 0 ? (
              <EmptyState title="No lines on this invoice" hint="Bill a job line from its job page." />
            ) : (
              <ul className="space-y-2">
                {data.lines.map((l) => (
                  <Card key={l.id} className="space-y-2 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">
                        <span className="font-medium text-gray-800">{l.note ?? "Billable line"}</span>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                          <span>
                            amount <Money value={l.amount} />
                          </span>
                          <span>
                            paid <Money value={l.paid} />
                          </span>
                          <span className="font-medium text-gray-700">
                            due <Money value={l.due} />
                          </span>
                        </div>
                      </div>
                      {canEdit && (
                        <Button variant="ghost" className="px-2 text-xs" onClick={() => setMovingLine(movingLine === l.id ? null : l.id)}>
                          Move
                        </Button>
                      )}
                    </div>
                    {canEdit && movingLine === l.id && (
                      <div className="flex items-center gap-2">
                        <Select
                          defaultValue=""
                          onChange={(e) => e.target.value && moveLine(l.id, e.target.value)}
                          disabled={busy}
                        >
                          <option value="">Move to invoice…</option>
                          {(siblings ?? [])
                            .filter((s) => s.id !== inv.id && s.status !== "void")
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.isEstimate ? "estimate" : "invoice"} · {s.status} · {formatDate(s.createdAt)}
                              </option>
                            ))}
                        </Select>
                      </div>
                    )}
                  </Card>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
