import { Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";

/**
 * The "my numbers" overview (§8/§11) — earned → loans → expenses → savings.
 * Everything DERIVED at read. Headline totals are summed in the account's BASE
 * currency only (we never convert — §11 no forced FX); per-entry lists keep their
 * own currency. The current month is the window for income/expense/net.
 */
@Injectable()
export class PfDashboardService {
  async overview(tx: Db, pfAccountId: string) {
    const acctRes = await tx.execute(sql`
      select display_name as "displayName", base_currency as "baseCurrency", linked_party_id as "linkedPartyId"
      from pf_account where id = ${pfAccountId}
    `);
    const acct = acctRes.rows[0] as { displayName: string | null; baseCurrency: string; linkedPartyId: string | null } | undefined;
    if (!acct) throw new NotFoundException("Account not found");
    const base = acct.baseCurrency;

    const monthRes = await tx.execute(sql`
      select
        coalesce((select sum(amount) from pf_income
          where currency = ${base}
            and occurred_on >= date_trunc('month', current_date)::date
            and occurred_on < (date_trunc('month', current_date) + interval '1 month')::date), 0) as income,
        coalesce((select sum(amount) from pf_expense
          where currency = ${base}
            and occurred_on >= date_trunc('month', current_date)::date
            and occurred_on < (date_trunc('month', current_date) + interval '1 month')::date), 0) as expense
    `);
    const month = monthRes.rows[0] as { income: string; expense: string };
    const net = Number(month.income) - Number(month.expense);

    const loanRes = await tx.execute(sql`
      select l.direction,
        coalesce(sum(l.principal
          + coalesce((select sum(e.amount) from pf_loan_event e where e.loan_id = l.id and e.kind = 'disbursement'), 0)
          - coalesce((select sum(e.amount) from pf_loan_event e where e.loan_id = l.id and e.kind = 'repayment'), 0)
          + coalesce((select sum(e.amount) from pf_loan_event e where e.loan_id = l.id and e.kind = 'adjustment'), 0)
        ), 0) as outstanding
      from pf_loan l
      where l.archived_at is null and l.currency = ${base}
      group by l.direction
    `);
    let loansGivenOutstanding = 0;
    let loansTakenOutstanding = 0;
    for (const r of loanRes.rows as Array<{ direction: string; outstanding: string }>) {
      if (r.direction === "given") loansGivenOutstanding = Number(r.outstanding);
      if (r.direction === "taken") loansTakenOutstanding = Number(r.outstanding);
    }

    const savingRes = await tx.execute(sql`
      select coalesce(sum(case when e.kind = 'deposit' then e.amount else -e.amount end), 0) as balance
      from pf_saving s
      join pf_saving_event e on e.saving_id = s.id
      where s.archived_at is null and s.currency = ${base}
    `);
    const savingsTotal = Number((savingRes.rows[0] as { balance: string }).balance);

    // Investments: Σ current value = latest non-reversed valuation + net cash flows
    // recorded after that mark (else cost basis). Mirrors PfInvestmentService.list —
    // a post-mark contribution raises value 1:1, never a phantom P/L swing.
    const invRes = await tx.execute(sql`
      select coalesce(sum(
        case when lv.amount is not null then lv.amount + post.flow
             else i.principal + coalesce(c.contrib, 0) - coalesce(w.withd, 0) end
      ), 0) as total
      from pf_investment i
      left join lateral (
        select v.amount, v.occurred_on as vo from pf_investment_event v
        where v.investment_id = i.id and v.kind = 'valuation' and v.reverses_id is null
          and not exists (select 1 from pf_investment_event r where r.reverses_id = v.id)
        order by v.occurred_on desc, v.created_at desc limit 1
      ) lv on true
      left join lateral (
        select coalesce(sum(case when e2.kind = 'contribution' then e2.amount when e2.kind = 'withdrawal' then -e2.amount else 0 end), 0) as flow
        from pf_investment_event e2 where e2.investment_id = i.id and lv.amount is not null and e2.occurred_on > lv.vo
      ) post on true
      left join lateral (select coalesce(sum(amount), 0) as contrib from pf_investment_event where investment_id = i.id and kind = 'contribution') c on true
      left join lateral (select coalesce(sum(amount), 0) as withd from pf_investment_event where investment_id = i.id and kind = 'withdrawal') w on true
      where i.archived_at is null and i.currency = ${base}
    `);
    const investmentsTotal = Number((invRes.rows[0] as { total: string }).total);

    // Cash-on-hand = the most-recent declared check-in (base currency), else 0.
    const cashRes = await tx.execute(sql`
      select declared_amount as "declared" from pf_cash_checkin
      where currency = ${base} order by as_of desc, created_at desc limit 1
    `);
    const cashOnHand = cashRes.rows[0] ? Number((cashRes.rows[0] as { declared: string }).declared) : 0;

    // Net worth is a STOCK (assets − liabilities). Income/expense run-rates are FLOWS,
    // surfaced alongside (monthlyFlow) but never summed into the stock.
    const netWorthValue = savingsTotal + investmentsTotal + loansGivenOutstanding - loansTakenOutstanding + cashOnHand;

    const upcomingRes = await tx.execute(sql`
      select id, name, amount, currency, next_due_date as "nextDueDate"
      from pf_subscription
      where archived_at is null and next_due_date is not null
        and next_due_date >= current_date and next_due_date < (current_date + 30)
      order by next_due_date asc
      limit 5
    `);

    const recentRes = await tx.execute(sql`
      (select 'income' as kind, id, amount, currency, occurred_on as "occurredOn", note from pf_income where reverses_id is null)
      union all
      (select 'expense' as kind, id, amount, currency, occurred_on as "occurredOn", note from pf_expense where reverses_id is null)
      order by "occurredOn" desc
      limit 8
    `);

    return {
      displayName: acct.displayName,
      baseCurrency: base,
      linked: acct.linkedPartyId != null,
      month: { income: month.income, expense: month.expense, net: String(net) },
      loans: { givenOutstanding: String(loansGivenOutstanding), takenOutstanding: String(loansTakenOutstanding) },
      savingsTotal: String(savingsTotal),
      investmentsTotal: String(investmentsTotal),
      cashOnHand: String(cashOnHand),
      netWorth: {
        value: String(netWorthValue),
        assets: {
          savings: String(savingsTotal),
          investments: String(investmentsTotal),
          receivable: String(loansGivenOutstanding),
          cash: String(cashOnHand),
        },
        liabilities: { owed: String(loansTakenOutstanding) },
        monthlyFlow: { income: month.income, expense: month.expense, net: String(net) },
      },
      upcomingSubscriptions: upcomingRes.rows,
      recent: recentRes.rows,
    };
  }
}
