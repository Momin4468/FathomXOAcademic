import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, desc, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { LineService } from "../work/line.service.js";
import type { ConvertLogDto, LogWorkDto } from "./dto.js";

const day = (s: string) => s.slice(0, 10);

/**
 * Module 22 — HRM employee work-logging (audit item 12). An employee logs work
 * with NO price visible (producer_work_log has no money column); an admin CONVERTS
 * a draft log into a priced producer work_line (via LineService) or rejects it —
 * a propose→confirm governance flow. Salary-owner attribution is already recordable
 * via the expenses form (cost_bearer='party' + bearer_party_id, 0036), which feeds
 * the owning partner's derived balance — so HRM adds only the work-logging surface.
 */
@Injectable()
export class HrmService {
  constructor(
    private readonly audit: AuditService,
    private readonly lines: LineService,
  ) {}

  /**
   * Payroll (handoff §18) — salaried staff = parties with an effective `monthly`
   * comp_rule; salary = its rate; paid-this-cycle = Σ salary expenses to them this
   * month; status is derived. Paying settles through the Cashbook (a `salary`
   * expense). Derived at read time — nothing stored. Gated hrm:approve.
   */
  async payroll(tx: Db) {
    const res = await tx.execute(sql`
      select cr.id as "compRuleId", cr.party_id as "partyId", p.display_name as name,
             cr.rate as salary,
             coalesce((select sum(e.amount) from expense e
               where e.category = 'salary' and e.payee_party_id = cr.party_id
                 and e.incurred_at >= date_trunc('month', current_date)::date), 0) as "paidThisMonth"
      from comp_rule cr
      join party p on p.id = cr.party_id
      where cr.basis = 'monthly' and (cr.effective_to is null or cr.effective_to >= current_date)
      order by p.display_name
    `);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return (res.rows as Array<{ compRuleId: string; partyId: string; name: string; salary: string; paidThisMonth: string }>).map((row) => {
      const salary = r2(Number(row.salary ?? 0));
      const paid = r2(Number(row.paidThisMonth ?? 0));
      return {
        compRuleId: row.compRuleId,
        partyId: row.partyId,
        name: row.name,
        salary,
        paidThisMonth: paid,
        outstanding: r2(Math.max(0, salary - paid)),
        status: salary > 0 && paid >= salary ? "paid" : paid > 0 ? "partial" : "due",
      };
    });
  }

  /** Log work — the employee is always the caller (never from the body); no money. */
  async logWork(tx: Db, principal: SessionPrincipal, dto: LogWorkDto) {
    if (!principal.partyId) throw new BadRequestException("Only an employee party can log work");
    const [row] = await tx
      .insert(schema.producerWorkLog)
      .values({
        orgId: principal.orgId,
        employeePartyId: principal.partyId,
        workItemId: dto.workItemId ?? null,
        title: dto.title.trim(),
        description: dto.description ?? null,
        quantity: dto.quantity != null ? String(dto.quantity) : null,
        loggedOn: day(dto.loggedOn),
        status: "draft",
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "hrm.work_logged",
      entity: "producer_work_log",
      entityId: row!.id,
      detail: { title: dto.title, workItemId: dto.workItemId ?? null },
    });
    return row!;
  }

  /** The caller's own logs (self-scoped). */
  myLogs(tx: Db, principal: SessionPrincipal) {
    if (!principal.partyId) return Promise.resolve([]);
    return tx
      .select()
      .from(schema.producerWorkLog)
      .where(eq(schema.producerWorkLog.employeePartyId, principal.partyId))
      .orderBy(desc(schema.producerWorkLog.loggedOn));
  }

  /** Admin review queue — all logs (optionally by status), with the employee name. */
  listLogs(tx: Db, status?: string) {
    const base = tx
      .select({
        id: schema.producerWorkLog.id,
        employeePartyId: schema.producerWorkLog.employeePartyId,
        employeeName: schema.party.displayName,
        workItemId: schema.producerWorkLog.workItemId,
        title: schema.producerWorkLog.title,
        description: schema.producerWorkLog.description,
        quantity: schema.producerWorkLog.quantity,
        loggedOn: schema.producerWorkLog.loggedOn,
        status: schema.producerWorkLog.status,
        convertedWorkLineId: schema.producerWorkLog.convertedWorkLineId,
      })
      .from(schema.producerWorkLog)
      .innerJoin(schema.party, eq(schema.party.id, schema.producerWorkLog.employeePartyId));
    const filtered = status ? base.where(eq(schema.producerWorkLog.status, status)) : base;
    return filtered.orderBy(desc(schema.producerWorkLog.loggedOn));
  }

  /**
   * Convert a draft log into a priced producer work_line (admin). Needs a work_item
   * (from the body or the log). The new line carries NO rate — the admin prices it
   * on the job afterward. Only a still-draft log can be converted.
   */
  async convert(tx: Db, principal: SessionPrincipal, id: string, dto: ConvertLogDto) {
    const [log] = await tx.select().from(schema.producerWorkLog).where(eq(schema.producerWorkLog.id, id));
    if (!log) throw new NotFoundException("Work log not found");
    if (log.status !== "draft") throw new BadRequestException(`Log is already ${log.status}`);
    const workItemId = dto.workItemId ?? log.workItemId;
    if (!workItemId) throw new BadRequestException("Link a job (workItemId) to convert this log");

    const line = await this.lines.addLine(tx, principal, workItemId, {
      lineKind: "part",
      writerPartyId: log.employeePartyId,
      note: `From work log: ${log.title}`,
    });
    const [row] = await tx
      .update(schema.producerWorkLog)
      .set({ status: "converted", convertedWorkLineId: line.id, workItemId })
      .where(and(eq(schema.producerWorkLog.id, id), eq(schema.producerWorkLog.status, "draft")))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "hrm.work_log_converted",
      entity: "producer_work_log",
      entityId: id,
      detail: { workItemId, workLineId: line.id },
    });
    return row!;
  }

  /** Reject a draft log (admin). */
  async reject(tx: Db, principal: SessionPrincipal, id: string) {
    const [log] = await tx.select({ status: schema.producerWorkLog.status }).from(schema.producerWorkLog).where(eq(schema.producerWorkLog.id, id));
    if (!log) throw new NotFoundException("Work log not found");
    if (log.status !== "draft") throw new BadRequestException(`Log is already ${log.status}`);
    const [row] = await tx
      .update(schema.producerWorkLog)
      .set({ status: "rejected" })
      .where(and(eq(schema.producerWorkLog.id, id), eq(schema.producerWorkLog.status, "draft")))
      .returning({ id: schema.producerWorkLog.id });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "hrm.work_log_rejected",
      entity: "producer_work_log",
      entityId: id,
      detail: null,
    });
    return { id: row!.id, status: "rejected" as const };
  }
}
