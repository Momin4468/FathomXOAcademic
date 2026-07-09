import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { round2 } from "@business-os/shared";
import { eq } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";
import type { CreatePfInvestmentDto, CreatePfInvestmentEventDto } from "./pf-investment.dto.js";

const day = (s: string) => s.slice(0, 10);

/**
 * Investment holdings (§11, 0047). Mirrors the savings pattern: a header with an
 * immutable PRINCIPAL (cost basis) + an append-only value log. Current value & P/L
 * are DERIVED at read, never stored:
 *   costBasis    = principal + Σ(contribution) − Σ(withdrawal)   [sum-based, like savings]
 *   currentValue = latest non-reversed `valuation` mark + net contributions/
 *                  withdrawals recorded AFTER that mark's date; else costBasis
 *   unrealizedPl = currentValue − costBasis
 * The one deviation from savings: a `valuation` is an ABSOLUTE mark (latest wins),
 * because an investment's worth floats independently of your contributions. But a
 * mark is only "as of its date": cash added/removed AFTER it adjusts current value
 * 1:1 (money added is worth its face until you re-mark), so a contribution never
 * shows as a phantom P/L swing — P/L moves only on a valuation. (See DECISIONS
 * 2026-07-10.) A reversal is the same negated-mirror as everywhere else — for
 * contribution/withdrawal it nets in the sums; for a valuation the negated row
 * (and the reversed original) drop out of the "latest non-reversed" pick.
 */
@Injectable()
export class PfInvestmentService {
  constructor(private readonly audit: PfAuditService) {}

  async create(tx: Db, pfAccountId: string, dto: CreatePfInvestmentDto) {
    const [row] = await tx
      .insert(schema.pfInvestment)
      .values({
        pfAccountId,
        categoryId: dto.categoryId ?? null,
        name: dto.name.trim(),
        principal: String(dto.principal),
        currency: dto.currency ?? "BDT",
        startedOn: day(dto.startedOn),
        note: dto.note ?? null,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.investment_created", entity: "pf_investment", entityId: row!.id });
    return row!;
  }

  async list(tx: Db, _pfAccountId: string) {
    const res = await tx.execute(sql`
      select i.id, i.category_id as "categoryId", i.name, i.currency, i.principal,
             i.started_on as "startedOn", i.note, i.archived_at as "archivedAt",
             (i.principal
               + coalesce(sum(e.amount) filter (where e.kind = 'contribution'), 0)
               - coalesce(sum(e.amount) filter (where e.kind = 'withdrawal'), 0)) as "costBasis",
             lv.amount as "latestValuation",
             post.flow as "postValFlow"
      from pf_investment i
      left join pf_investment_event e on e.investment_id = i.id
      left join lateral (
        select v.amount, v.occurred_on as vo from pf_investment_event v
        where v.investment_id = i.id and v.kind = 'valuation' and v.reverses_id is null
          and not exists (select 1 from pf_investment_event r where r.reverses_id = v.id)
        order by v.occurred_on desc, v.created_at desc
        limit 1
      ) lv on true
      left join lateral (
        -- net contributions/withdrawals recorded AFTER the latest mark's date
        -- (reversal mirrors net themselves out); adjusts current value 1:1.
        select coalesce(sum(case when e2.kind = 'contribution' then e2.amount when e2.kind = 'withdrawal' then -e2.amount else 0 end), 0) as flow
        from pf_investment_event e2
        where e2.investment_id = i.id and lv.amount is not null and e2.occurred_on > lv.vo
      ) post on true
      where i.archived_at is null
      group by i.id, lv.amount, post.flow
      order by i.created_at desc
    `);
    return (res.rows as Array<Record<string, unknown>>).map((r) => {
      const costBasis = round2(Number(r.costBasis));
      const currentValue = r.latestValuation != null
        ? round2(Number(r.latestValuation) + Number(r.postValFlow ?? 0))
        : costBasis;
      return {
        id: r.id as string,
        categoryId: r.categoryId as string | null,
        name: r.name as string,
        currency: r.currency as string,
        principal: r.principal as string,
        startedOn: r.startedOn as string,
        note: r.note as string | null,
        archivedAt: r.archivedAt as string | null,
        costBasis,
        currentValue,
        unrealizedPl: round2(currentValue - costBasis),
      };
    });
  }

  async events(tx: Db, investmentId: string) {
    return tx
      .select()
      .from(schema.pfInvestmentEvent)
      .where(eq(schema.pfInvestmentEvent.investmentId, investmentId))
      .orderBy(schema.pfInvestmentEvent.occurredOn);
  }

  async addEvent(tx: Db, pfAccountId: string, investmentId: string, dto: CreatePfInvestmentEventDto) {
    const [inv] = await tx.select({ id: schema.pfInvestment.id }).from(schema.pfInvestment).where(eq(schema.pfInvestment.id, investmentId));
    if (!inv) throw new NotFoundException("Investment not found");
    const [row] = await tx
      .insert(schema.pfInvestmentEvent)
      .values({ pfAccountId, investmentId, kind: dto.kind, amount: String(dto.amount), occurredOn: day(dto.occurredOn), note: dto.note ?? null })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.investment_event_added", entity: "pf_investment_event", entityId: row!.id, detail: { investmentId, kind: dto.kind, amount: dto.amount } });
    return row!;
  }

  async reverseEvent(tx: Db, pfAccountId: string, eventId: string) {
    const [orig] = await tx.select().from(schema.pfInvestmentEvent).where(eq(schema.pfInvestmentEvent.id, eventId));
    if (!orig) throw new NotFoundException("Investment event not found");
    if (orig.reversesId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx.select({ id: schema.pfInvestmentEvent.id }).from(schema.pfInvestmentEvent).where(eq(schema.pfInvestmentEvent.reversesId, eventId));
    if (existing) throw new BadRequestException("Already reversed");
    const [row] = await tx
      .insert(schema.pfInvestmentEvent)
      .values({ pfAccountId, investmentId: orig.investmentId, kind: orig.kind, amount: String(-Number(orig.amount)), occurredOn: orig.occurredOn, note: `Reversal of ${eventId}`, reversesId: eventId })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.investment_event_reversed", entity: "pf_investment_event", entityId: row!.id, detail: { reverses: eventId } });
    return row!;
  }

  async archive(tx: Db, pfAccountId: string, id: string) {
    const [row] = await tx.update(schema.pfInvestment).set({ archivedAt: new Date() }).where(eq(schema.pfInvestment.id, id)).returning();
    if (!row) throw new NotFoundException("Investment not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.investment_archived", entity: "pf_investment", entityId: id });
    return { ok: true };
  }
}
