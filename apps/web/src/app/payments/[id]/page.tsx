"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { clampAmount, remainingToAllocate } from "@/lib/billing";
import { formatDate, formatMoney } from "@/lib/format";
import { can, type Balance, type Invoice, type InvoiceDetail, type PaymentDetail, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PartyName } from "@/components/PartyName";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Money, Spinner } from "@/components/ui";

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

  async function reverse() {
    const reason = window.prompt("Reason for reversing this payment? (optional)") ?? undefined;
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

  return (
    <AppShell>
      <Link href="/payments" className="mb-3 inline-block text-xs text-gray-500 hover:underline">
        ← Payments
      </Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {!isLoading && !error && !payment && <EmptyState title="Payment not found" />}
      {payment && (
        <div className="space-y-5">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">
                <Money value={payment.amount} />
              </h1>
              <Badge tone={payment.direction === "in" ? "green" : "blue"}>{payment.direction}</Badge>
              {isReversal && <Badge tone="red">reversal</Badge>}
            </div>
            <p className="text-xs text-gray-500">
              {payment.counterpartyPartyId ? <PartyName id={payment.counterpartyPartyId} /> : "no counterparty"} · {formatDate(payment.paidAt)}
              {payment.medium ? ` · ${payment.medium}` : ""}
              {payment.trxId ? ` · ${payment.trxId}` : ""}
            </p>
            {amountVisible && !isReversal && (
              <p className="text-xs text-gray-500">
                Remaining to allocate (this session):{" "}
                <span className={remaining < 0 ? "font-medium text-red-600" : "font-medium text-gray-700"}>
                  <Money value={remaining} />
                </span>
                {remaining < 0 && <span className="ml-1 text-red-600">— exceeds payment amount</span>}
              </p>
            )}
            {canApprove && !isReversal && (
              <div className="pt-1">
                <Button variant="danger" disabled={busy} onClick={reverse}>
                  Reverse payment
                </Button>
              </div>
            )}
            {actionError && <ErrorNote message={actionError} />}
            {okMsg && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{okMsg}</p>}
          </header>

          {!isReversal && canViewBalance && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Allocate</h2>
              {!counterparty ? (
                <EmptyState title="No counterparty on this payment" hint="Allocation targets are derived from the counterparty." />
              ) : loadingTargets ? (
                <Spinner label="Finding targets…" />
              ) : targets.length === 0 ? (
                <EmptyState
                  title={direction === "in" ? "Nothing outstanding for this client" : "No payout target"}
                  hint={direction === "in" ? "No invoice lines or charges with a due." : undefined}
                />
              ) : (
                <div className="space-y-2">
                  {targets.map((t) => (
                    <Card key={t.key} className="flex items-center justify-between gap-3 py-3">
                      <div className="text-sm">
                        <span className="font-medium">{t.label}</span>
                        {t.kind === "charge" && <Badge tone="amber">charge</Badge>}
                        {t.sub && <div className="mt-0.5 text-xs text-gray-500">{t.sub}</div>}
                      </div>
                      <div className="w-32">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0"
                          value={t.amount}
                          disabled={!canCreate}
                          onChange={(e) => setAmount(t.key, e.target.value)}
                          onBlur={() => {
                            // Clamp to the line/charge due if known (UI guard; server is authority).
                            if (t.due !== undefined && Number(t.amount) > 0) {
                              setAmount(t.key, String(clampAmount(t.amount, t.due)));
                            }
                          }}
                        />
                      </div>
                    </Card>
                  ))}
                  {canCreate && (
                    <Button disabled={busy || remaining < 0 || targets.every((t) => Number(t.amount) <= 0)} onClick={allocate}>
                      {busy ? "Allocating…" : "Allocate"}
                    </Button>
                  )}
                  <p className="text-xs text-gray-400">
                    Tick several with partial amounts to split this payment across jobs (or in part within one).
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}
