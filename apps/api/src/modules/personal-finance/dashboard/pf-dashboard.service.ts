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
      upcomingSubscriptions: upcomingRes.rows,
      recent: recentRes.rows,
    };
  }
}
