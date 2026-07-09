import { Injectable } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { round2 } from "@business-os/shared";
import { desc, eq } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";
import type { CreatePfCashCheckinDto } from "./pf-cash.dto.js";

const day = (s: string) => s.slice(0, 10);

export type PfCheckinRow = { id: string; asOf: string; declaredAmount: string; currency: string; note: string | null };

/**
 * Periodic cash check-in (§11, 0047) — the user declares cash-on-hand; the system
 * surfaces the discrepancy vs. what the ledger implies. A snapshot is an append-only
 * fact (fix a mistake by adding a newer one). The discrepancy is DERIVED at read:
 *   expected = prior declaration + netLiquidFlow(prior.as_of, latest.as_of)
 *   discrepancy = declared_now − expected           // unrecorded cash movement
 * "Liquid-cash" flow: income in, expense out, and moving cash into a savings pot /
 * an investment / a loan-given all count as leaving the wallet. The delta and its
 * suggested adjustment are informational — nothing is ever auto-written.
 */
@Injectable()
export class PfCashService {
  constructor(private readonly audit: PfAuditService) {}

  async createCheckin(tx: Db, pfAccountId: string, dto: CreatePfCashCheckinDto) {
    const [row] = await tx
      .insert(schema.pfCashCheckin)
      .values({ pfAccountId, asOf: day(dto.asOf), declaredAmount: String(dto.declaredAmount), currency: dto.currency ?? "BDT", note: dto.note ?? null })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.cash_checkin_recorded", entity: "pf_cash_checkin", entityId: row!.id });
    return row!;
  }

  listCheckins(tx: Db) {
    return tx.select().from(schema.pfCashCheckin).orderBy(desc(schema.pfCashCheckin.asOf), desc(schema.pfCashCheckin.createdAt));
  }

  /** The reconcile view for the two most-recent check-ins. */
  async reconcile(tx: Db, pfAccountId: string) {
    const base = await this.baseCurrency(tx, pfAccountId);
    const rows = (await tx
      .select()
      .from(schema.pfCashCheckin)
      .orderBy(desc(schema.pfCashCheckin.asOf), desc(schema.pfCashCheckin.createdAt))
      .limit(2)) as PfCheckinRow[];

    if (rows.length === 0) return { status: "none" as const, latest: null };
    const latest = rows[0]!;
    // First-ever check-in: no prior baseline to reconcile against — it just anchors.
    if (rows.length === 1) {
      return { status: "baseline" as const, latest, prior: null, netFlow: null, expected: null, discrepancy: null, suggestedAdjustment: null };
    }
    const prior = rows[1]!;
    const netFlow = await this.netLiquidFlow(tx, base, prior.asOf, latest.asOf);
    const expected = round2(Number(prior.declaredAmount) + netFlow);
    const discrepancy = round2(Number(latest.declaredAmount) - expected);
    const status = Math.abs(discrepancy) < 0.005 ? ("reconciled" as const) : discrepancy > 0 ? ("over" as const) : ("under" as const);
    // Optional, user-confirmed nudge — NOT persisted here.
    const suggestedAdjustment =
      status === "reconciled" ? null : { kind: discrepancy > 0 ? ("income" as const) : ("expense" as const), amount: round2(Math.abs(discrepancy)), currency: base };

    return { status, latest, prior, netFlow: round2(netFlow), expected, discrepancy, suggestedAdjustment };
  }

  private async baseCurrency(tx: Db, pfAccountId: string): Promise<string> {
    const [a] = await tx.select({ base: schema.pfAccount.baseCurrency }).from(schema.pfAccount).where(eq(schema.pfAccount.id, pfAccountId));
    return a?.base ?? "BDT";
  }

  /**
   * Net cash that left/entered the wallet over (from, to], base currency only:
   * income − expense − Δsavings − Δinvestment-contributions − net-lent + net-borrowed.
   * Reversal rows (negated mirrors, same date) net themselves out. Valuations and
   * loan `adjustment`s are NOT cash movements → excluded.
   */
  private async netLiquidFlow(tx: Db, base: string, from: string, to: string): Promise<number> {
    const res = await tx.execute(sql`
      select (
        coalesce((select sum(amount) from pf_income
          where currency = ${base} and occurred_on > ${from} and occurred_on <= ${to}), 0)
        - coalesce((select sum(amount) from pf_expense
          where currency = ${base} and occurred_on > ${from} and occurred_on <= ${to}), 0)
        - coalesce((select sum(case when se.kind = 'deposit' then se.amount else -se.amount end)
          from pf_saving_event se join pf_saving s on s.id = se.saving_id
          where s.currency = ${base} and se.occurred_on > ${from} and se.occurred_on <= ${to}), 0)
        - coalesce((select sum(case when ie.kind = 'contribution' then ie.amount when ie.kind = 'withdrawal' then -ie.amount else 0 end)
          from pf_investment_event ie join pf_investment i on i.id = ie.investment_id
          where i.currency = ${base} and ie.occurred_on > ${from} and ie.occurred_on <= ${to}), 0)
        - coalesce((select sum(case when le.kind = 'disbursement' then le.amount when le.kind = 'repayment' then -le.amount else 0 end)
          from pf_loan_event le join pf_loan l on l.id = le.loan_id
          where l.direction = 'given' and l.currency = ${base} and le.occurred_on > ${from} and le.occurred_on <= ${to}), 0)
        + coalesce((select sum(case when le.kind = 'disbursement' then le.amount when le.kind = 'repayment' then -le.amount else 0 end)
          from pf_loan_event le join pf_loan l on l.id = le.loan_id
          where l.direction = 'taken' and l.currency = ${base} and le.occurred_on > ${from} and le.occurred_on <= ${to}), 0)
      ) as net_flow
    `);
    return Number((res.rows[0] as { net_flow: string }).net_flow);
  }
}
