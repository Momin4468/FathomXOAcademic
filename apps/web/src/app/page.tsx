"use client";
import Link from "next/link";
import { ApiError, useApi } from "@/lib/api";
import { can, type DashboardData, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PersonalFinanceConnectCard } from "@/components/PersonalFinanceConnectCard";
import { WorkList } from "@/components/WorkList";
import { PartyName } from "@/components/PartyName";
import { Button, Card, EmptyState, ErrorNote, Money, Spinner } from "@/components/ui";

export default function HomePage() {
  const { data: me, isLoading } = useApi<WhoAmI>("platform/whoami");
  // Dashboard is feature-flagged; a 404 = feature off (degrade silently to the
  // queues). Any other error is a real failure worth surfacing.
  const { data: dash, error: dashError } = useApi<DashboardData>("dashboard", { shouldRetryOnError: false });
  const dashFailed = dashError instanceof ApiError && dashError.status !== 404;
  const owner = dash?.owner;
  const earnings = dash?.balance?.earnings;
  const charges = dash?.balance?.charges;

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">My open loops</h1>
          <p className="text-xs text-gray-500">What&rsquo;s open and whose move is it?</p>
        </div>
        <div className="flex items-center gap-2">
          {can(me?.permissions, "capture:view") && (
            <Link href="/tasks">
              <Button variant="secondary">Tasks</Button>
            </Link>
          )}
          {can(me?.permissions, "work:create") && (
            <Link href="/work/new">
              <Button>+ Log new</Button>
            </Link>
          )}
        </div>
      </div>

      {isLoading && <Spinner />}

      {dashFailed && <div className="mb-4"><ErrorNote message="Couldn't load your numbers." /></div>}

      {/* ── Owner headline + analytics (only when the API returns the owner section) ── */}
      {owner && (
        <div className="mb-6 space-y-4">
          <Card>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Outstanding client dues</h2>
            <div className="text-2xl font-semibold tabular-nums"><Money value={owner.outstandingDuesTotal} /></div>
            <p className="mt-1 text-xs text-gray-500">
              {owner.pendingClientCount} client{owner.pendingClientCount === 1 ? "" : "s"} owing · {owner.openLoopsTotal} open loop{owner.openLoopsTotal === 1 ? "" : "s"}
            </p>
          </Card>

          <Card>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Business margin (derived)</h2>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-gray-500">revenue</div><div className="font-medium"><Money value={owner.orgMargin.revenue} /></div></div>
              <div><div className="text-xs text-gray-500">writer cost</div><div className="font-medium"><Money value={owner.orgMargin.writerCost} /></div></div>
              <div><div className="text-xs text-gray-500">margin</div><div className="font-semibold"><Money value={owner.orgMargin.margin} /></div></div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Profit per writer</h2>
            {owner.profitPerWriter.length === 0 ? (
              <EmptyState title="No writer activity yet" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {owner.profitPerWriter.map((w) => (
                  <li key={w.writerPartyId} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <span className="font-medium"><PartyName id={w.writerPartyId} /></span>
                      <span className="ml-2 text-xs text-gray-400">{w.jobs} job{w.jobs === 1 ? "" : "s"} · rev <Money value={w.revenue} /> · cost <Money value={w.writerCost} /></span>
                    </div>
                    <span className="font-medium tabular-nums"><Money value={w.profit} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Clients owing</h2>
            {owner.duesByClient.length === 0 ? (
              <EmptyState title="No outstanding client dues" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {owner.duesByClient.map((d) => (
                  <li key={d.clientPartyId} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <span className="font-medium"><PartyName id={d.clientPartyId} /></span>
                      <span className="ml-2 text-xs text-gray-400">invoiced <Money value={d.invoiced} /> · paid <Money value={d.paid} /></span>
                    </div>
                    <span className="font-medium tabular-nums"><Money value={d.due} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ── "My numbers" — the viewer's own position (any party-linked viewer) ── */}
      {dash?.balance && (
        <Card className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">My numbers</h2>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-gray-500">earned (outstanding)</div><div className="font-medium"><Money value={earnings?.outstanding} /></div></div>
            <div><div className="text-xs text-gray-500">earned (total)</div><div className="font-medium"><Money value={earnings?.owed} /></div></div>
            <div><div className="text-xs text-gray-500">dues (outstanding)</div><div className="font-medium"><Money value={charges?.outstanding} /></div></div>
            <div><div className="text-xs text-gray-500">net</div><div className="font-semibold"><Money value={dash.balance.net} /></div></div>
            <div><div className="text-xs text-gray-500">open loops</div><div className="font-medium">{dash.openLoops.count}</div></div>
          </div>
        </Card>
      )}

      {/* Connect to the separate Personal Finance plane — only a party-linked user
          has an income stream to connect (§11). */}
      {me?.party && <PersonalFinanceConnectCard />}

      {me && (
        <div className="space-y-6">
          {/* Admin / approver: the confirmation queue + active work. */}
          {can(me.permissions, "work:approve") && (
            <>
              <WorkList title="Confirmation queue" path="work?workState=pending" emptyHint="No jobs awaiting confirmation." />
              <WorkList title="In progress" path="work?workState=confirmed" emptyHint="No active jobs." />
            </>
          )}

          {/* The viewer's own work (if they're a party / doer). */}
          {me.party && (
            <WorkList title="My work" path={`work?doerPartyId=${me.party.id}`} emptyHint="You have no assigned work yet." />
          )}

          {/* Fallback for a work:view role that's neither approver nor a doer. */}
          {!can(me.permissions, "work:approve") && !me.party && can(me.permissions, "work:view") && (
            <WorkList title="Work" path="work" emptyHint="No work items." />
          )}
        </div>
      )}
    </AppShell>
  );
}
