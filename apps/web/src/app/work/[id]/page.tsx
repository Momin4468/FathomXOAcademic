"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type PartyRow, type RefEntity, type WhoAmI, type WorkDetail } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, EmptyState, ErrorNote, Money, Provenance, Spinner, StateBadge } from "@/components/ui";

const NEXT_STATE: Record<string, string | undefined> = {
  draft: "pending",
  pending: "confirmed",
  confirmed: "delivered",
};

/** Best-effort party name; falls back to a short id if the caller can't read it. */
function PartyName({ id }: { id: string | null }) {
  const { data } = useApi<PartyRow>(id ? `parties/${id}` : null, { shouldRetryOnError: false });
  if (!id) return <span className="text-gray-400">—</span>;
  return <span>{data?.displayName ?? `…${id.slice(-4)}`}</span>;
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
      <Link href="/" className="mb-3 inline-block text-xs text-gray-500 hover:underline">
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
              {item.isEstimate && <Badge tone="amber">estimate</Badge>}
            </div>
            <p className="text-xs text-gray-500">{course?.canonical ? course.canonical : ""}</p>
            <Provenance
              items={[
                { label: "Created by", name: item.createdByName, at: item.createdAt },
                { label: "Confirmed by", name: item.confirmedByName, at: item.confirmedAt },
                { label: "Updated by", name: item.updatedByName, at: item.updatedAt },
              ]}
            />
            {mayTransition && (
              <div className="flex gap-2 pt-1">
                <Button disabled={busy} onClick={() => transition(next!)}>
                  {next === "confirmed" ? "Confirm" : `Mark ${next}`}
                </Button>
              </div>
            )}
            {actionError && <ErrorNote message={actionError} />}
          </header>

          {/* Lines — spec always; money only when the API includes it. */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Lines</h2>
            {billedInvoiceId && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
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
                {data.lines.map((l) => (
                  <Card key={l.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="text-sm">
                      <span className="font-medium capitalize">{l.lineKind}</span>{" "}
                      <Badge tone={l.side === "consumer" ? "blue" : "gray"}>{l.side}</Badge>
                      <div className="mt-0.5 text-xs text-gray-500">
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
                      {/* Bill a money-visible consumer line to the client's open invoice. */}
                      {canBill && l.side === "consumer" && l.consumerPartyId && (
                        <Button variant="ghost" className="px-2 text-xs" disabled={busy} onClick={() => billLine(l.id)}>
                          Bill to invoice
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </ul>
            )}
          </section>

          {/* Legs + margins — exactly what RLS let this viewer see. */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Money chain</h2>
            {data.legs.length === 0 ? (
              <EmptyState title="No legs visible to you" hint="You only see legs you are a party to." />
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {data.legs.map((leg) => (
                  <li key={leg.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="flex items-center gap-1 text-gray-600">
                      <PartyName id={leg.fromPartyId} /> <span className="text-gray-400">→</span> <PartyName id={leg.toPartyId} />
                    </span>
                    <span className="font-medium">
                      <Money value={leg.amount} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.margins.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Your margin</h2>
                <ul className="space-y-1 text-sm">
                  {data.margins.map((m) => (
                    <li key={m.partyId} className="flex items-center justify-between">
                      <PartyName id={m.partyId} />
                      <Money value={m.margin} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
