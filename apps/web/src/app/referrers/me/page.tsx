"use client";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { type MyReferrals } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Card, EmptyState, ErrorNote, Money, Spinner } from "@/components/ui";

/**
 * The referrer self-view (§4.5: "own referral income · own referred R"). Shows
 * ONLY this referrer's own slice — their earnings and the works that generated
 * them. Never the chain or the client price (the API/RLS redact those entirely).
 */
export default function MyReferralsPage() {
  const { data, error, isLoading } = useApi<MyReferrals>("referrers/me");
  const earnings = data?.balance?.earnings;

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">My referrals</h1>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}

      {data && (
        <>
          <Card className="mb-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Referral income</h2>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-400">earned</div>
                <div className="font-semibold"><Money value={earnings?.owed} /></div>
              </div>
              <div>
                <div className="text-xs text-slate-400">paid out</div>
                <div className="font-medium"><Money value={earnings?.paid} /></div>
              </div>
              <div>
                <div className="text-xs text-slate-400">outstanding</div>
                <div className="font-medium"><Money value={earnings?.outstanding} /></div>
              </div>
            </div>
          </Card>

          <h2 className="mb-2 text-sm font-semibold text-slate-200">Works you referred</h2>
          {data.works.length === 0 ? (
            <EmptyState title="No referral income yet" hint="Referrals attached to jobs you brought in will appear here." />
          ) : (
            <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
              {data.works.map((w) => (
                <li key={w.workItemId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="text-sm">
                    <span className="font-medium">{w.title}</span>
                    {w.clientName && <span className="ml-2 text-xs text-slate-400">· {w.clientName}</span>}
                    <div className="mt-0.5 text-xs text-slate-400">{formatDate(w.referralAt)}</div>
                  </div>
                  <div className="text-sm font-medium tabular-nums"><Money value={w.referralAmount} /></div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AppShell>
  );
}
