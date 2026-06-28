import { Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { eq } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";
import type { CreatePfTargetDto } from "./pf-target.dto.js";

const day = (s: string) => s.slice(0, 10);

/**
 * Targets / budgets (§11). PROGRESS is DERIVED at read from the entry sums over
 * the target's window — never stored. budget_cap sums expenses, income_goal sums
 * income, savings_target sums net savings movements (all RLS-scoped to the
 * account). The window is [period_start, period_start + 1 month|year).
 */
@Injectable()
export class PfTargetService {
  constructor(private readonly audit: PfAuditService) {}

  async create(tx: Db, pfAccountId: string, dto: CreatePfTargetDto) {
    const [row] = await tx
      .insert(schema.pfTarget)
      .values({
        pfAccountId,
        kind: dto.kind,
        categoryId: dto.categoryId ?? null,
        period: dto.period,
        periodStart: day(dto.periodStart),
        amount: String(dto.amount),
        currency: dto.currency ?? "BDT",
        note: dto.note ?? null,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.target_created", entity: "pf_target", entityId: row!.id, detail: { kind: dto.kind } });
    return row!;
  }

  /** Targets with a derived `current` (achieved-so-far) per the target's window. */
  async list(tx: Db, _pfAccountId: string) {
    const res = await tx.execute(sql`
      with t as (
        select *, (period_start
          + (case when period = 'year' then interval '1 year' else interval '1 month' end))::date as period_end
        from pf_target where archived_at is null
      )
      select t.id, t.kind, t.category_id as "categoryId", t.period,
             t.period_start as "periodStart", t.period_end as "periodEnd",
             t.amount, t.currency, t.note,
             case t.kind
               when 'budget_cap' then (
                 select coalesce(sum(e.amount), 0) from pf_expense e
                 where e.occurred_on >= t.period_start and e.occurred_on < t.period_end
                   and (t.category_id is null or e.category_id = t.category_id))
               when 'income_goal' then (
                 select coalesce(sum(i.amount), 0) from pf_income i
                 where i.occurred_on >= t.period_start and i.occurred_on < t.period_end
                   and (t.category_id is null or i.category_id = t.category_id))
               when 'savings_target' then (
                 select coalesce(sum(case when se.kind = 'deposit' then se.amount else -se.amount end), 0)
                 from pf_saving_event se
                 where se.occurred_on >= t.period_start and se.occurred_on < t.period_end)
               else 0
             end as "current"
      from t
      order by t.period_start desc
    `);
    return res.rows;
  }

  async archive(tx: Db, pfAccountId: string, id: string) {
    const [row] = await tx.update(schema.pfTarget).set({ archivedAt: new Date() }).where(eq(schema.pfTarget.id, id)).returning();
    if (!row) throw new NotFoundException("Target not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.target_archived", entity: "pf_target", entityId: id });
    return { ok: true };
  }
}
