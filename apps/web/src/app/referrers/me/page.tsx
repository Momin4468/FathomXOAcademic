"use client";
import type { CSSProperties } from "react";
import { useApi } from "@/lib/api";
import { type MyReferrals } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { cell, DGrid, fmtDay, Loading, money, Note, Page, StatCards, T, type Stat } from "@/components/dc";

/**
 * The referrer self-view (§4.5: "own referral income · own referred R"). Shows
 * ONLY this referrer's own slice — their earnings and the works that generated
 * them. Never the chain or the client price (the API/RLS redact those entirely).
 */
const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "22px 0 10px" };

export default function MyReferralsPage() {
  const { data, error, isLoading } = useApi<MyReferrals>("referrers/me");
  const earnings = data?.balance?.earnings;

  const stats: Stat[] = [
    { label: "Earned", value: money(earnings?.owed), tone: "green" },
    { label: "Paid out", value: money(earnings?.paid), tone: "blue" },
    { label: "Outstanding", value: money(earnings?.outstanding), tone: "amber" },
  ];

  return (
    <AppShell>
      <Page title="My referrals" sub="your referral income and the works that generated it">
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <>
            <StatCards items={stats} min={180} />
            <h2 style={sectionH}>Works you referred</h2>
            <DGrid<MyReferrals["works"][number]>
              rows={data.works}
              keyOf={(w) => w.workItemId}
              cols={[
                { label: "Work", render: (w) => cell(w.title, { weight: 500, sub: w.clientName ?? undefined }) },
                { label: "Referred", render: (w) => <span style={{ color: T.muted2 }}>{fmtDay(w.referralAt)}</span> },
                { label: "Amount", align: "right", render: (w) => cell(money(w.referralAmount), { nums: true, weight: 600 }) },
              ]}
              empty="No referral income yet — referrals attached to jobs you brought in will appear here."
            />
          </>
        )}
      </Page>
    </AppShell>
  );
}
