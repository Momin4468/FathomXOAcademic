"use client";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { type MyProfitShare } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Card, EmptyState, ErrorNote, Money, Spinner } from "@/components/ui";

/**
 * A sharer's own profit-share view (§4.4). Channel-scoped cuts are itemised
 * per-job (their base is that channel's margin — safe); a standing net-profit
 * dividend is shown ONLY as an aggregate total, never per-job, so an individual
 * private-client job's margin can't be isolated.
 */
export default function MySharePage() {
  const { data, error, isLoading } = useApi<MyProfitShare>("channels/profit-share/mine");

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">My profit share</h1>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.jobCount === 0 && data.total === 0 && (
        <EmptyState title="You don't have a profit share yet" hint="Shares appear here once an owner/admin sets one and jobs come in." />
      )}
      {data && (data.jobCount > 0 || data.total !== 0) && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total share to date</h2>
              <p className="mt-1 text-2xl font-semibold"><Money value={data.total} /></p>
            </Card>
            <Card>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Standing dividend (aggregate)</h2>
              <p className="mt-1 text-2xl font-semibold"><Money value={data.dividendTotal} /></p>
              <p className="mt-1 text-xs text-gray-400">A net-profit dividend is shown as a total only.</p>
            </Card>
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-700">Channel-scoped earnings (per job)</h2>
            {data.channelShares.length === 0 ? (
              <EmptyState title="No channel-scoped share yet" hint="Channel shares appear here as jobs come in." />
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white text-sm">
                {data.channelShares.map((s) => (
                  <li key={s.workItemId} className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs text-gray-500">job {s.workItemId.slice(0, 8)} · {formatDate(s.jobDate)}</span>
                    <Money value={s.amount} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
