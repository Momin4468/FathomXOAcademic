"use client";
import type { CSSProperties } from "react";
import { useApi } from "@/lib/api";
import { type MyProfitShare } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { cell, DGrid, EmptyBox, fmtDay, Loading, money, Note, Page, StatCards, T } from "@/components/dc";

/**
 * A sharer's own profit-share view (§4.4). Channel-scoped cuts are itemised
 * per-job (their base is that channel's margin — safe); a standing net-profit
 * dividend is shown ONLY as an aggregate total, never per-job, so an individual
 * private-client job's margin can't be isolated.
 */
const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "22px 0 10px" };

export default function MySharePage() {
  const { data, error, isLoading } = useApi<MyProfitShare>("channels/profit-share/mine");

  return (
    <AppShell>
      <Page title="My profit share" sub="your channel cuts per job; a standing dividend is shown as a total only">
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && data.jobCount === 0 && data.total === 0 && (
          <EmptyBox title="You don't have a profit share yet" hint="Shares appear here once an owner/admin sets one and jobs come in." />
        )}
        {data && (data.jobCount > 0 || data.total !== 0) && (
          <>
            <StatCards
              min={220}
              items={[
                { label: "Total share to date", value: money(data.total), tone: "gold" },
                { label: "Standing dividend (aggregate)", value: money(data.dividendTotal), tone: "purple", note: "a net-profit dividend is shown as a total only" },
              ]}
            />
            <h2 style={sectionH}>Channel-scoped earnings (per job)</h2>
            <DGrid<MyProfitShare["channelShares"][number]>
              minWidth={360}
              rows={data.channelShares}
              keyOf={(s) => s.workItemId}
              cols={[
                { label: "Job", render: (s) => cell(`job ${s.workItemId.slice(0, 8)}`, { mono: true, sub: fmtDay(s.jobDate) }) },
                { label: "Amount", align: "right", render: (s) => cell(money(s.amount), { nums: true, weight: 600 }) },
              ]}
              empty="No channel-scoped share yet — channel shares appear here as jobs come in."
            />
          </>
        )}
      </Page>
    </AppShell>
  );
}
