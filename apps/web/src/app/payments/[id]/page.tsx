"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { clampAmount, remainingToAllocate } from "@/lib/billing";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can, type Balance, type Invoice, type InvoiceDetail, type PaymentDetail, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PartyName } from "@/components/PartyName";
import { useConfirm } from "@/components/confirm";
import { Money, MoneyInput } from "@/components/ui";
import { Badge, Card, EmptyBox, GhostButton, GoldButton, Loading, Note, T } from "@/components/dc";

/** A candidate the payment can be allocated to, with the amount entered so far. */
interface Target {
  key: string;
  kind: "line" | "charge" | "writer";
  id: string;
  label: string;
  sub?: string;
  due?: number; // present for lines/charges
  amount: string;
}

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data, error, isLoading, mutate } = useApi<PaymentDetail>(`payments/${id}`);
  const payment = data?.payment;

  const canCreate = can(me?.permissions, "billing:create");
  const canApprove = can(me?.permissions, "billing:approve");
  const canViewBalance = can(me?.permissions, "billing:view");

  const [targets, setTargets] = useState<Target[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");

  const counterparty = payment?.counterpartyPartyId ?? null;
  const direction = payment?.direction;
  const amountVisible = payment?.amount !== undefined && payment?.amount !== null;
  // Reversal state comes from the explicit link, never from a (possibly hidden) amount.
  const isReversal = !!payment?.reversesPaymentId;

  // Build the guided candidate list from the payment's counterparty + direction.
  const loadTargets = useCallback(async () => {
    // Allocation reads the counterparty's invoices/charges — require billing:view
    // so an unprivileged viewer never triggers a cross-party money fetch.
    if (!payment || !counterparty || !canViewBalance) {
      setTargets([]);
      return;
    }
    setLoadingTargets(true);
    try {
      const next: Target[] = [];
      if (direction === "in") {
        // Client's open invoice lines with an outstanding due.
        const invoices = await apiGet<Invoice[]>(`invoices?clientPartyId=${encodeURIComponent(counterparty)}`);
        const details = await Promise.all(
          invoices.filter((v) => v.status !== "void").map((v) => apiGet<InvoiceDetail>(`invoices/${v.id}`)),
        );
        for (const d of details) {
          for (const l of d.lines) {
            if ((l.due ?? 0) > 0.0001) {
              next.push({
                key: `line:${l.id}`,
                kind: "line",
                id: l.id,
                label: l.note ?? "Billable line",
                sub: `due ${formatMoney(l.due) ?? ""}`,
                due: l.due,
                amount: "",
              });
            }
          }
        }
        // The counterparty's outstanding charges (party→business dues) can also be settled.
        {
          const bal = await apiGet<Balance>(`billing/balance/${encodeURIComponent(counterparty)}`);
          for (const c of bal.charges.items) {
            if ((c.due ?? 0) > 0.0001) {
              next.push({
                key: `charge:${c.id}`,
                kind: "charge",
                id: c.id,
                label: `${c.category} charge`,
                sub: `due ${formatMoney(c.due) ?? ""}`,
                due: c.due,
                amount: "",
              });
            }
          }
        }
      } else if (direction === "out") {
        // Writer side is aggregate — a single payout target.
        next.push({ key: `writer:${counterparty}`, kind: "writer", id: counterparty, label: "Writer payout (aggregate)", amount: "" });
      }
      setTargets(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not load allocation targets");
    } finally {
      setLoadingTargets(false);
    }
  }, [payment, counterparty, direction, canViewBalance]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  const remaining = remainingToAllocate(
    payment?.amount,
    targets.map((t) => t.amount),
  );

  function setAmount(key: string, raw: string) {
    setTargets((ts) => ts.map((t) => (t.key === key ? { ...t, amount: raw } : t)));
  }

  async function allocate() {
    const items = targets
      .filter((t) => Number(t.amount) > 0)
      .map((t) => {
        const amount = Number(t.amount);
        if (t.kind === "line") return { invoiceLineId: t.id, amount };
        if (t.kind === "charge") return { chargeId: t.id, amount };
        return { writerPartyId: t.id, amount };
      });
    if (items.length === 0) return;
    setBusy(true);
    setActionError("");
    setOkMsg("");
    try {
      await apiSend(`payments/${encodeURIComponent(id)}/allocate`, "POST", { items });
      setOkMsg("Allocation recorded.");
      await mutate();
      await loadTargets();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Allocation failed");
    } finally {
      setBusy(false);
    }
  }

  /** Auto-fill the match FIFO up to the payment amount (QuickBooks "suggest"). */
  function suggestSplit() {
    if (payment?.amount == null) return;
    let rem = Number(payment.amount);
    setTargets((ts) =>
      ts.map((t) => {
        if (t.kind === "writer") { const a = rem; rem = 0; return { ...t, amount: a > 0 ? String(Math.round(a * 100) / 100) : "" }; }
        if (t.due == null || rem <= 0) return { ...t, amount: "" };
        const a = Math.min(rem, t.due);
        rem = Math.round((rem - a) * 100) / 100;
        return { ...t, amount: a > 0 ? String(Math.round(a * 100) / 100) : "" };
      }),
    );
  }

  async function reverse() {
    const reason = await confirm({
      title: "Reverse this payment?",
      danger: true,
      confirmLabel: "Reverse",
      reasonField: { label: "Reason (optional)", placeholder: "why…" },
    });
    if (reason === false) return;
    setBusy(true);
    setActionError("");
    try {
      await apiSend(`payments/${encodeURIComponent(id)}/reverse`, "POST", { reason });
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not reverse payment");
    } finally {
      setBusy(false);
    }
  }

  const showRight = !isReversal && canViewBalance;
  const dlRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 13 };

  return (
    <AppShell>
      <div style={{ fontFamily: "Inter, sans-serif", color: T.ink }}>
        <Link href="/payments" style={{ fontSize: 12, fontWeight: 600, color: T.goldDeep, textDecoration: "none" }}>
          ← Payments
        </Link>
        {isLoading && <Loading />}
        {error && <div style={{ marginTop: 12 }}><Note>{error.message}</Note></div>}
        {!isLoading && !error && !payment && <div style={{ marginTop: 12 }}><EmptyBox title="Payment not found" /></div>}
        {payment && (
          <div style={{ marginTop: 12, display: "grid", gap: 20, gridTemplateColumns: showRight ? "minmax(280px, 360px) minmax(0, 1fr)" : "1fr", alignItems: "start" }}>
            {/* Left — the payment */}
            <Card style={{ padding: 16, height: "fit-content", maxWidth: showRight ? undefined : 420 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}><Money value={payment.amount} /></span>
                <Badge tone={payment.direction === "in" ? "green" : "blue"}>{payment.direction}</Badge>
                {isReversal && <Badge tone="red">reversal</Badge>}
              </div>
              <p style={{ marginTop: 4, fontSize: 11.5, color: T.muted2 }}>
                {counterparty ? <PartyName id={counterparty} /> : "no counterparty"} · {formatDate(payment.paidAt)}
                {payment.medium ? ` · ${payment.medium}` : ""}{payment.trxId ? ` · ${payment.trxId}` : ""}
              </p>
              {(payment.createdByName || payment.createdAt) && (
                <div style={{ marginTop: 12, fontSize: 11.5, color: T.muted2, borderTop: `1px solid ${T.hair}`, paddingTop: 8 }}>
                  Created by <span style={{ color: T.ink2 }}>{payment.createdByName ?? "—"}</span>
                  {payment.createdAt ? ` · ${formatDateTime(payment.createdAt)}` : ""}
                </div>
              )}
              {amountVisible && !isReversal && (
                <dl style={{ margin: "12px 0 0", display: "grid", gap: 5, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
                  <div style={dlRow}><dt style={{ color: T.muted }}>Payment</dt><dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}><Money value={payment.amount} /></dd></div>
                  <div style={dlRow}><dt style={{ color: T.muted }}>Allocated</dt><dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}><Money value={Number(payment.amount) - remaining} /></dd></div>
                  <div style={{ ...dlRow, marginTop: 4, borderTop: `1px solid ${T.border}`, paddingTop: 6, fontWeight: 700 }}>
                    <dt>Unapplied</dt><dd style={{ margin: 0, fontVariantNumeric: "tabular-nums", color: remaining < 0 ? T.red : undefined }}><Money value={remaining} /></dd>
                  </div>
                </dl>
              )}
              {canApprove && !isReversal && (
                <div style={{ marginTop: 12 }}>
                  <GhostButton danger disabled={busy} onClick={reverse}>Reverse payment</GhostButton>
                </div>
              )}
              {actionError && <div style={{ marginTop: 8 }}><Note>{actionError}</Note></div>}
              {okMsg && <div style={{ marginTop: 8 }}><Note tone="green">{okMsg}</Note></div>}
            </Card>

            {/* Right — match against open items */}
            {showRight && (
              <Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.eyebrow}` }}>
                  <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Match against open items</h2>
                  {canCreate && targets.some((t) => t.due != null) && (
                    <GhostButton onClick={suggestSplit}>Suggest split</GhostButton>
                  )}
                </div>
                {!counterparty ? (
                  <div style={{ padding: 14 }}><EmptyBox title="No counterparty" hint="Open items derive from the counterparty." /></div>
                ) : loadingTargets ? (
                  <Loading label="Finding open items…" />
                ) : targets.length === 0 ? (
                  <div style={{ padding: 14 }}><EmptyBox title={direction === "in" ? "Nothing outstanding for this client" : "No payout target"} /></div>
                ) : (
                  <>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {targets.map((t) => (
                        <li key={t.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${T.hair}` }}>
                          <div style={{ minWidth: 0, fontSize: 13 }}>
                            <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8 }}>{t.label}{t.kind === "charge" && <Badge tone="amber">charge</Badge>}</span>
                            {t.sub && <div style={{ fontSize: 11.5, color: T.muted2 }}>{t.sub}</div>}
                          </div>
                          <div style={{ width: 112, flexShrink: 0 }}>
                            <MoneyInput placeholder="0" value={t.amount} disabled={!canCreate} onChange={(v) => setAmount(t.key, v)}
                              onBlur={() => { if (t.due !== undefined && Number(t.amount) > 0) setAmount(t.key, String(clampAmount(t.amount, t.due))); }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                    {canCreate && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderTop: `1px solid ${T.eyebrow}` }}>
                        <span style={{ fontSize: 11.5, color: T.muted }}>Tick several to split across jobs.</span>
                        <GoldButton disabled={busy || remaining < 0 || targets.every((t) => Number(t.amount) <= 0)} onClick={allocate}>
                          {busy ? "Applying…" : "Apply allocation"}
                        </GoldButton>
                      </div>
                    )}
                  </>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
