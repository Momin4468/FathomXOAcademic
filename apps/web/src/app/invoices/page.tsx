"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { can, type Invoice, type PartyRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { Badge, Card, DGrid, Field, GhostButton, GoldButton, Loading, Note, Page, T, dcInput, fmtDay, money, type Tone } from "@/components/dc";

const STATUSES = ["", "open", "sent", "partial", "paid", "void"];
const STATUS_TONE: Record<string, Tone> = { open: "gray", sent: "blue", partial: "amber", paid: "green", void: "red" };
interface BillableLine { id: string; workItemId: string; title: string; courseCode: string | null; amount: number }

const searchClients = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?type=client&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.externalRef ?? undefined }));
};

export default function InvoicesPage() {
  const router = useRouter();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const qs = new URLSearchParams();
  if (clientFilter) qs.set("clientPartyId", clientFilter);
  if (status) qs.set("status", status);
  const path = `invoices${qs.toString() ? `?${qs}` : ""}`;
  const { data, error, isLoading, mutate } = useApi<Invoice[]>(path);

  const canCreate = can(me?.permissions, "billing:create");
  const [open, setOpen] = useState(false);
  const [newClient, setNewClient] = useState<string | null>(null);
  const [isEstimate, setIsEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const dirty = !!newClient || isEstimate;
  const { confirmClose } = useUnsavedGuard(dirty);

  // The client's unbilled work pool (Rule 3) + which lines to bill.
  const { data: billable } = useApi<BillableLine[]>(open && newClient ? `invoices/billable?clientPartyId=${newClient}` : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pickedTotal = (billable ?? []).filter((l) => picked.has(l.id)).reduce((s, l) => s + l.amount, 0);

  async function billSelected() {
    if (!newClient || picked.size === 0) return;
    setBusy(true);
    setFormError("");
    try {
      let invoiceId: string | undefined;
      for (const workLineId of picked) {
        const res = await apiSend<{ invoiceId: string }>("invoices/attach-line", "POST", { workLineId, ...(invoiceId ? { invoiceId } : {}) });
        invoiceId = invoiceId ?? res.invoiceId;
      }
      setOpen(false); setPicked(new Set()); setNewClient(null);
      if (invoiceId) router.push(`/invoices/${invoiceId}`); else await mutate();
    } catch (err) {
      setFormError(bannerMessage(err, "Could not bill the selected lines") ?? "");
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newClient) return;
    setBusy(true);
    setFormError("");
    setFieldErrs({});
    try {
      await apiSend("invoices", "POST", { clientPartyId: newClient, isEstimate });
      setOpen(false);
      setNewClient(null);
      setIsEstimate(false);
      await mutate();
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setFormError(bannerMessage(err, "Could not create invoice") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <Page
        title="Invoices"
        sub="bill a client's unbilled work — the amount is derived from the lines, never stored"
        action={canCreate ? <GoldButton onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ New invoice"}</GoldButton> : undefined}
      >
        {open && canCreate && (
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <form onSubmit={create} style={{ display: "grid", gap: 12 }}>
              <Field label="Client" required hint="Pick the client this invoice bills." error={fieldErrs.clientPartyId}>
                <EntityPicker placeholder="Search client…" search={searchClients} onPick={(i) => setNewClient(i?.id ?? null)} />
              </Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.ink2 }}>
                <input type="checkbox" checked={isEstimate} onChange={(e) => setIsEstimate(e.target.checked)} />
                This is an estimate
              </label>

              {/* Bill from the work pool — the client's unbilled lines (Rule 3). */}
              {newClient && (
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.muted }}>Bill from the work pool</p>
                  {!billable ? (
                    <Loading />
                  ) : billable.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 12, color: T.muted2 }}>No unbilled work for this client.</p>
                  ) : (
                    <>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
                        {billable.map((l) => (
                          <li key={l.id}>
                            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", fontSize: 12.5, cursor: "pointer", borderRadius: 6 }}>
                              <input type="checkbox" checked={picked.has(l.id)} onChange={() => togglePick(l.id)} />
                              {l.courseCode && <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 600, color: T.codeText, background: T.codeBg, borderRadius: 5, padding: "2px 6px" }}>{l.courseCode}</span>}
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</span>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.hair}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 11.5, color: T.muted }}>{picked.size} selected · {money(pickedTotal)}</span>
                        <GoldButton type="button" disabled={busy || picked.size === 0} onClick={() => void billSelected()}>
                          {busy ? "Billing…" : `Bill ${picked.size} item${picked.size === 1 ? "" : "s"}`}
                        </GoldButton>
                      </div>
                    </>
                  )}
                </div>
              )}

              {formError && <Note>{formError}</Note>}
              <div>
                <GhostButton type="submit" disabled={busy || !newClient}>{busy ? "Creating…" : "Create empty invoice"}</GhostButton>
              </div>
            </form>
          </Card>
        )}

        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label="Filter by client">
              <EntityPicker placeholder="Any client…" search={searchClients} onPick={(i) => setClientFilter(i?.id ?? null)} />
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={dcInput}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s || "Any status"}</option>
                ))}
              </select>
            </Field>
          </div>
        </Card>

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <DGrid<Invoice>
            rows={data}
            keyOf={(inv) => inv.id}
            search
            exportName="invoices"
            cols={[
              { label: "Client", text: (inv) => inv.clientPartyId, render: (inv) => <PartyName id={inv.clientPartyId} /> },
              { label: "Status", align: "center", text: (inv) => inv.status, render: (inv) => <Badge tone={STATUS_TONE[inv.status] ?? "gray"}>{inv.status}</Badge> },
              {
                label: "Estimate",
                align: "center",
                text: (inv) => (inv.isEstimate ? "estimate" : inv.supersedesInvoiceId ? "final" : ""),
                render: (inv) => (inv.isEstimate ? <Badge tone="amber">estimate</Badge> : inv.supersedesInvoiceId ? <Badge tone="gray">final</Badge> : <span style={{ color: T.muted2 }}>—</span>),
              },
              { label: "Date", text: (inv) => inv.createdAt, render: (inv) => <span style={{ color: T.muted2 }}>{fmtDay(inv.createdAt)}</span> },
            ]}
            actions={[{ label: "open →", onClick: () => {}, href: (inv) => `/invoices/${inv.id}` }]}
            empty="No invoices. Bill a job line to start a client's invoice."
          />
        )}
      </Page>
    </AppShell>
  );
}
