"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  can,
  type PartyDetail,
  type VaultItem,
  type WhoAmI,
  type WorkListRow,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, Chip, EmptyState, ErrorNote, Money, MoneyInput, Spinner, StateBadge } from "@/components/ui";

interface ClientAr { billed: number; collected: number; outstanding: number; openLines: Array<{ invoiceLineId: string; due: number }> }
interface PaymentRow { id: string; direction: string; amount: string; paidAt: string; medium: string | null; reversesPaymentId?: string | null }
interface BillableLine { id: string; workItemId: string; title: string; courseCode: string | null; amount: number }
interface InvoiceModalLine { id: string; note: string | null; amount: string | number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Client 360 (the "Mujahid" layout). Left: jobs as spreadsheet-style rows —
 * course-code chip, words @ rate, status, client amount, writer, and the DERIVED
 * margin (money-gated, §4.4). Right: a Billed/Collected/Outstanding card + an
 * inline "record a payment" that FIFO-allocates against the client's open invoice
 * lines (QuickBooks "receive payment"). Every money figure is redaction-safe.
 */
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const perms = me?.permissions;
  const canMoney = can(perms, "billing:view");
  const canBill = can(perms, "billing:create");

  const canPortal = can(perms, "client_portal:view");
  const { data: party, error, isLoading } = useApi<PartyDetail>(`parties/${id}`);
  const { data: accounts } = useApi<Array<{ id: string; partyId: string; loginId: string; status: string }>>(canPortal ? "client-portal/accounts" : null);
  const portal = (accounts ?? []).find((a) => a.partyId === id);
  const { data: jobs, mutate: mutateJobs } = useApi<WorkListRow[]>(can(perms, "work:view") ? `work?sourcePartyId=${id}` : null);
  const { data: ar, mutate: mutateAr } = useApi<ClientAr>(canMoney ? `billing/client/${id}/ar` : null);
  const { data: payments, mutate: mutatePayments } = useApi<PaymentRow[]>(canMoney ? `payments?counterpartyPartyId=${id}` : null);
  const { data: billable, mutate: mutateBillable } = useApi<BillableLine[]>(canBill ? `invoices/billable?clientPartyId=${id}` : null);
  const { data: creds } = useApi<VaultItem[]>(can(perms, "credential_vault:view") ? `vault/items?clientPartyId=${id}` : null);

  const [amount, setAmount] = useState("");
  const [medium, setMedium] = useState("Bank");
  const [busy, setBusy] = useState(false);
  const [payErr, setPayErr] = useState("");
  // Invoice-from-lines popup (handoff §11): pick billable lines → one invoice → a
  // screenshot-ready document.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [invModal, setInvModal] = useState<{ lines: InvoiceModalLine[]; total: number } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const toggleSel = (lineId: string) => setSel((p) => { const n = new Set(p); if (n.has(lineId)) n.delete(lineId); else n.add(lineId); return n; });

