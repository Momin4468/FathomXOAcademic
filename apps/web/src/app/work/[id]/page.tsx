"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { can, type Leg, type PartyRow, type RefEntity, type WhoAmI, type WorkDetail } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { useConfirm } from "@/components/confirm";
// Kept verbatim for HandoffAction + SharesPanel (behaviour-critical) and Money (shared).
import { Button, Card, ErrorNote, Field, Input, Money } from "@/components/ui";
import { Badge, Card as DCard, CardHead, EmptyBox, GhostButton, GoldButton, Loading, Note, Page, T, dcInput, type Tone } from "@/components/dc";

/** Admin/partner search for the hand-off target. */
const searchAdmin = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=partner`);
  return rows.map((p) => ({ id: p.id, label: p.displayName, sub: p.externalRef ?? undefined }));
};

const NEXT_STATE: Record<string, string | undefined> = {
  draft: "pending",
  pending: "confirmed",
  confirmed: "delivered",
};
/** Manual forward move for a single line (billing sets 'billed'; reprice handles money). */
const LINE_NEXT: Record<string, string | undefined> = { draft: "pending", pending: "submitted" };

// work / money / line / invoice states → design badge tone (consistent across screens).
const STATE_TONE: Record<string, Tone> = {
  draft: "gray", pending: "amber", confirmed: "blue", delivered: "green",
  submitted: "blue", billed: "green", cancelled: "red",
  unbilled: "gray", invoiced: "amber", partial: "amber", settled: "green",
};
const tone = (s: string): Tone => STATE_TONE[s] ?? "gray";

/**
 * Build ordered node chains from the RLS-visible legs — contiguous legs join into
 * one linear chain (client → owner → writer); a fan-out (e.g. multiple consumer
 * lines off one owner) becomes its own chain. Only legs the API returned are here,
 * so this can never surface a leg/figure the caller may not see.
 */
type ChainStep = { partyId: string | null; amount?: string };
function buildChains(legs: Leg[]): ChainStep[][] {
  const sorted = [...legs].sort((a, b) => a.seq - b.seq);
  const chains: ChainStep[][] = [];
  for (const leg of sorted) {
    const chain = chains.find((c) => c[c.length - 1].partyId === leg.fromPartyId);
    if (chain) chain.push({ partyId: leg.toPartyId, amount: leg.amount });
    else chains.push([{ partyId: leg.fromPartyId }, { partyId: leg.toPartyId, amount: leg.amount }]);
  }
  return chains;
}

interface RelatedTask {
  id: string;
  title: string;
  state: string;
  dueAt: string | null;
}

/** Phase 4B — the visible tasks↔jobs link: this job's tasks + create-from-job. */
function RelatedTasks({ workItemId, canCreate }: { workItemId: string; canCreate: boolean }) {
  const { data, mutate } = useApi<RelatedTask[]>(`tasks?workItemId=${workItemId}`);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await apiSend("tasks", "POST", { title: title.trim(), workItemId });
      setTitle("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Related tasks</h2>
      {canCreate && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a reminder — chase brief, deliver draft…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
            style={{ ...dcInput, flex: 1 }}
          />
          <GoldButton type="button" onClick={() => void add()} disabled={busy || !title.trim()}>Add task</GoldButton>
        </div>
      )}
      {!data || data.length === 0 ? (
        <p style={{ fontSize: 11.5, color: T.muted2, margin: 0 }}>No tasks linked to this job.</p>
      ) : (
        <DCard>
          {data.map((t, i) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 14px", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>
              <Link href="/tasks" style={{ color: T.ink, textDecoration: "none" }}>{t.title}</Link>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {t.dueAt && <span style={{ fontSize: 11, color: T.muted2 }}>{formatDate(t.dueAt)}</span>}
                <Badge tone={tone(t.state)}>{t.state}</Badge>
              </span>
            </div>
          ))}
        </DCard>
      )}
    </section>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = useApi<WorkDetail>(`work/${id}`);
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data: course } = useApi<RefEntity>(data?.item.courseRefId ? `reference/${data.item.courseRefId}` : null, {
    shouldRetryOnError: false,
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [billedInvoiceId, setBilledInvoiceId] = useState<string | null>(null);

  const item = data?.item;
  const next = item ? NEXT_STATE[item.workState] : undefined;
  const canConfirm = can(me?.permissions, "work:approve");
  const canEdit = can(me?.permissions, "work:edit");
  const canBill = can(me?.permissions, "billing:create");
  const mayTransition = next && (next === "confirmed" ? canConfirm : canEdit);

  const chains = useMemo(() => (data ? buildChains(data.legs) : []), [data]);

  async function billLine(workLineId: string) {
    if (!(await confirm({ title: "Bill this line to the client's invoice?", danger: true, confirmLabel: "Bill" }))) return;
    setBusy(true);
    setActionError("");
    setBilledInvoiceId(null);
    try {
      const line = await apiSend<{ invoiceId: string }>("invoices/attach-line", "POST", { workLineId });
      setBilledInvoiceId(line.invoiceId ?? null);
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not bill this line");
    } finally {
      setBusy(false);
    }
  }

  async function setLineStatus(lineId: string, to: string) {
    if (to === "cancelled" && !(await confirm({ title: "Cancel this line?", danger: true, confirmLabel: "Cancel line" }))) return;
    setBusy(true);
    setActionError("");
    try {
      await apiSend(`work/lines/${lineId}/status`, "POST", { to });
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not change status");
    } finally {
      setBusy(false);
    }
  }

  async function transition(toState: string) {
    if (toState === "confirmed" && !(await confirm({ title: "Confirm this job?", body: "Confirming locks it in for delivery.", confirmLabel: "Confirm" }))) return;
    setBusy(true);
    setActionError("");
    try {
      await apiSend(`work/${id}/transition`, "POST", { toState });
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const meta = item
    ? [course?.canonical, item.moduleName, item.groupKind === "group" ? `group${item.groupScope ? ` · ${item.groupScope}` : ""}` : null].filter(Boolean).join(" · ")
    : "";

  const provenance = item
    ? [
        { label: "Created by", name: item.createdByName, at: item.createdAt },
        { label: "Confirmed by", name: item.confirmedByName, at: item.confirmedAt },
        { label: "Updated by", name: item.updatedByName, at: item.updatedAt },
      ].filter((p) => p.name || p.at)
    : [];

  // Compact inline action for a dense line row (matches the tasks-grid affordances).
  const lineAction = (label: string, onClick: () => void, color: string) => (
    <span onClick={busy ? undefined : onClick} style={{ fontSize: 11, fontWeight: 600, color, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>{label}</span>
  );

  return (
    <AppShell>
      <Link href="/" style={{ fontSize: 12, fontWeight: 600, color: T.goldDeep, textDecoration: "none", display: "inline-block", marginBottom: 8 }}>
        ← My open loops
      </Link>
      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}
      {item && data && (
        <Page
          title={item.title}
          sub={meta || undefined}
          action={
            (mayTransition || canEdit) ? (
              <span style={{ display: "flex", gap: 8 }}>
                {mayTransition && (
                  <GoldButton disabled={busy} onClick={() => transition(next!)}>
                    {next === "confirmed" ? "Confirm" : `Mark ${next}`}
                  </GoldButton>
                )}
                {canEdit && <GhostButton href={`/work/${id}/edit`}>Edit</GhostButton>}
              </span>
            ) : undefined
          }
        >
          <div style={{ display: "grid", gap: 16 }}>
            <header style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Badge tone={tone(item.workState)}>{item.workState}</Badge>
                <Badge tone={tone(item.moneyState)}>{item.moneyState}</Badge>
                {data.jobStatus.total > 0 && <Badge tone="gray">{data.jobStatus.label}</Badge>}
                {item.isEstimate && <Badge tone="amber">estimate</Badge>}
              </div>
              {/* §3.1 captured detail (only what's present). */}
              {(item.deliveryDate || item.submissionDate || item.wordCount || item.groupNote) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", fontSize: 11.5, color: T.muted }}>
                  {item.wordCount ? <span>{item.wordCount} words</span> : null}
                  {item.deliveryDate ? <span>delivery {formatDate(item.deliveryDate)}</span> : null}
                  {item.submissionDate ? <span>submission {formatDate(item.submissionDate)}</span> : null}
                  {item.groupNote ? <span>{item.groupNote}</span> : null}
                </div>
              )}
              {provenance.length > 0 && (
                <div style={{ borderTop: `1px solid ${T.hair}`, paddingTop: 8, display: "grid", gap: 2, fontSize: 11, color: T.muted2 }}>
                  {provenance.map((p) => (
                    <div key={p.label}>
                      {p.label} <span style={{ color: T.ink2 }}>{p.name ?? "—"}</span>{p.at ? ` · ${formatDateTime(p.at)}` : ""}
                    </div>
                  ))}
                </div>
              )}
              {actionError && <Note>{actionError}</Note>}
            </header>

            {/* Lines — spec always; money only when the API includes it. */}
            <section style={{ display: "grid", gap: 8 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Lines</h2>
              {billedInvoiceId && (
                <Note tone="green">
                  Added to the client&apos;s open invoice.{" "}
                  <Link href={`/invoices/${billedInvoiceId}`} style={{ fontWeight: 700, color: T.green, textDecoration: "underline" }}>View invoice</Link>
                </Note>
              )}
              {data.lines.length === 0 ? (
                <EmptyBox title="No lines yet" hint="Add copies or parts to this job." />
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {data.lines.map((l) => {
                    const lineNext = LINE_NEXT[l.lineStatus];
                    const canCancel = l.lineStatus === "pending" || l.lineStatus === "submitted";
                    const sub = [
                      l.wordCount ? `${l.wordCount} words` : null,
                      l.unitCount && l.unitCount > 1 ? `${l.unitCount} copies` : null,
                    ].filter(Boolean).join(" · ");
                    return (
                      <DCard key={l.id} style={{ padding: "11px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontSize: 12.5 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{l.lineKind}</span>
                            <Badge tone={l.side === "consumer" ? "blue" : "gray"}>{l.side}</Badge>
                            <Badge tone={tone(l.lineStatus)}>{l.lineStatus}</Badge>
                          </span>
                          {(sub || l.consumerPartyId) && (
                            <div style={{ marginTop: 3, fontSize: 11, color: T.muted2 }}>
                              {sub}
                              {sub && l.consumerPartyId ? " · " : ""}
                              {l.consumerPartyId ? <PartyName id={l.consumerPartyId} /> : null}
                            </div>
                          )}
                        </div>
                        {/* Money: rendered only when present (redacted ⇒ absent ⇒ hidden). */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                          {l.amount !== undefined && (
                            <div style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                              <Money value={l.amount} />
                            </div>
                          )}
                          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 12 }}>
                            {canEdit && lineNext && lineAction(`Mark ${lineNext}`, () => setLineStatus(l.id, lineNext), T.goldDeep)}
                            {canEdit && canCancel && lineAction("Cancel", () => setLineStatus(l.id, "cancelled"), T.red)}
                            {l.lineStatus === "billed" && <span style={{ fontSize: 10.5, color: T.muted2 }}>billed — correct via reprice</span>}
                            {canBill && l.side === "consumer" && l.consumerPartyId && l.lineStatus !== "billed" && lineAction("Bill to invoice", () => billLine(l.id), T.blue)}
                          </div>
                        </div>
                      </DCard>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Legs + margins — exactly what RLS let this viewer see. */}
            <section style={{ display: "grid", gap: 8 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Money chain</h2>
              <p style={{ fontSize: 11.5, color: T.muted, margin: 0 }}>
                Who sees which leg is enforced by the database, not the UI. Margin is derived from the legs, never stored.
              </p>
              {data.legs.length === 0 ? (
                <EmptyBox title="No legs visible to you" hint="You only see legs you are a party to." />
              ) : (
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "26px 20px", display: "flex", flexDirection: "column" }}>
                  {chains.map((chain, ci) => (
                    <div key={ci} style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 4, marginTop: ci ? 18 : 0 }}>
                      {chain.map((step, si) => (
                        <Fragment key={si}>
                          <span style={{ width: 150, border: `1.5px solid ${T.border}`, borderRadius: 12, padding: 13, textAlign: "center", background: T.rowHover }}>
                            <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}><PartyName id={step.partyId} /></span>
                          </span>
                          {si < chain.length - 1 && (
                            <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 92 }}>
                              <span style={{ fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", padding: "3px 9px", borderRadius: 999, background: T.greenBg, color: T.green, border: "1px solid #CFEBD9", whiteSpace: "nowrap" }}>
                                <Money value={chain[si + 1].amount} />
                              </span>
                              <svg width="72" height="9" viewBox="0 0 72 9" fill="none" stroke="#B9C0CE" strokeWidth="1.5"><path d="M0 4.5h66 M66 4.5l-5-3.5 M66 4.5l-5 3.5" /></svg>
                            </span>
                          )}
                        </Fragment>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {data.margins.length > 0 && (
                <DCard>
                  <CardHead>Margins visible to you</CardHead>
                  <div style={{ padding: "6px 14px 10px" }}>
                    {data.margins.map((m, i) => (
                      <div key={m.partyId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>
                        <PartyName id={m.partyId} />
                        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: m.margin < 0 ? T.red : T.ink }}><Money value={m.margin} /></span>
                      </div>
                    ))}
                  </div>
                </DCard>
              )}
              {canConfirm && <HandoffAction workItemId={id} onDone={() => void mutate()} />}
              {canConfirm && <SharesPanel workItemId={id} />}
            </section>

            {can(me?.permissions, "capture:view") && (
              <RelatedTasks workItemId={id} canCreate={can(me?.permissions, "capture:create")} />
            )}
          </div>
        </Page>
      )}
    </AppShell>
  );
}

/**
 * Hand this job to another admin (0051, commission model). The owner keeps a % of
 * the client price; the rest flows to the receiver, and the job + client are
 * shared with them so they can pick it up. The owner's real client price never
 * leaks — each admin sees only their own hop's margin (leg RLS).
 */
function HandoffAction({ workItemId, onDone }: { workItemId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [toAdmin, setToAdmin] = useState<string | null>(null);
  const [cut, setCut] = useState("15");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!toAdmin) return setErr("Pick the admin to hand off to.");
    const pct = Number(cut);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setErr("Your cut must be 0–100%.");
    setBusy(true);
    setErr("");
    try {
      await apiSend(`work/${workItemId}/handoff`, "POST", { toAdminPartyId: toAdmin, ownerCutPct: pct });
      setOpen(false);
      setToAdmin(null);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Handoff failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-plum-500 hover:underline"
      >
        Hand off to another admin…
      </button>
    );
  }
  return (
    <Card>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Hand off — you keep a cut</h3>
      {err && <ErrorNote message={err} />}
      <div className="space-y-3">
        <Field label="Hand off to (admin)">
          <EntityPicker placeholder="Search admin / partner…" search={searchAdmin} onPick={(i) => setToAdmin(i?.id ?? null)} />
        </Field>
        <Field label="Your cut (%)" hint="You keep this % of the client price; the rest flows to them. They assign their own writer.">
          <Input inputMode="decimal" value={cut} onChange={(e) => setCut(e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy}>{busy ? "Handing off…" : "Hand off"}</Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Who this job is shared with (0052). The owner sees the grantee list (via the
 * owner-gated definer), can share it with another admin (visibility only, no
 * money), and can revoke a share. Non-owners get an empty list from the server.
 */
function SharesPanel({ workItemId }: { workItemId: string }) {
  const { data: shares, mutate } = useApi<Array<{ id: string; partyId: string; partyName: string; reason: string | null }>>(`work/${workItemId}/shares`);
  const [adding, setAdding] = useState(false);
  const [grantee, setGrantee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const list = shares ?? [];

  async function share() {
    if (!grantee) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend(`work/${workItemId}/share`, "POST", { granteePartyId: grantee });
      setAdding(false);
      setGrantee(null);
      void mutate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not share");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(partyId: string) {
    try {
      await apiSend(`work/${workItemId}/unshare`, "POST", { granteePartyId: partyId });
      void mutate();
    } catch {
      /* surfaced on next load */
    }
  }

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shared with</h3>
        <button onClick={() => setAdding((v) => !v)} className="text-xs font-medium text-plum-500 hover:underline">
          {adding ? "Cancel" : "Share…"}
        </button>
      </div>
      {adding && (
        <div className="mb-3 space-y-2">
          {err && <ErrorNote message={err} />}
          <EntityPicker placeholder="Search admin / partner…" search={searchAdmin} onPick={(i) => setGrantee(i?.id ?? null)} />
          <Button onClick={share} disabled={busy || !grantee}>{busy ? "Sharing…" : "Share job (visibility only)"}</Button>
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">Not shared with anyone.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {list.map((s) => (
            <li key={s.id} className="flex items-center justify-between">
              <span className="text-slate-300">
                {s.partyName}
                {s.reason ? <span className="ml-1 text-xs text-slate-500">· {s.reason}</span> : null}
              </span>
              <button onClick={() => revoke(s.partyId)} className="text-xs text-red-400 hover:underline">Revoke</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
