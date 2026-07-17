"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiSend, useApi } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { can, type Invoice, type InvoiceDetail, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PartyName } from "@/components/PartyName";
import { useConfirm } from "@/components/confirm";
import { Money } from "@/components/ui";
import { Badge, Card, EmptyBox, GhostButton, GoldButton, Loading, Note, T, dcInput, type Tone } from "@/components/dc";

const STATUS_TONE: Record<string, Tone> = { open: "gray", sent: "blue", partial: "amber", paid: "green", void: "red" };

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
      <div style={{ fontFamily: "Inter, sans-serif", color: T.ink }}>
        <Link href="/invoices" style={{ fontSize: 12, fontWeight: 600, color: T.goldDeep, textDecoration: "none" }}>
          ← Invoices
        </Link>
        {isLoading && <Loading />}
        {error && <div style={{ marginTop: 12 }}><Note>{error.message}</Note></div>}
        {inv && data && (
          <div style={{ marginTop: 12, display: "grid", gap: 20 }}>
            <header style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 24, fontWeight: 600, margin: 0 }}>
                  <PartyName id={inv.clientPartyId} />
                </h1>
                <Badge tone={STATUS_TONE[inv.status] ?? "gray"}>{inv.status}</Badge>
                {inv.isEstimate && <Badge tone="amber">estimate</Badge>}
                {inv.supersedesInvoiceId && <Badge tone="gray">final</Badge>}
              </div>
              <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>
                {inv.issuedAt ? `issued ${formatDate(inv.issuedAt)}` : "not issued"}
              </p>
              {(inv.createdByName || inv.createdAt) && (
                <div style={{ fontSize: 11.5, color: T.muted2, borderTop: `1px solid ${T.hair}`, paddingTop: 8 }}>
                  Created by <span style={{ color: T.ink2 }}>{inv.createdByName ?? "—"}</span>
                  {inv.createdAt ? ` · ${formatDateTime(inv.createdAt)}` : ""}
                </div>
              )}
              {inv.supersedesInvoiceId && (
                <Link href={`/invoices/${inv.supersedesInvoiceId}`} style={{ fontSize: 12, color: T.muted, textDecoration: "none" }}>
                  ← supersedes an earlier estimate
                </Link>
              )}
              {canEdit && inv.isEstimate && inv.status !== "void" && (
                <div style={{ paddingTop: 2 }}>
                  <GoldButton disabled={busy} onClick={supersede}>
                    {busy ? "Working…" : "Create final from estimate"}
                  </GoldButton>
                </div>
              )}
              {actionError && <Note>{actionError}</Note>}
            </header>

            <section style={{ display: "grid", gap: 10 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Lines</h2>
              {data.lines.length === 0 ? (
                <EmptyBox title="No lines on this invoice" hint="Bill a job line from its job page." />
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {data.lines.map((l) => (
                    <Card key={l.id} style={{ padding: "12px 14px", display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontSize: 13 }}>
                          <span style={{ fontWeight: 600, color: T.ink }}>{l.note ?? "Billable line"}</span>
                          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: "2px 16px", fontSize: 11.5, color: T.muted }}>
                            <span>amount <Money value={l.amount} /></span>
                            <span>paid <Money value={l.paid} /></span>
                            <span style={{ fontWeight: 600, color: T.ink2 }}>due <Money value={l.due} /></span>
                          </div>
                        </div>
                        {canEdit && (
                          <GhostButton onClick={() => setMovingLine(movingLine === l.id ? null : l.id)}>Move</GhostButton>
                        )}
                      </div>
                      {canEdit && movingLine === l.id && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <select
                            defaultValue=""
                            onChange={(e) => e.target.value && moveLine(l.id, e.target.value)}
                            disabled={busy}
                            style={dcInput}
                          >
                            <option value="">Move to invoice…</option>
                            {(siblings ?? [])
                              .filter((s) => s.id !== inv.id && s.status !== "void")
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.isEstimate ? "estimate" : "invoice"} · {s.status} · {formatDate(s.createdAt)}
                                </option>
                              ))}
                          </select>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* Totals block — reads like an invoice document (derived; nothing stored). */}
            {data.lines.length > 0 && (() => {
              const total = data.lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);
              const paid = data.lines.reduce((s, l) => s + Number(l.paid ?? 0), 0);
              const due = data.lines.reduce((s, l) => s + Number(l.due ?? 0), 0);
              const prev = Number(data.previousDue ?? 0);
              const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 13 };
              return (
                <Card style={{ padding: 16, maxWidth: 320, marginLeft: "auto", width: "100%" }}>
                  <dl style={{ margin: 0, display: "grid", gap: 5 }}>
                    <div style={rowStyle}><dt style={{ color: T.muted }}>Invoice total</dt><dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}><Money value={total} /></dd></div>
                    <div style={rowStyle}><dt style={{ color: T.muted }}>Paid</dt><dd style={{ margin: 0, fontVariantNumeric: "tabular-nums", color: T.green }}><Money value={paid} /></dd></div>
                    {prev > 0 && <div style={rowStyle}><dt style={{ color: T.muted }}>Previous due</dt><dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}><Money value={prev} /></dd></div>}
                    <div style={{ ...rowStyle, marginTop: 4, borderTop: `1px solid ${T.border}`, paddingTop: 6, fontWeight: 700 }}>
                      <dt>Balance due</dt><dd style={{ margin: 0, fontVariantNumeric: "tabular-nums", color: T.goldDeep }}><Money value={due + prev} /></dd>
                    </div>
                  </dl>
                </Card>
              );
            })()}
          </div>
        )}
      </div>
    </AppShell>
  );
}
