import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { computeLineAmount, lineBalance, round2, type SessionPrincipal } from "@business-os/shared";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { recomputeMoneyState } from "./money-state.js";

@Injectable()
export class InvoiceService {
  constructor(private readonly audit: AuditService) {}

  /** Find (or open) a client's live, non-estimate invoice — the auto-group target. */
  async ensureOpenInvoice(tx: Db, principal: SessionPrincipal, clientPartyId: string): Promise<string> {
    const [existing] = await tx
      .select({ id: schema.invoice.id })
      .from(schema.invoice)
      .where(
        and(
          eq(schema.invoice.clientPartyId, clientPartyId),
          eq(schema.invoice.status, "open"),
          eq(schema.invoice.isEstimate, false),
        ),
      )
      .limit(1);
    if (existing) return existing.id;
    const [created] = await tx
      .insert(schema.invoice)
      .values({ orgId: principal.orgId, clientPartyId, createdBy: principal.userId })
      .returning({ id: schema.invoice.id });
    return created!.id;
  }

  async createInvoice(tx: Db, principal: SessionPrincipal, clientPartyId: string, isEstimate = false) {
    const [inv] = await tx
      .insert(schema.invoice)
      .values({ orgId: principal.orgId, clientPartyId, isEstimate, createdBy: principal.userId })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.invoice_created",
      entity: "invoice",
      entityId: inv!.id,
      detail: { clientPartyId, isEstimate },
    });
    return inv!;
  }

  private async addLine(tx: Db, principal: SessionPrincipal, invoiceId: string, workLineId: string) {
    const [wl] = await tx.select().from(schema.workLine).where(eq(schema.workLine.id, workLineId));
    if (!wl) throw new NotFoundException("Work line not found");
    if (!wl.consumerPartyId) throw new BadRequestException("Only consumer (client) lines are billable");
    // Prevent double-billing: an active (non-void) invoice line for this work line.
    const dup = await tx.execute(sql`
      select 1 from invoice_line il join invoice i on i.id = il.invoice_id
      where il.work_line_id = ${workLineId} and i.status <> 'void' limit 1
    `);
    if (dup.rows.length) throw new BadRequestException("Work line is already on an invoice");

    const amount = computeLineAmount({
      rate: wl.clientRate,
      count: wl.wordCount ?? wl.unitCount ?? 1,
      fixedAmount: wl.fixedAmount,
    });
    const [line] = await tx
      .insert(schema.invoiceLine)
      .values({ orgId: principal.orgId, invoiceId, workLineId, amount: String(amount) })
      .returning();
    await recomputeMoneyState(tx, wl.workItemId);
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.line_attached",
      entity: "invoice_line",
      entityId: line!.id,
      detail: { invoiceId, workLineId, amount },
    });
    return line!;
  }

  /** Auto-attach a billable consumer line to the client's open invoice. */
  async attachLine(tx: Db, principal: SessionPrincipal, workLineId: string) {
    const [wl] = await tx
      .select({ consumerPartyId: schema.workLine.consumerPartyId })
      .from(schema.workLine)
      .where(eq(schema.workLine.id, workLineId));
    if (!wl?.consumerPartyId) throw new BadRequestException("Only consumer (client) lines are billable");
    const invoiceId = await this.ensureOpenInvoice(tx, principal, wl.consumerPartyId);
    return this.addLine(tx, principal, invoiceId, workLineId);
  }

  /** Add a line to a SPECIFIC invoice (e.g. an estimate). */
  addLineToInvoice(tx: Db, principal: SessionPrincipal, invoiceId: string, workLineId: string) {
    return this.addLine(tx, principal, invoiceId, workLineId);
  }

  /** Move a line between invoices of the SAME client (live grouping). */
  async moveLine(tx: Db, principal: SessionPrincipal, invoiceLineId: string, targetInvoiceId: string) {
    const [line] = await tx.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.id, invoiceLineId));
    if (!line) throw new NotFoundException("Invoice line not found");
    const [src] = await tx.select().from(schema.invoice).where(eq(schema.invoice.id, line.invoiceId));
    const [tgt] = await tx.select().from(schema.invoice).where(eq(schema.invoice.id, targetInvoiceId));
    if (!tgt) throw new NotFoundException("Target invoice not found");
    if (src!.clientPartyId !== tgt.clientPartyId) {
      throw new BadRequestException("Cannot move a line to another client's invoice");
    }
    await tx
      .update(schema.invoiceLine)
      .set({ invoiceId: targetInvoiceId })
      .where(eq(schema.invoiceLine.id, invoiceLineId));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.line_moved",
      entity: "invoice_line",
      entityId: invoiceLineId,
      detail: { from: line.invoiceId, to: targetInvoiceId },
    });
    return { ok: true };
  }

  /**
   * Estimate → final: create a final invoice that supersedes the estimate, copy
   * its lines, and void the estimate (retained in history, never deleted).
   */
  async supersedeWithFinal(tx: Db, principal: SessionPrincipal, estimateId: string) {
    const [estimate] = await tx.select().from(schema.invoice).where(eq(schema.invoice.id, estimateId));
    if (!estimate) throw new NotFoundException("Estimate not found");
    if (!estimate.isEstimate) throw new BadRequestException("Invoice is not an estimate");
    if (estimate.status === "void") throw new BadRequestException("Estimate already superseded/void");

    const [final] = await tx
      .insert(schema.invoice)
      .values({
        orgId: principal.orgId,
        clientPartyId: estimate.clientPartyId,
        isEstimate: false,
        supersedesInvoiceId: estimateId,
        createdBy: principal.userId,
      })
      .returning();

    const lines = await tx
      .select()
      .from(schema.invoiceLine)
      .where(eq(schema.invoiceLine.invoiceId, estimateId));
    const affected = new Set<string>();
    for (const l of lines) {
      await tx.insert(schema.invoiceLine).values({
        orgId: principal.orgId,
        invoiceId: final!.id,
        workLineId: l.workLineId,
        amount: l.amount,
        note: l.note,
      });
      const wi = await workItemFor(tx, l.workLineId);
      if (wi) affected.add(wi);
    }
    await tx.update(schema.invoice).set({ status: "void" }).where(eq(schema.invoice.id, estimateId));
    for (const wi of affected) await recomputeMoneyState(tx, wi);

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.estimate_superseded",
      entity: "invoice",
      entityId: final!.id,
      detail: { estimateId, finalId: final!.id, lines: lines.length },
    });
    return final!;
  }

  /** Invoice with per-line DERIVED paid/due (client per-job tracking) + a
   *  DERIVED `previousDue` = the client's outstanding across all PRIOR real
   *  (non-estimate, non-void, non-paid) invoices — the brought-forward opening
   *  balance a repeat client carries. Never stored; summed at read time from the
   *  same allocation truth (a stored opening balance would duplicate + drift). */
  async getInvoice(tx: Db, id: string) {
    const [inv] = await tx.select().from(schema.invoice).where(eq(schema.invoice.id, id));
    if (!inv) throw new NotFoundException("Invoice not found");
    const lines = await tx.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, id));
    const withBalances = [];
    for (const l of lines) {
      const allocs = await tx
        .select({ amount: schema.paymentAllocation.amount })
        .from(schema.paymentAllocation)
        .where(eq(schema.paymentAllocation.invoiceLineId, l.id));
      withBalances.push({ ...l, ...lineBalance(l.amount, allocs.map((a) => a.amount)) });
    }
    const prev = await tx.execute(sql`
      select coalesce(sum(il.amount - coalesce(pa.paid, 0)), 0) as prev_due
      from invoice i
      join invoice_line il on il.invoice_id = i.id
      left join lateral (
        select sum(amount) as paid from payment_allocation where invoice_line_id = il.id
      ) pa on true
      where i.client_party_id = ${inv.clientPartyId}
        and i.id <> ${id}
        and i.created_at < ${inv.createdAt}
        and i.is_estimate = false
        and i.status not in ('void', 'paid')
    `);
    const previousDue = round2(Number((prev.rows[0] as { prev_due: string }).prev_due));
    return { invoice: inv, lines: withBalances, previousDue };
  }

  async list(tx: Db, filters: { clientPartyId?: string; status?: string }) {
    const conds = [];
    if (filters.clientPartyId) conds.push(eq(schema.invoice.clientPartyId, filters.clientPartyId));
    if (filters.status) conds.push(eq(schema.invoice.status, filters.status));
    return tx
      .select()
      .from(schema.invoice)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(schema.invoice.createdAt);
  }
}

async function workItemFor(tx: Db, workLineId: string): Promise<string | null> {
  const [wl] = await tx
    .select({ workItemId: schema.workLine.workItemId })
    .from(schema.workLine)
    .where(eq(schema.workLine.id, workLineId));
  return wl?.workItemId ?? null;
}