  async function genInvoice() {
    if (sel.size === 0) return;
    setGenBusy(true);
    setPayErr("");
    try {
      const inv = await apiSend<{ lines: InvoiceModalLine[] }>("invoices/from-lines", "POST", { clientPartyId: id, workLineIds: [...sel] });
      const total = round2(inv.lines.reduce((a, l) => a + Number(l.amount), 0));
      setInvModal({ lines: inv.lines, total });
      setSel(new Set());
      await Promise.all([mutateAr(), mutateBillable(), mutateJobs(), mutatePayments()]);
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : "Could not generate invoice");
    } finally { setGenBusy(false); }
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0)) return;
    setBusy(true);
    setPayErr("");
    try {
      const pay = await apiSend<{ id: string }>("payments", "POST", {
        direction: "in",
        counterpartyPartyId: id,
        amount: amt,
        medium,
        paidAt: new Date().toISOString().slice(0, 10),
      });
      // FIFO-allocate against the client's oldest open invoice lines.
      const items: Array<{ invoiceLineId: string; amount: number }> = [];
      let rem = amt;
      for (const l of ar?.openLines ?? []) {
        if (rem <= 0) break;
        const a = round2(Math.min(rem, l.due));
        if (a > 0) { items.push({ invoiceLineId: l.invoiceLineId, amount: a }); rem = round2(rem - a); }
      }
      if (items.length) await apiSend(`payments/${pay.id}/allocate`, "POST", { items });
      setAmount("");
      await Promise.all([mutateAr(), mutatePayments()]);
    } catch (err) {
      setPayErr(err instanceof Error ? err.message : "Could not record payment");
    } finally {
      setBusy(false);
    }
  }

  const initial = (party?.displayName ?? "?").trim()[0]?.toUpperCase() ?? "?";

  return (
    <AppShell>
      <Link href="/clients" className="mb-3 inline-block text-xs text-slate-400 hover:underline">‹ All clients</Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {party && (
        <div className="space-y-5">
          {/* header */}
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-ink-800 text-lg font-semibold text-slate-200">{initial}</span>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">{party.displayName}</h1>
                <p className="mt-0.5 text-xs text-slate-400">
                  {[party.universityCanonical, party.programme, party.externalRef ? `ID ${party.externalRef}` : null, party.referredByName ? `referral ${party.referredByName}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canBill && <Link href="/invoices"><Button variant="secondary">Create invoice</Button></Link>}
              {can(perms, "work:create") && <Link href="/work/new"><Button>+ Add job</Button></Link>}
            </div>
          </header>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Jobs & work lines */}
            <section className="lg:col-span-2">
              <Card className="p-0">
                <h2 className="border-b border-ink-700 px-4 py-2.5 text-sm font-semibold">Jobs &amp; work lines</h2>
                {!jobs || jobs.length === 0 ? (
                  <div className="p-4"><EmptyState title="No jobs yet" hint="Add a job to get started." /></div>
                ) : (
                  <ul className="divide-y divide-ink-800">
                    {jobs.map((j) => (
                      <li key={j.id}>
                        <Link href={`/work/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-ink-800/60">
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              {j.courseCode && <Chip>{j.courseCode}</Chip>}
                              <span className="truncate font-medium">{j.title}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-400">
                              {[j.wordCount ? `${j.wordCount} words` : null, j.clientRate ? `@ ${Number(j.clientRate)}` : null].filter(Boolean).join(" ")}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            <StateBadge state={j.workState} />
                            {canMoney && j.clientAmount != null && (
                              <span className="w-24 text-right font-medium"><Money value={j.clientAmount} /></span>
                            )}
                            {j.doerName && <span className="hidden w-20 truncate text-right text-xs text-slate-400 sm:inline">{j.doerName}</span>}
                            {canMoney && j.margin != null && (
                              <span className="w-24 text-right text-xs text-emerald-600 dark:text-emerald-400">margin <Money value={j.margin} /></span>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* Money column */}
            {canMoney && (
              <section className="space-y-4">
                <Card className="bg-nav-surface text-nav-bright">
                  <div className="flex items-center justify-between text-sm text-nav-muted"><span>Billed</span><span className="tabular-nums text-nav-bright"><Money value={ar?.billed ?? 0} /></span></div>
                  <div className="mt-1 flex items-center justify-between text-sm text-nav-muted"><span>Collected</span><span className="tabular-nums text-emerald-300"><Money value={ar?.collected ?? 0} /></span></div>
                  <div className="mt-3 border-t border-nav-border pt-3">
                    <div className="text-xs text-nav-muted">Outstanding</div>
                    <div className="text-2xl font-semibold tabular-nums text-gold-400"><Money value={ar?.outstanding ?? 0} /></div>
                  </div>
                </Card>

                {canBill && (
                  <Card>
                    <h2 className="mb-3 text-sm font-semibold">Record a payment</h2>
                    <form onSubmit={addPayment} className="space-y-3">
                      <div className="flex gap-2">
                        <div className="flex-1"><MoneyInput value={amount} onChange={setAmount} /></div>
                        <select value={medium} onChange={(e) => setMedium(e.target.value)} className="min-h-[44px] rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-slate-100 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400">
                          {["Bank", "Bkash", "Nagad", "DBBL", "MTB", "USDT", "cash"].map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      {payErr && <ErrorNote message={payErr} />}
                      <Button type="submit" className="w-full" disabled={busy || !(Number(amount) > 0)}>{busy ? "Saving…" : "Add payment"}</Button>
                    </form>
                    <ul className="mt-3 space-y-1.5">
                      {(payments ?? []).slice(0, 6).map((p) => (
                        <li key={p.id} className="flex items-center justify-between text-sm">
                          <span className="text-xs text-slate-400">{formatDate(p.paidAt)} · {p.medium ?? "—"}{p.reversesPaymentId ? " · reversal" : ""}</span>
                          <span className={p.direction === "in" ? "tabular-nums text-emerald-600 dark:text-emerald-400" : "tabular-nums text-slate-400"}>
                            {p.direction === "in" ? "+" : "−"}<Money value={Math.abs(Number(p.amount))} />
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-[11px] text-slate-500">Created records are <strong>appended (never edited)</strong> — corrections are reversals only.</p>
                  </Card>
                )}

                {canBill && billable && billable.length > 0 && (
                  <Card>
                    <h2 className="mb-1 text-sm font-semibold">Bill from the pool</h2>
                    <p className="mb-2 text-[11px] text-slate-500">Tick the delivered work to invoice, then generate a screenshot-ready invoice.</p>
                    <ul className="space-y-1.5">
                      {billable.map((l) => (
                        <li key={l.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} className="accent-gold-500" aria-label={`Select ${l.title}`} />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            {l.courseCode && <Chip>{l.courseCode}</Chip>}
                            <span className="truncate">{l.title}</span>
                          </span>
                          <span className="shrink-0 tabular-nums"><Money value={l.amount} /></span>
                        </li>
                      ))}
                    </ul>
                    <Button className="mt-3 w-full" disabled={genBusy || sel.size === 0} onClick={genInvoice}>{genBusy ? "Generating…" : `Generate invoice (${sel.size})`}</Button>
                  </Card>
                )}
              </section>
            )}
          </div>

          {/* Secondary: portal access + custom fields + credentials */}
          {canPortal && (
            <Card>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Portal access</h2>
              {portal ? (
                <p className="text-sm">Login <span className="font-mono text-slate-100">{portal.loginId}</span>{" "}
                  <Badge tone={portal.status === "active" ? "green" : portal.status === "lead" ? "amber" : "gray"}>{portal.status}</Badge></p>
              ) : (
                <p className="text-sm text-slate-400">No portal login yet. <Link href="/client-admin" className="text-gold-600 hover:underline dark:text-gold-400">Provision one →</Link></p>
              )}
            </Card>
          )}
          {party.customFields.length > 0 && (
            <Card>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Details</h2>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {party.customFields.map((f) => (
                  <div key={f.id}>
                    <dt className="text-xs text-slate-500">{f.fieldName}{f.required ? " *" : ""}</dt>
                    <dd className="font-medium">{f.value == null || f.value === "" ? <span className="text-slate-500">—</span> : String(f.value)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          {creds && creds.length > 0 && (
            <Card>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Credentials</h2>
              <ul className="divide-y divide-ink-800">
                {creds.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="font-medium">{c.name} <Badge tone="blue">{c.type}</Badge></span>
                    <Link href="/vault" className="text-xs text-slate-400 hover:underline">reveal in Vault →</Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Screenshot-ready invoice popup (a document — stays light in both themes). */}
      {invModal && (
        <div onClick={() => setInvModal(null)} className="fixed inset-0 z-[120] flex items-start justify-center bg-black/55 p-4 pt-[8vh]">
          <div onClick={(e) => e.stopPropagation()} className="w-[460px] max-w-full overflow-hidden rounded-2xl bg-white text-ink-950 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
              <span className="font-display text-base font-semibold">X-Factor AS · Invoice</span>
              <span className="text-xs text-gray-500">{party?.displayName}</span>
              <div className="flex-1" />
              <button type="button" onClick={() => setInvModal(null)} aria-label="Close" className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="px-5 py-2">
              {invModal.lines.map((l) => (
                <div key={l.id} className="flex items-baseline justify-between gap-3 border-b border-gray-50 py-2 text-sm">
                  <span>{l.note ?? "Billable line"}</span>
                  <span className="font-medium tabular-nums"><Money value={Number(l.amount)} /></span>
                </div>
              ))}
            </div>
            <div className="flex items-baseline justify-between px-5 py-4">
              <span className="text-sm font-semibold">Total due</span>
              <span className="font-display text-xl font-semibold"><Money value={invModal.total} /></span>
            </div>
            <p className="px-5 pb-4 text-xs text-gray-400">Screenshot this and send it on WhatsApp — only the selected work is shown.</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
