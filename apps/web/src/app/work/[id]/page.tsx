"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type PartyRow, type RefEntity, type WhoAmI, type WorkDetail } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Money, Provenance, Spinner, StateBadge } from "@/components/ui";

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

/** Best-effort party name; falls back to a short id if the caller can't read it. */
function PartyName({ id }: { id: string | null }) {
  const { data } = useApi<PartyRow>(id ? `parties/${id}` : null, { shouldRetryOnError: false });
  if (!id) return <span className="text-slate-500">—</span>;
  return <span>{data?.displayName ?? `…${id.slice(-4)}`}</span>;
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
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-300">Related tasks</h2>
      {canCreate && (
        <div className="flex items-end gap-2">
          <Field label="Add a reminder for this job">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. chase brief, deliver draft" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} />
          </Field>
          <Button type="button" onClick={() => void add()} disabled={busy || !title.trim()}>Add task</Button>
        </div>
      )}
      {!data || data.length === 0 ? (
        <p className="text-xs text-slate-500">No tasks linked to this job.</p>
      ) : (
        <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
          {data.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <Link href="/tasks" className="hover:underline">{t.title}</Link>
              <span className="flex items-center gap-2">
                {t.dueAt && <span className="text-xs text-slate-500">{formatDate(t.dueAt)}</span>}
                <StateBadge state={t.state} />
              </span>
            </li>
          ))}
        </ul>
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

  return (
    <AppShell>
      <Link href="/" className="mb-3 inline-block text-xs text-slate-400 hover:underline">
        ← My open loops
      </Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {item && data && (
        <div className="space-y-5">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{item.title}</h1>
              <StateBadge state={item.workState} />
              <StateBadge state={item.moneyState} />
              {data.jobStatus.total > 0 && <Badge tone="gray">{data.jobStatus.label}</Badge>}
              {item.isEstimate && <Badge tone="amber">estimate</Badge>}
            </div>
            <p className="text-xs text-slate-400">
              {[course?.canonical, item.moduleName, item.groupKind === "group" ? `group${item.groupScope ? ` · ${item.groupScope}` : ""}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {/* §3.1 captured detail (only what's present). */}
            {(item.deliveryDate || item.submissionDate || item.wordCount || item.groupNote) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                {item.wordCount ? <span>{item.wordCount} words</span> : null}
                {item.deliveryDate ? <span>delivery {formatDate(item.deliveryDate)}</span> : null}
                {item.submissionDate ? <span>submission {formatDate(item.submissionDate)}</span> : null}
                {item.groupNote ? <span>{item.groupNote}</span> : null}
              </div>
            )}
            <Provenance
              items={[
                { label: "Created by", name: item.createdByName, at: item.createdAt },
                { label: "Confirmed by", name: item.confirmedByName, at: item.confirmedAt },
                { label: "Updated by", name: item.updatedByName, at: item.updatedAt },
              ]}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {mayTransition && (
                <Button disabled={busy} onClick={() => transition(next!)}>
                  {next === "confirmed" ? "Confirm" : `Mark ${next}`}
                </Button>
              )}
              {canEdit && (
                <Link href={`/work/${id}/edit`}>
                  <Button variant="secondary">Edit</Button>
                </Link>
              )}
            </div>
            {actionError && <ErrorNote message={actionError} />}
          </header>

          {/* Lines — spec always; money only when the API includes it. */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-300">Lines</h2>
            {billedInvoiceId && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                Added to the client's open invoice.{" "}
                <Link href={`/invoices/${billedInvoiceId}`} className="font-medium underline">
                  View invoice
                </Link>
              </p>
            )}
            {data.lines.length === 0 ? (
              <EmptyState title="No lines yet" hint="Add copies or parts to this job." />
            ) : (
              <ul className="space-y-2">
                {data.lines.map((l) => {
                  const lineNext = LINE_NEXT[l.lineStatus];
                  const canCancel = l.lineStatus === "pending" || l.lineStatus === "submitted";
                  return (
                    <Card key={l.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="text-sm">
                        <span className="font-medium capitalize">{l.lineKind}</span>{" "}
                        <Badge tone={l.side === "consumer" ? "blue" : "gray"}>{l.side}</Badge>{" "}
                        <StateBadge state={l.lineStatus} />
                        <div className="mt-0.5 text-xs text-slate-400">
                          {l.wordCount ? `${l.wordCount} words` : null}
                          {l.unitCount && l.unitCount > 1 ? ` · ${l.unitCount} copies` : null}
                          {l.consumerPartyId ? (
                            <>
                              {" · "}
                              <PartyName id={l.consumerPartyId} />
                            </>
                          ) : null}
                        </div>
                      </div>
                      {/* Money: rendered only when present (redacted ⇒ absent ⇒ hidden). */}
                      <div className="flex flex-col items-end gap-1">
                        {l.amount !== undefined && (
                          <div className="text-right text-sm font-medium">
                            <Money value={l.amount} />
                          </div>
                        )}
                        <div className="flex flex-wrap justify-end gap-1">
                          {canEdit && lineNext && (
                            <Button variant="ghost" className="px-2 text-xs" disabled={busy} onClick={() => setLineStatus(l.id, lineNext)}>
                              Mark {lineNext}
                            </Button>
                          )}
                          {canEdit && canCancel && (
                            <Button variant="ghost" className="px-2 text-xs" disabled={busy} onClick={() => setLineStatus(l.id, "cancelled")}>
                              Cancel
                            </Button>
                          )}
                          {l.lineStatus === "billed" && <span className="text-[11px] text-slate-500">billed — correct via reprice</span>}
                          {/* Bill a money-visible consumer line to the client's open invoice. */}
                          {canBill && l.side === "consumer" && l.consumerPartyId && l.lineStatus !== "billed" && (
                            <Button variant="ghost" className="px-2 text-xs" disabled={busy} onClick={() => billLine(l.id)}>
                              Bill to invoice
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Legs + margins — exactly what RLS let this viewer see. */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-300">Money chain</h2>
            {data.legs.length === 0 ? (
              <EmptyState title="No legs visible to you" hint="You only see legs you are a party to." />
            ) : (
              <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
                {data.legs.map((leg) => (
                  <li key={leg.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="flex items-center gap-1 text-slate-300">
                      <PartyName id={leg.fromPartyId} /> <span className="text-slate-500">→</span> <PartyName id={leg.toPartyId} />
                    </span>
                    <span className="font-medium">
                      <Money value={leg.amount} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.margins.length > 0 && (
              <Card>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your margin</h2>
                <ul className="space-y-1 text-sm">
                  {data.margins.map((m) => (
                    <li key={m.partyId} className="flex items-center justify-between">
                      <PartyName id={m.partyId} />
                      <Money value={m.margin} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {canConfirm && <HandoffAction workItemId={id} onDone={() => void mutate()} />}
          </section>

          {can(me?.permissions, "capture:view") && (
            <RelatedTasks workItemId={id} canCreate={can(me?.permissions, "capture:create")} />
          )}
        </div>
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
