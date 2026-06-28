import { Injectable } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { BalanceService } from "../billing/balance.service.js";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

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
}
