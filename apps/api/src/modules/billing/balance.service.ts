import { Injectable } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import { derivePosition, round2 } from "@business-os/shared";
import { OpeningBalanceService } from "./opening-balance.service.js";

/**
 * A party's two-way balance (DESIGN_SPEC §6 + bidirectional ledger): earnings
 * owed to them (legs to them − payouts) vs charges they owe (party→business,
 * itemized) − settled, netting to a position. Computed under the CALLER'S RLS:
 * the self endpoint runs as the party, so legs/charges are their own; a platform
 * fee surfaces as a due. Cross-party (admin) views are RLS-limited by design
 * (full business-wide is SuperAdmin / the settlement layer, Phase 2).
 */
@Injectable()
export class BalanceService {
  async balance(tx: Db, partyId: string | null) {
    if (!partyId) {
      return {
        partyId: null,
        earnings: { owed: 0, paid: 0, outstanding: 0 },
        charges: { owed: 0, paid: 0, outstanding: 0, items: [] as unknown[] },
        net: 0,
      };
    }

    // Earnings owed = legs to this party (RLS shows the party's own legs).
    const earnOwed = await tx.execute(sql`
      select coalesce(sum(amount), 0) as v from leg where to_party_id = ${partyId}
    `);
    // Earnings paid out = allocations to this party (writer-aggregate side).
    const earnPaid = await tx.execute(sql`
      select coalesce(sum(amount), 0) as v from payment_allocation where writer_party_id = ${partyId}
    `);
    // Charges owed = this party's charges (RLS own; includes reversals → net).
    const chOwed = await tx.execute(sql`
      select coalesce(sum(amount), 0) as v from charge where party_id = ${partyId}
    `);
    // Charges paid = allocations settling this party's charges.
    const chPaid = await tx.execute(sql`
      select coalesce(sum(pa.amount), 0) as v
      from payment_allocation pa
      where pa.charge_id in (select id from charge where party_id = ${partyId})
    `);

    const earningsOwed = Number((earnOwed.rows[0] as { v: string }).v);
    const earningsPaid = Number((earnPaid.rows[0] as { v: string }).v);
    const chargesOwed = Number((chOwed.rows[0] as { v: string }).v);
    const chargesPaid = Number((chPaid.rows[0] as { v: string }).v);

    // Itemized charges ("amount to be paid" + settled per charge).
    const items = await tx.execute(sql`
      select c.id, c.category, c.amount, c.reason, c.work_item_id as "workItemId", c.created_at as "createdAt",
             coalesce((select sum(pa.amount) from payment_allocation pa where pa.charge_id = c.id), 0) as settled
      from charge c
      where c.party_id = ${partyId}
      order by c.created_at
    `);

    // Opening balance (Phase 5): a signed, dated starting point (+ owed to the
    // party, − owed by them). Derived at read and folded into the net position —
    // never a fake backdated leg/payment.
    const openingBalance = await OpeningBalanceService.sumForParty(tx, partyId);

    const pos = derivePosition({ earningsOwed, earningsPaid, chargesOwed, chargesPaid });
    return {
      partyId,
      openingBalance,
      earnings: { owed: earningsOwed, paid: earningsPaid, outstanding: pos.earningsOutstanding },
      charges: {
        owed: chargesOwed,
        paid: chargesPaid,
        outstanding: pos.chargesOutstanding,
        items: (items.rows as Array<Record<string, unknown>>).map((c) => ({
          ...c,
          due: Number(c.amount) - Number(c.settled),
        })),
      },
      net: pos.net + openingBalance,
    };
  }

  /**
   * A QuickBooks-style running-balance REGISTER for a party — a time-ordered ledger
   * (opening balance, earnings accrued, payouts received, charges owed, charge
   * settlements) with a running balance, all under the CALLER's RLS so it's
   * opacity-safe (an admin sees only the ledger BETWEEN them and the party; the
   * party's own view is complete). The final running balance reconciles to
   * `balance().net`. Each row's `delta` is signed toward the party's favour:
   * `+` = owed to them, `−` = they owe / were paid.
   */
  async register(tx: Db, partyId: string | null): Promise<{ rows: Array<{ date: string; kind: string; ref: string | null; delta: number; running: number }>; net: number }> {
    if (!partyId) return { rows: [], net: 0 };
    const res = await tx.execute(sql`
      select date, kind, ref, delta from (
        select ob.as_of::timestamptz as date, 'Opening balance' as kind, ob.note as ref, ob.amount::numeric as delta
          from opening_balance ob where ob.party_id = ${partyId}
        union all
        select l.created_at, 'Earned', coalesce(w.title, 'work'), l.amount::numeric
          from leg l left join work_item w on w.id = l.work_item_id where l.to_party_id = ${partyId}
        union all
        select p.paid_at::timestamptz, 'Payout', p.medium, -pa.amount::numeric
          from payment_allocation pa join payment p on p.id = pa.payment_id where pa.writer_party_id = ${partyId}
        union all
        select c.created_at, 'Charge', c.category, -c.amount::numeric
          from charge c where c.party_id = ${partyId}
        union all
        select p.paid_at::timestamptz, 'Charge paid', p.medium, pa.amount::numeric
          from payment_allocation pa join payment p on p.id = pa.payment_id
          where pa.charge_id in (select id from charge where party_id = ${partyId})
      ) t order by date asc
    `);
    let running = 0;
    const rows = (res.rows as Array<{ date: string; kind: string; ref: string | null; delta: string }>).map((r) => {
      const delta = round2(Number(r.delta));
      running = round2(running + delta);
      return { date: r.date, kind: r.kind, ref: r.ref, delta, running };
    });
    return { rows, net: running };
  }
}
