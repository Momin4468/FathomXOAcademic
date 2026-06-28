import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { eq } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";
import type { CreatePfLoanDto, CreatePfLoanEventDto } from "./pf-loan.dto.js";

const day = (s: string) => s.slice(0, 10);

/**
 * Loans given/taken (§11). The OUTSTANDING balance is DERIVED at read, never
 * stored (CLAUDE.md §3.3): principal + Σ(disbursement) − Σ(repayment) +
 * Σ(adjustment). Events are append-only; a reversal is a same-kind negated mirror
 * so the sums net naturally.
 */
@Injectable()
export class PfLoanService {
  constructor(private readonly audit: PfAuditService) {}

  async create(tx: Db, pfAccountId: string, dto: CreatePfLoanDto) {
    const [row] = await tx
      .insert(schema.pfLoan)
      .values({
        pfAccountId,
        direction: dto.direction,
        counterpartyName: dto.counterpartyName.trim(),
        principal: String(dto.principal),
        currency: dto.currency ?? "BDT",
        startedOn: day(dto.startedOn),
        dueOn: dto.dueOn ? day(dto.dueOn) : null,
        note: dto.note ?? null,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.loan_created", entity: "pf_loan", entityId: row!.id, detail: { direction: dto.direction, principal: dto.principal } });
    return row!;
  }

  /** List loans with derived outstanding + events. */
  async list(tx: Db, _pfAccountId: string) {
    const res = await tx.execute(sql`
      select l.id, l.direction, l.counterparty_name as "counterpartyName",
             l.principal, l.currency, l.started_on as "startedOn", l.due_on as "dueOn",
             l.note, l.archived_at as "archivedAt",
             (l.principal
               + coalesce(sum(e.amount) filter (where e.kind = 'disbursement'), 0)
               - coalesce(sum(e.amount) filter (where e.kind = 'repayment'), 0)
               + coalesce(sum(e.amount) filter (where e.kind = 'adjustment'), 0)
             ) as "outstanding"
      from pf_loan l
      left join pf_loan_event e on e.loan_id = l.id
      where l.archived_at is null
      group by l.id
      order by l.started_on desc
    `);
    return res.rows;
  }

  async events(tx: Db, loanId: string) {
    return tx.select().from(schema.pfLoanEvent).where(eq(schema.pfLoanEvent.loanId, loanId)).orderBy(schema.pfLoanEvent.occurredOn);
  }

  async addEvent(tx: Db, pfAccountId: string, loanId: string, dto: CreatePfLoanEventDto) {
    const [loan] = await tx.select({ id: schema.pfLoan.id }).from(schema.pfLoan).where(eq(schema.pfLoan.id, loanId));
    if (!loan) throw new NotFoundException("Loan not found");
    const [row] = await tx
      .insert(schema.pfLoanEvent)
      .values({ pfAccountId, loanId, kind: dto.kind, amount: String(dto.amount), occurredOn: day(dto.occurredOn), note: dto.note ?? null })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.loan_event_added", entity: "pf_loan_event", entityId: row!.id, detail: { loanId, kind: dto.kind, amount: dto.amount } });
    return row!;
  }

  /** Reverse a loan event (append-only: same kind, negated amount). */
  async reverseEvent(tx: Db, pfAccountId: string, eventId: string) {
    const [orig] = await tx.select().from(schema.pfLoanEvent).where(eq(schema.pfLoanEvent.id, eventId));
    if (!orig) throw new NotFoundException("Loan event not found");
    if (orig.reversesId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx.select({ id: schema.pfLoanEvent.id }).from(schema.pfLoanEvent).where(eq(schema.pfLoanEvent.reversesId, eventId));
    if (existing) throw new BadRequestException("Already reversed");
    const [row] = await tx
      .insert(schema.pfLoanEvent)
      .values({ pfAccountId, loanId: orig.loanId, kind: orig.kind, amount: String(-Number(orig.amount)), occurredOn: orig.occurredOn, note: `Reversal of ${eventId}`, reversesId: eventId })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.loan_event_reversed", entity: "pf_loan_event", entityId: row!.id, detail: { reverses: eventId } });
    return row!;
  }

  async archive(tx: Db, pfAccountId: string, id: string) {
    const [row] = await tx.update(schema.pfLoan).set({ archivedAt: new Date() }).where(eq(schema.pfLoan.id, id)).returning();
    if (!row) throw new NotFoundException("Loan not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.loan_archived", entity: "pf_loan", entityId: id });
    return { ok: true };
  }
}
