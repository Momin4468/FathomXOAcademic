import { Injectable } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { round2, type SessionPrincipal } from "@business-os/shared";
import { inArray } from "drizzle-orm";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { BalanceService } from "../billing/balance.service.js";

const num = (v: unknown): number => round2(Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));


/**
 * Role-scoped dashboards (DESIGN_SPEC §8, §10) — composes existing derived
 * read-models under the VIEWER's RLS so per-viewer sections are self-scoped by
 * construction. The owner analytics (profit-per-writer, org margin, all-client
 * dues) come from aggregate-only SECURITY DEFINERs and are included ONLY for a
 * viewer with the analytics gate — so the UI can't render a figure the role
 * isn't entitled to. Everything derived; nothing stored.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly balances: BalanceService) {}

  async getDashboard(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions) {
    const canAnalytics = principal.isSystemSuperadmin || perms.perms.has("dashboard:approve");
    const canSeeAllLoops = canAnalytics || perms.perms.has("work:approve");

    // The viewer's own two-way position (earnings/dues) — RLS-scoped to them.
    const balance = principal.partyId ? await this.balances.balance(tx, principal.partyId) : null;

    // Open loops = unclosed work (not delivered OR not settled). Doer-scoped for
    // non-approvers (§4.5 "job counts: Writer own / Manager scoped").
    const loopRows = await tx.execute(sql`
      select count(*)::int as c
      from work_item
      where archived_at is null
        and (work_state <> 'delivered' or money_state <> 'settled')
        ${canSeeAllLoops ? sql`` : sql`and doer_party_id = ${principal.partyId}`}
    `);
    const openLoops = {
      count: Number((loopRows.rows[0] as { c: number }).c),
      scope: canSeeAllLoops ? ("all" as const) : ("mine" as const),
    };

    const base = { balance, openLoops };
    if (!canAnalytics) return base;

    // ── owner analytics (aggregate-only definers; rollups, never raw legs) ──
    const duesRows = await tx.execute(sql`
      select client_party_id as "clientPartyId", invoiced, paid, due
      from dashboard_client_dues() order by due desc
    `);
    const profitRows = await tx.execute(sql`
      select writer_party_id as "writerPartyId", jobs, revenue, writer_cost as "writerCost", net
      from dashboard_writer_pnl() order by net desc
    `);
    const duesByClient = (duesRows.rows as Array<Record<string, unknown>>).map((r) => ({
      clientPartyId: r.clientPartyId as string,
      invoiced: round2(Number(r.invoiced)),
      paid: round2(Number(r.paid)),
      due: round2(Number(r.due)),
    }));
    const profitPerWriter = (profitRows.rows as Array<Record<string, unknown>>).map((r) => ({
      writerPartyId: r.writerPartyId as string,
      jobs: Number(r.jobs),
      revenue: round2(Number(r.revenue)),
      writerCost: round2(Number(r.writerCost)),
      profit: round2(Number(r.net)), // derived in TS; SQL exposes it as `net`
    }));
    const outstandingDuesTotal = round2(duesByClient.reduce((s, d) => s + d.due, 0));
    const orgMargin = {
      revenue: round2(profitPerWriter.reduce((s, w) => s + w.revenue, 0)),
      writerCost: round2(profitPerWriter.reduce((s, w) => s + w.writerCost, 0)),
      margin: round2(profitPerWriter.reduce((s, w) => s + w.profit, 0)),
    };

    return {
      ...base,
      owner: {
        outstandingDuesTotal,
        pendingClientCount: duesByClient.length,
        duesByClient,
        profitPerWriter,
        orgMargin,
        openLoopsTotal: openLoops.count, // canSeeAllLoops is true here
      },
    };
  }

  /**
   * The writer leaderboard. The VOLUME board (job counts) is returned to every
   * viewer (§4.5 "job counts" are org-visible; no money). Reputation
   * (reliability/on-time/fail) and the profit-per-writer margin ranking are added
   * ONLY for an analytics approver — a non-owner payload carries volume columns
   * and nothing else, so the opacity guarantee holds by construction.
   */
  async leaderboard(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions) {
    const canAnalytics = principal.isSystemSuperadmin || perms.perms.has("dashboard:approve");

    const volRows = (
      await tx.execute(sql`
        select party_id as "partyId", total_jobs as "totalJobs", delivered, open_jobs as "openJobs"
        from dashboard_work_volume()
        order by total_jobs desc, delivered desc
      `)
    ).rows as Array<{ partyId: string; totalJobs: number; delivered: number; openJobs: number }>;
    const ids = new Set<string>(volRows.map((v) => v.partyId));

    let repRaw: Array<Record<string, unknown>> = [];
    let profitRaw: Array<Record<string, unknown>> = [];
    if (canAnalytics) {
      repRaw = (
        await tx.execute(sql`
          select writer_party_id as "writerPartyId", jobs, on_time_rate as "onTimeRate",
                 avg_days_late as "avgDaysLate", revision_rate as "revisionRate",
                 complaints, failed, fail_rate as "failRate", avg_ai_score as "avgAiScore",
                 reliability_score as "reliabilityScore"
          from dashboard_writer_reputation()
          order by reliability_score desc nulls last, jobs desc
        `)
      ).rows as Array<Record<string, unknown>>;
      repRaw.forEach((r) => ids.add(r.writerPartyId as string));
      profitRaw = (
        await tx.execute(sql`
          select writer_party_id as "writerPartyId", jobs, revenue, writer_cost as "writerCost", net
          from dashboard_writer_pnl() order by net desc
        `)
      ).rows as Array<Record<string, unknown>>;
      profitRaw.forEach((r) => ids.add(r.writerPartyId as string));
    }

    const names = await this.partyNames(tx, [...ids]);
    const volume = volRows.map((v) => ({
      partyId: v.partyId,
      displayName: names.get(v.partyId) ?? null,
      totalJobs: Number(v.totalJobs),
      delivered: Number(v.delivered),
      openJobs: Number(v.openJobs),
    }));

    if (!canAnalytics) return { scope: "member" as const, volume };

    return {
      scope: "owner" as const,
      volume,
      reputation: repRaw.map((r) => ({
        writerPartyId: r.writerPartyId as string,
        displayName: names.get(r.writerPartyId as string) ?? null,
        jobs: Number(r.jobs),
        onTimeRate: numOrNull(r.onTimeRate),
        avgDaysLate: numOrNull(r.avgDaysLate),
        revisionRate: numOrNull(r.revisionRate),
        complaints: Number(r.complaints),
        failed: Number(r.failed),
        failRate: numOrNull(r.failRate),
        avgAiScore: numOrNull(r.avgAiScore),
        reliabilityScore: numOrNull(r.reliabilityScore),
      })),
      profitPerWriter: profitRaw.map((r) => ({
        writerPartyId: r.writerPartyId as string,
        displayName: names.get(r.writerPartyId as string) ?? null,
        jobs: Number(r.jobs),
        revenue: num(r.revenue),
        writerCost: num(r.writerCost),
        profit: num(r.net), // derived in TS; SQL exposes it as `net`
      })),
    };
  }

  /**
   * Chart series for the analytics page. Owner-only (in-service): org net + the
   * monthly net trend + expense breakdown/trend. A non-owner gets `scope:"member"`
   * and NO owner keys — their personal KPIs come from getDashboard (own balance).
   */
  async charts(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions) {
    const canAnalytics = principal.isSystemSuperadmin || perms.perms.has("dashboard:approve");
    if (!canAnalytics) return { scope: "member" as const };

    const netRow = (await tx.execute(sql`select revenue, writer_cost as "writerCost", net from dashboard_org_net()`))
      .rows[0] as { revenue: unknown; writerCost: unknown; net: unknown } | undefined;
    const orgNet = {
      revenue: num(netRow?.revenue ?? 0),
      writerCost: num(netRow?.writerCost ?? 0),
      net: num(netRow?.net ?? 0),
    };

    const netMonthly = (
      await tx.execute(sql`
        select to_char(month, 'YYYY-MM') as month, revenue, writer_cost as "writerCost", net
        from dashboard_org_net_monthly()
      `)
    ).rows.map((m) => {
      const r = m as { month: string; revenue: unknown; writerCost: unknown; net: unknown };
      return { month: r.month, revenue: num(r.revenue), writerCost: num(r.writerCost), net: num(r.net) };
    });

    const expRows = (
      await tx.execute(sql`select to_char(month, 'YYYY-MM') as month, category, total from dashboard_expense_totals()`)
    ).rows as Array<{ month: string; category: string; total: unknown }>;
    const byCat = new Map<string, number>();
    const byMonth = new Map<string, number>();
    for (const e of expRows) {
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.total));
      byMonth.set(e.month, (byMonth.get(e.month) ?? 0) + Number(e.total));
    }

    return {
      scope: "owner" as const,
      orgNet,
      netMonthly,
      expenseByCategory: [...byCat.entries()]
        .map(([category, total]) => ({ category, total: round2(total) }))
        .sort((a, b) => b.total - a.total),
      expenseMonthly: [...byMonth.entries()]
        .map(([month, total]) => ({ month, total: round2(total) }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  /** Batch-resolve party display names (org-scoped by RLS; names are not money). */
  private async partyNames(tx: Db, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: schema.party.id, displayName: schema.party.displayName })
      .from(schema.party)
      .where(inArray(schema.party.id, ids));
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }
}
