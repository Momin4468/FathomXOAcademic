"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  can,
  type Balance,
  type Invoice,
  type Outcome,
  type PartyDetail,
  type VaultItem,
  type WhoAmI,
  type WorkListRow,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { BalanceView } from "@/components/BalanceView";
import { StateBadge, Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";

/**
 * Client-360 — a viewer-scoped hub. Every section is gated by the viewer's
 * permission AND fetched under their RLS; a section the viewer can't see simply
 * doesn't render (no figure a role can't access). Money via <Money> (redacted).
 */
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const perms = me?.permissions;

  const { data: party, error, isLoading } = useApi<PartyDetail>(`parties/${id}`);
  // Gated fetches — null path = skipped (and never attempted without permission).
  const { data: jobs } = useApi<WorkListRow[]>(can(perms, "work:view") ? `work?sourcePartyId=${id}` : null);
  const { data: invoices } = useApi<Invoice[]>(can(perms, "billing:view") ? `invoices?clientPartyId=${id}` : null);
  const { data: balance } = useApi<Balance>(can(perms, "billing:view") ? `billing/balance/${id}` : null);
  const { data: creds } = useApi<VaultItem[]>(can(perms, "credential_vault:view") ? `vault/items?clientPartyId=${id}` : null);
  const { data: outcomes } = useApi<Outcome[]>(can(perms, "outcomes:view") ? "outcomes" : null);

  const jobIds = new Set((jobs ?? []).map((j) => j.id));
  const clientOutcomes = (outcomes ?? []).filter((o) => jobIds.has(o.workItemId));

  return (
    <AppShell>
      <Link href="/clients" className="mb-3 inline-block text-xs text-gray-500 hover:underline">← Clients</Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {party && (
        <div className="space-y-5">
          <header>
            <h1 className="text-lg font-semibold tracking-tight">{party.displayName}</h1>
            <p className="mt-1 text-xs text-gray-500">
              {(party.partyType ?? []).join(", ")}
              {party.universityCanonical ? ` · ${party.universityCanonical}` : ""}
              {party.programme ? ` · ${party.programme}` : ""}
              {party.referredByName ? ` · referred by ${party.referredByName}` : ""}
            </p>
          </header>

          {/* Custom fields */}
          {party.customFields.length > 0 && (
            <Card>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Custom fields</p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {party.customFields.map((f) => (
                  <div key={f.id}>
                    <dt className="text-xs text-gray-500">{f.fieldName}{f.required ? " *" : ""}</dt>
                    <dd className="font-medium">{f.value == null || f.value === "" ? <span className="text-gray-400">—</span> : String(f.value)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {/* Balance / dues */}
          {balance && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Balance</h2>
              <BalanceView balance={balance} />
            </section>
          )}

          {/* Jobs */}
          {jobs && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Jobs ({jobs.length})</h2>
              {jobs.length === 0 ? (
                <EmptyState title="No jobs" />
              ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {jobs.map((j) => {
                    const oc = clientOutcomes.find((o) => o.workItemId === j.id);
                    return (
                      <li key={j.id}>
                        <Link href={`/work/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-gray-50">
                          <span className="font-medium">{j.title}</span>
                          <span className="flex items-center gap-1">
                            {oc?.failed && <Badge tone="red">failed</Badge>}
                            {oc?.grade && <Badge tone="gray">{oc.grade}</Badge>}
                            <StateBadge state={j.workState} />
                            <StateBadge state={j.moneyState} />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* Invoices */}
          {invoices && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Invoices ({invoices.length})</h2>
              {invoices.length === 0 ? (
                <EmptyState title="No invoices" />
              ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {invoices.map((v) => (
                    <li key={v.id}>
                      <Link href={`/invoices/${v.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-gray-50">
                        <span>{formatDate(v.createdAt)}{v.isEstimate ? " · estimate" : ""}</span>
                        <StateBadge state={v.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Stored credentials (metadata only) */}
          {creds && creds.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Credentials</h2>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {creds.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="font-medium">{c.name} <Badge tone="blue">{c.type}</Badge></span>
                    <Link href="/vault" className="text-xs text-gray-500 hover:underline">reveal in Vault →</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}
