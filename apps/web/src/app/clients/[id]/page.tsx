"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { can, type PartyDetail, type VaultItem, type WhoAmI, type WorkListRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import {
  Badge, Card, CardHead, cell, DGrid, dcInput, GhostButton, GoldButton, Loading,
  money, Note, Page, StatCards, T, fmtDay, type DCol, type Tone,
} from "@/components/dc";

interface ClientAr { billed: number; collected: number; outstanding: number; openLines: Array<{ invoiceLineId: string; due: number }> }
interface PaymentRow { id: string; direction: string; amount: string; paidAt: string; medium: string | null; reversesPaymentId?: string | null }
interface BillableLine { id: string; workItemId: string; title: string; courseCode: string | null; amount: number }
interface InvoiceModalLine { id: string; note: string | null; amount: string | number }
interface LedgerRow { job: WorkListRow; amount: number | null; running: number | null }

const round2 = (n: number) => Math.round(n * 100) / 100;
const STATE_TONE: Record<string, Tone> = { delivered: "green", confirmed: "blue", pending: "amber", draft: "gray" };

/**
 * Client 360, recreated to the `Business OS v5` handoff. One page = the client's
 * whole account: an AR summary (Total expected / Paid / Remaining), a "Ledger"
 * grid auto-pulled from the task pool (client price + running total — money-gated,
 * §4.4 opacity-safe), an inline "record payment" that FIFO-allocates against open
 * invoice lines, and a "Bill from the pool" picker that mints a screenshot-ready
 * invoice popup from the selected work. Every money figure is redaction-safe: the
 * read model omits what the caller may not see, and the UI never renders it.
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

  // Ledger = the client's work, auto-pulled from the pool, with a derived running
  // total. `amount`/`running` stay null unless money is visible (opacity-safe).
  let run = 0;
  const ledgerRows: LedgerRow[] = (jobs ?? []).map((j) => {
    const amt = canMoney && j.clientAmount != null ? j.clientAmount : null;
    if (amt != null) run = round2(run + amt);
    return { job: j, amount: amt, running: amt != null ? run : null };
  });

  const ledgerCols: DCol<LedgerRow>[] = [
    { label: "Date", width: 96, render: ({ job }) => cell(fmtDay(job.deliveryDate ?? job.submissionDate), { color: T.muted }) },
    {
      label: "Line",
      render: ({ job }) => (
        <Link href={`/work/${job.id}`} style={{ color: T.ink, fontWeight: 500, textDecoration: "none", display: "block" }}>
          {job.title}
          <span style={{ display: "block", fontSize: 10.5, color: T.muted2 }}>
            {[job.courseCode, job.wordCount ? `${job.wordCount} words` : null, job.doerName].filter(Boolean).join(" · ") || "—"}
          </span>
        </Link>
      ),
    },
    { label: "State", align: "center", render: ({ job }) => <Badge tone={STATE_TONE[job.workState] ?? "gray"}>{job.workState}</Badge> },
  ];
  if (canMoney) {
    ledgerCols.push({ label: "Amount", align: "right", render: (r) => r.amount != null ? cell(money(r.amount), { nums: true, weight: 600, sub: r.job.margin != null ? `margin ${money(r.job.margin)}` : undefined }) : <span style={{ color: T.muted2 }}>—</span> });
    ledgerCols.push({ label: "Running", align: "right", render: (r) => r.running != null ? cell(money(r.running), { nums: true, color: T.muted }) : <span style={{ color: T.muted2 }}>—</span> });
  }

  const meta = party ? [party.universityCanonical, party.programme, party.externalRef ? `ID ${party.externalRef}` : null, party.referredByName ? `referral ${party.referredByName}` : null].filter(Boolean).join(" · ") : "";
  const portalTone: Tone = portal?.status === "active" ? "green" : portal?.status === "lead" ? "amber" : "gray";

  return (
    <AppShell>
      <Link href="/clients" style={{ fontSize: 12, fontWeight: 600, color: T.goldDeep, textDecoration: "none", display: "inline-block", marginBottom: 4 }}>← All clients</Link>
      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}

      {party && (
        <Page
          title={party.displayName}
          sub={meta || undefined}
          action={
            <span style={{ display: "flex", gap: 8 }}>
              {canBill && <GhostButton href="/invoices">Create invoice</GhostButton>}
              {can(perms, "work:create") && <GoldButton href="/work/new">+ Add job</GoldButton>}
            </span>
          }
        >
          {canPortal && portal && <div style={{ marginBottom: 8 }}><Badge tone={portalTone}>{portal.status}</Badge></div>}
          <div style={{ fontSize: 12, color: T.muted2, marginBottom: 16 }}>
            One page = this client&apos;s whole account. Tasks flow in from the pool automatically; record payments and screenshot an invoice from here.
          </div>

          {canMoney && ar && (
            <StatCards
              min={180}
              items={[
                { label: "Total expected", value: money(ar.billed) },
                { label: "Paid", value: money(ar.collected), tone: "green" },
                { label: "Remaining", value: money(ar.outstanding), tone: "red" },
              ]}
            />
          )}

          <div style={{ display: "grid", gridTemplateColumns: canMoney ? "1fr 320px" : "1fr", gap: 16, alignItems: "start" }}>
            {/* Left: ledger + bill-from-pool */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink }}>Ledger</span>
                  <span style={{ fontSize: 11, color: T.muted2 }}>auto-pulled from the task pool</span>
                </div>
                <DGrid<LedgerRow>
                  cols={ledgerCols}
                  rows={ledgerRows}
                  keyOf={(r) => r.job.id}
                  minWidth={canMoney ? 620 : 420}
                  empty="No work on this account yet."
                  foot={canMoney && ar ? <span>Total expected <b style={{ color: T.ink }}>{money(ar.billed)}</b> · <span style={{ color: T.red, fontWeight: 700 }}>{money(ar.outstanding)} due</span></span> : undefined}
                />
              </div>

              {canMoney && canBill && billable && billable.length > 0 && (
                <Card>
                  <CardHead>Bill from the pool</CardHead>
                  <div style={{ padding: "12px 14px" }}>
                    <p style={{ margin: "0 0 10px", fontSize: 11.5, color: T.muted }}>Tick the delivered work to invoice, then generate a screenshot-ready invoice.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {billable.map((l) => (
                        <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                          <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} aria-label={`Select ${l.title}`} style={{ accentColor: T.goldDeep, cursor: "pointer" }} />
                          {l.courseCode && <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 600, background: T.codeBg, color: T.codeText, borderRadius: 6, padding: "2px 6px" }}>{l.courseCode}</span>}
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}</span>
                        </label>
                      ))}
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <GoldButton type="button" disabled={genBusy || sel.size === 0} onClick={genInvoice}>{genBusy ? "Generating…" : `Generate invoice (${sel.size})`}</GoldButton>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Right: record payment + payments received (money-gated) */}
            {canMoney && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {canBill && (
                  <form onSubmit={addPayment}>
                    <Card>
                      <CardHead>Record payment received</CardHead>
                      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ৳" inputMode="decimal" style={{ ...dcInput, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
                        <select value={medium} onChange={(e) => setMedium(e.target.value)} style={dcInput}>
                          {["Bank", "Bkash", "Nagad", "DBBL", "MTB", "USDT", "cash"].map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        {payErr && <Note>{payErr}</Note>}
                        <GoldButton type="submit" disabled={busy || !(Number(amount) > 0)}>{busy ? "Saving…" : "Record payment"}</GoldButton>
                      </div>
                    </Card>
                  </form>
                )}

                <Card>
                  <CardHead>Payments received</CardHead>
                  <div style={{ padding: "4px 14px 12px" }}>
                    {(payments ?? []).length === 0 ? (
                      <p style={{ margin: "10px 0", fontSize: 11.5, color: T.muted2 }}>No payments yet.</p>
                    ) : (payments ?? []).slice(0, 6).map((p) => (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: `1px solid ${T.hair}` }}>
                        <span style={{ fontSize: 12, color: T.ink2 }}>{fmtDay(p.paidAt)} · {p.medium ?? "—"}{p.reversesPaymentId ? " · reversal" : ""}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: p.direction === "in" ? T.green : T.muted }}>
                          {p.direction === "in" ? "+" : "−"}{money(Math.abs(Number(p.amount)))}
                        </span>
                      </div>
                    ))}
                    <p style={{ margin: "10px 0 0", fontSize: 10.5, color: T.muted2 }}>Records are appended, never edited — corrections are reversals only.</p>
                  </div>
                </Card>
              </div>
            )}
          </div>

          {/* Secondary: portal access + custom fields + credentials */}
          {canPortal && (
            <Card style={{ marginTop: 16 }}>
              <CardHead>Portal access</CardHead>
              <div style={{ padding: "12px 14px", fontSize: 12.5 }}>
                {portal ? (
                  <span>Login <span style={{ fontFamily: T.mono, fontWeight: 600 }}>{portal.loginId}</span>{" "}<Badge tone={portalTone}>{portal.status}</Badge></span>
                ) : (
                  <span style={{ color: T.muted }}>No portal login yet. <Link href="/client-admin" style={{ color: T.goldDeep, fontWeight: 600, textDecoration: "none" }}>Provision one →</Link></span>
                )}
              </div>
            </Card>
          )}
          {party.customFields.length > 0 && (
            <Card style={{ marginTop: 16 }}>
              <CardHead>Details</CardHead>
              <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                {party.customFields.map((f) => {
                  const empty = f.value == null || f.value === "";
                  return (
                    <div key={f.id}>
                      <div style={{ fontSize: 10.5, color: T.muted }}>{f.fieldName}{f.required ? " *" : ""}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: empty ? T.muted2 : T.ink }}>{empty ? "—" : String(f.value)}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {creds && creds.length > 0 && (
            <Card style={{ marginTop: 16 }}>
              <CardHead>Credentials</CardHead>
              <div style={{ padding: "4px 14px 8px" }}>
                {creds.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: `1px solid ${T.hair}` }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{c.name} <Badge tone="blue">{c.type}</Badge></span>
                    <Link href="/vault" style={{ fontSize: 11, color: T.muted, textDecoration: "none" }}>reveal in Vault →</Link>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </Page>
      )}

      {/* Screenshot-ready invoice popup (a document — stays light in both themes). */}
      {invModal && (
        <div onClick={() => setInvModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(7,10,20,0.55)", zIndex: 120, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "8vh" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "calc(100% - 32px)", background: T.card, borderRadius: 14, boxShadow: "0 24px 64px rgba(11,16,32,0.35)", overflow: "hidden" }}>
            <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.eyebrow}`, display: "flex", alignItems: "center", gap: 10 }}>
              <svg viewBox="0 0 40 40" width="26" height="26" fill="none" aria-hidden><rect x="0.5" y="0.5" width="39" height="39" rx="9" stroke={T.border} /><path d="M11 11 L29 29 M29 11 L11 29" stroke={T.gold} strokeWidth="3" strokeLinecap="round" /></svg>
              <span style={{ lineHeight: 1.2 }}>
                <span style={{ display: "block", fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600 }}>X-Factor AS · Invoice</span>
                <span style={{ display: "block", fontSize: 11, color: T.muted2 }}>{party?.displayName}</span>
              </span>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => setInvModal(null)} aria-label="Close" style={{ cursor: "pointer", color: T.muted2, fontSize: 18, background: "none", border: "none" }}>✕</button>
            </div>
            <div style={{ padding: "8px 22px 4px" }}>
              {invModal.lines.map((l) => (
                <div key={l.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: `1px solid ${T.hair}` }}>
                  <span style={{ fontSize: 12.5 }}>{l.note ?? "Billable line"}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(Number(l.amount))}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "14px 22px 20px" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Total due</span>
              <span style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, color: T.ink }}>{money(invModal.total)}</span>
            </div>
            <div style={{ padding: "0 22px 18px", fontSize: 11, color: T.muted2 }}>Screenshot this and send it on WhatsApp — only the selected work is shown.</div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
