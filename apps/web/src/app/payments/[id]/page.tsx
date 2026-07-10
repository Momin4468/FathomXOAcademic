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
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, EmptyState, ErrorNote, Money, MoneyInput, Provenance, Spinner, cx } from "@/components/ui";

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

  return (
    <AppShell>
      <Link href="/payments" className="mb-3 inline-block text-xs text-gray-500 hover:underline">
        ← Payments
      </Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {!isLoading && !error && !payment && <EmptyState title="Payment not found" />}
      {payment && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Left — the payment */}
          <Card className="h-fit">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight"><Money value={payment.amount} /></h1>
              <Badge tone={payment.direction === "in" ? "green" : "blue"}>{payment.direction}</Badge>
              {isReversal && <Badge tone="red">reversal</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {counterparty ? <PartyName id={counterparty} /> : "no counterparty"} · {formatDate(payment.paidAt)}
              {payment.medium ? ` · ${payment.medium}` : ""}{payment.trxId ? ` · ${payment.trxId}` : ""}
            </p>
            <Provenance items={[{ label: "Created by", name: payment.createdByName, at: payment.createdAt }]} />
            {amountVisible && !isReversal && (
              <dl className="mt-3 space-y-1 rounded-lg border border-ink-700 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-slate-400">Payment</dt><dd className="tabular-nums"><Money value={payment.amount} /></dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">Allocated</dt><dd className="tabular-nums"><Money value={Number(payment.amount) - remaining} /></dd></div>
                <div className="mt-1 flex justify-between border-t border-ink-700 pt-1 font-semibold"><dt>Unapplied</dt><dd className={cx("tabular-nums", remaining < 0 && "text-red-600 dark:text-red-400")}><Money value={remaining} /></dd></div>
              </dl>
            )}
            {canApprove && !isReversal && <Button variant="danger" className="mt-3 w-full" disabled={busy} onClick={reverse}>Reverse payment</Button>}
            {actionError && <div className="mt-2"><ErrorNote message={actionError} /></div>}
            {okMsg && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{okMsg}</p>}
          </Card>

          {/* Right — match against open items */}
          {!isReversal && canViewBalance && (
            <Card className="p-0 lg:col-span-2">
              <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
                <h2 className="text-sm font-semibold">Match against open items</h2>
                {canCreate && targets.some((t) => t.due != null) && (
                  <Button variant="secondary" className="min-h-0 px-2 py-1 text-xs" onClick={suggestSplit}>Suggest split</Button>
                )}
              </div>
              {!counterparty ? (
                <div className="p-4"><EmptyState title="No counterparty" hint="Open items derive from the counterparty." /></div>
              ) : loadingTargets ? (
                <div className="p-4"><Spinner label="Finding open items…" /></div>
              ) : targets.length === 0 ? (
                <div className="p-4"><EmptyState title={direction === "in" ? "Nothing outstanding for this client" : "No payout target"} /></div>
              ) : (
                <>
                  <ul className="divide-y divide-ink-800">
                    {targets.map((t) => (
                      <li key={t.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0 text-sm">
                          <span className="font-medium">{t.label}</span>{t.kind === "charge" && <Badge tone="amber">charge</Badge>}
                          {t.sub && <div className="text-xs text-slate-500">{t.sub}</div>}
                        </div>
                        <div className="w-28 shrink-0">
                          <MoneyInput placeholder="0" value={t.amount} disabled={!canCreate} onChange={(v) => setAmount(t.key, v)}
                            onBlur={() => { if (t.due !== undefined && Number(t.amount) > 0) setAmount(t.key, String(clampAmount(t.amount, t.due))); }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  {canCreate && (
                    <div className="flex items-center justify-between border-t border-ink-700 px-4 py-2.5">
                      <span className="text-xs text-slate-400">Tick several to split across jobs.</span>
                      <Button disabled={busy || remaining < 0 || targets.every((t) => Number(t.amount) <= 0)} onClick={allocate}>
                        {busy ? "Applying…" : "Apply allocation"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      )}
    </AppShell>
  );
}
