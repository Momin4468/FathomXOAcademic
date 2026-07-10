"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { can, type PartyDetail, type WhoAmI, type WorkListRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PartyForm, type PartyFormInitial } from "@/components/PartyForm";
import { Register } from "@/components/Register";
import { Badge, Button, Card, Chip, EmptyState, ErrorNote, Money, Spinner, StateBadge } from "@/components/ui";

/**
 * Person record — the consolidated "Team & partners" 360. One party is multi-hat
 * (Khalid sources AND writes), so the record shows a facet PER hat the person
 * wears, each surfacing the fields/activity that matter for that role:
 *   • writer / employee → work log (jobs done), their earnings (money-gated)
 *   • partner / referrer → jobs they sourced + their share (money-gated)
 *   • client           → link to the full Client 360
 *   • vendor           → their claims
 * Money is gated + §4.4 opacity-safe (the work read model only fills money columns
 * the caller may see). Clients keep their own dedicated directory; this is the
 * back-office people view (writers, partners, vendors, referrers, employees).
 */
const HAT_TONE: Record<string, "blue" | "green" | "amber" | "gray"> = {
  writer: "blue", employee: "blue", partner: "green", referrer: "green", client: "amber", vendor: "gray",
};

export default function PersonRecordPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const perms = me?.permissions;
  const canWork = can(perms, "work:view");
  const canMoney = can(perms, "billing:view");
  const canEdit = can(perms, "reference:edit");

  const { data: party, error, isLoading, mutate } = useApi<PartyDetail>(`parties/${id}`);
  const [editing, setEditing] = useState(false);

  const hats = party?.partyType ?? [];
  const isDoer = hats.includes("writer") || hats.includes("employee");
  const isSource = hats.includes("partner") || hats.includes("referrer");
  const isClient = hats.includes("client");

  const { data: jobsDone } = useApi<WorkListRow[]>(party && canWork && isDoer ? `work?doerPartyId=${id}` : null);
  const { data: jobsSourced } = useApi<WorkListRow[]>(party && canWork && isSource ? `work?sourcePartyId=${id}` : null);

  const contact = (party?.contact ?? {}) as Record<string, unknown>;
  const email = typeof contact.email === "string" ? contact.email : null;
  const phone = typeof contact.phone === "string" ? contact.phone : null;
  const initial = (party?.displayName ?? "?").trim()[0]?.toUpperCase() ?? "?";

  return (
    <AppShell>
      <Link href="/people" className="mb-3 inline-block text-xs text-slate-400 hover:underline">‹ Team &amp; partners</Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {!isLoading && !error && !party && <EmptyState title="Person not found" />}

      {party && (
        <div className="space-y-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-ink-800 text-lg font-semibold text-slate-200">{initial}</span>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">{party.displayName}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {hats.map((t) => <Badge key={t} tone={HAT_TONE[t] ?? "gray"}>{t}</Badge>)}
                  {hats.length === 0 && <span className="text-xs text-slate-500">no type set</span>}
                </div>
              </div>
            </div>
            {canEdit && !editing && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          </header>

          {editing && canEdit ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Edit person</h2>
              <PartyForm
                initial={{
                  id: party.id,
                  displayName: party.displayName,
                  partyType: party.partyType,
                  externalRef: party.externalRef,
                  universityId: party.universityId,
                  programme: party.programme,
                  contact: party.contact ?? null,
                } satisfies PartyFormInitial}
                onSaved={() => { setEditing(false); void mutate(); }}
                onCancel={() => setEditing(false)}
              />
            </Card>
          ) : (
            <>
              {/* Identity + contact */}
              <Card>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Details</h2>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Detail label="Ref / student ID" value={party.externalRef} />
                  <Detail label="University" value={party.universityCanonical} />
                  <Detail label="Programme" value={party.programme} />
                  <Detail label="Referred by" value={party.referredByName} />
                  <Detail label="Email" value={email} />
                  <Detail label="Phone" value={phone} />
                </dl>
                {party.customFields.length > 0 && (
                  <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-ink-700 pt-3 text-sm sm:grid-cols-4">
                    {party.customFields.map((f) => (
                      <Detail key={f.id} label={`${f.fieldName}${f.required ? " *" : ""}`} value={f.value == null || f.value === "" ? null : String(f.value)} />
                    ))}
                  </dl>
                )}
              </Card>

              {isClient && (
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Client account</h2>
                    <p className="text-xs text-slate-400">This person is also a client — invoices, balance &amp; portal live on the Client 360.</p>
                  </div>
                  <Link href={`/clients/${id}`}><Button variant="secondary">Open Client 360 →</Button></Link>
                </Card>
              )}

              {isDoer && (
                <JobsCard
                  title="Work log — jobs done"
                  emptyTitle="No jobs done yet"
                  jobs={jobsDone}
                  canMoney={canMoney}
                  moneyLabel="you're owed"
                  moneyField="writerAmount"
                />
              )}

              {isSource && (
                <JobsCard
                  title="Jobs sourced"
                  emptyTitle="No sourced jobs yet"
                  jobs={jobsSourced}
                  canMoney={canMoney}
                  moneyLabel="client"
                  moneyField="clientAmount"
                />
              )}

              {hats.includes("vendor") && (
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Vendor claims</h2>
                    <p className="text-xs text-slate-400">Handoffs &amp; claims this vendor has billed us for.</p>
                  </div>
                  {can(perms, "vendor:approve") && <Link href="/vendor-admin"><Button variant="secondary">Open vendor claims →</Button></Link>}
                </Card>
              )}

              {/* Money — running balance register (gated + RLS-scoped) */}
              {canMoney && (isDoer || isSource || hats.includes("vendor")) && (
                <Register path={`billing/register/${id}`} title="Balance register" />
              )}
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium">{value == null || value === "" ? <span className="text-slate-500">—</span> : value}</dd>
    </div>
  );
}

/** A compact spreadsheet-style job list; a money column shows only when present. */
function JobsCard({
  title, emptyTitle, jobs, canMoney, moneyLabel, moneyField,
}: {
  title: string;
  emptyTitle: string;
  jobs: WorkListRow[] | undefined;
  canMoney: boolean;
  moneyLabel: string;
  moneyField: "writerAmount" | "clientAmount";
}) {
  return (
    <Card className="p-0">
      <h2 className="border-b border-ink-700 px-4 py-2.5 text-sm font-semibold">{title}</h2>
      {!jobs || jobs.length === 0 ? (
        <div className="p-4"><EmptyState title={emptyTitle} /></div>
      ) : (
        <ul className="divide-y divide-ink-800">
          {jobs.map((j) => {
            const amt = j[moneyField];
            return (
              <li key={j.id}>
                <Link href={`/work/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-ink-800/60">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      {j.courseCode && <Chip>{j.courseCode}</Chip>}
                      <span className="truncate font-medium">{j.title}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {[j.wordCount ? `${j.wordCount} words` : null, j.unitLabel].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <StateBadge state={j.workState} />
                    {canMoney && amt != null && (
                      <span className="w-28 text-right text-xs text-slate-300">
                        <span className="text-slate-500">{moneyLabel} </span><Money value={amt} />
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
