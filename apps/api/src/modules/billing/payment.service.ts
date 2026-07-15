import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { sumAmounts, type SessionPrincipal } from "@business-os/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { resolveUserNames } from "../../common/user-names.js";
import { INCOME_BRIDGE, type IncomeBridgePort } from "./income-bridge/income-bridge.port.js";
import { recomputeMoneyState, workItemForInvoiceLine } from "./money-state.js";
import type { AllocateDto, RecordPaymentDto } from "./dto.js";

@Injectable()
export class PaymentService {
  constructor(
    private readonly audit: AuditService,
    @Inject(INCOME_BRIDGE) private readonly incomeBridge: IncomeBridgePort,
  ) {}

  /** A payment is an EVENT (append-only). Allocation (the link) comes next. */
  async recordPayment(tx: Db, principal: SessionPrincipal, dto: RecordPaymentDto, opts?: { aiCaptureId?: string; importBatchId?: string }) {
    const [p] = await tx
      .insert(schema.payment)
      .values({
        orgId: principal.orgId,
        direction: dto.direction,
        counterpartyPartyId: dto.counterpartyPartyId ?? null,
        amount: String(dto.amount),
        paidAt: dto.paidAt.slice(0, 10),
        medium: dto.medium ?? null,
        originalCurrency: dto.originalCurrency ?? "BDT",
        originalAmount: dto.originalAmount != null ? String(dto.originalAmount) : null,
        fxRate: dto.fxRate != null ? String(dto.fxRate) : null,
        trxId: dto.trxId ?? null,
        note: dto.note ?? null,
        aiCaptureId: opts?.aiCaptureId ?? null,
        importBatchId: opts?.importBatchId ?? null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.payment_recorded",
      entity: "payment",
      entityId: p!.id,
      detail: { direction: dto.direction, amount: dto.amount, medium: dto.medium },
    });
    return p!;
  }

  /**
   * Validate that an allocation target is real, same-org and (for invoice lines)
   * billable — the FK alone bypasses RLS, so without this a foreign-org target
   * could be allocated to (B4). Charges are party-RLS, so we validate via the
   * charge_summary SECURITY DEFINER lookup.
   */
  private async assertTargetVisible(
    tx: Db,
    principal: SessionPrincipal,
    item: { invoiceLineId?: string; writerPartyId?: string; chargeId?: string },
  ): Promise<void> {
    if (item.invoiceLineId) {
      const res = await tx.execute(sql`
        select il.id, i.is_estimate as "isEstimate", i.status
        from invoice_line il join invoice i on i.id = il.invoice_id
        where il.id = ${item.invoiceLineId}
      `);
      const row = res.rows[0] as { isEstimate: boolean; status: string } | undefined;
      if (!row) throw new BadRequestException("Invoice line not found");
      if (row.isEstimate || row.status === "void") {
        throw new BadRequestException("Cannot allocate to an estimate or void invoice line");
      }
    } else if (item.writerPartyId) {
      const [pt] = await tx
        .select({ id: schema.party.id })
        .from(schema.party)
        .where(eq(schema.party.id, item.writerPartyId));
      if (!pt) throw new BadRequestException("Writer party not found");
    } else if (item.chargeId) {
      const res = await tx.execute(sql`select org_id as "orgId" from charge_summary(${item.chargeId})`);
      const row = res.rows[0] as { orgId: string } | undefined;
      if (!row || row.orgId !== principal.orgId) throw new BadRequestException("Charge not found");
    }
  }

  /**
   * Allocate a payment — partial within a job and/or bulk across many jobs in one
   * call. Each item targets exactly one of invoiceLine | writer | charge.
   */
  async allocate(tx: Db, principal: SessionPrincipal, paymentId: string, dto: AllocateDto) {
    // Serialize concurrent allocations on THIS payment so they can't jointly
    // exceed the cap (S1). A transaction-scoped advisory lock — released at commit,
    // and (unlike SELECT FOR UPDATE) it needs no table UPDATE privilege, so it
    // works under the append-only payment grant. The cap read-check-insert below
    // therefore runs serialized per payment.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${paymentId}))`);
    const [payment] = await tx.select().from(schema.payment).where(eq(schema.payment.id, paymentId));
    if (!payment) throw new NotFoundException("Payment not found");

    for (const item of dto.items) {
      const targets = [item.invoiceLineId, item.writerPartyId, item.chargeId].filter(Boolean);
      if (targets.length !== 1) {
        throw new BadRequestException("Each allocation targets exactly one of invoiceLine | writer | charge");
      }
      await this.assertTargetVisible(tx, principal, item);
    }

    const already = await tx
      .select({ amount: schema.paymentAllocation.amount })
      .from(schema.paymentAllocation)
      .where(eq(schema.paymentAllocation.paymentId, paymentId));
    const requested = sumAmounts(dto.items.map((i) => i.amount));
    if (
      Number(payment.amount) >= 0 &&
      sumAmounts(already.map((a) => a.amount)) + requested > Number(payment.amount) + 1e-9
    ) {
      throw new BadRequestException("Allocations exceed the payment amount");
    }

    const affectedJobs = new Set<string>();
    for (const item of dto.items) {
      const allocationId = randomUUID();
      await tx.insert(schema.paymentAllocation).values({
        id: allocationId,
        orgId: principal.orgId,
        paymentId,
        invoiceLineId: item.invoiceLineId ?? null,
        writerPartyId: item.writerPartyId ?? null,
        chargeId: item.chargeId ?? null,
        amount: String(item.amount),
      });
      // One-way income bridge (§11): a payout (direction 'out') allocated to a
      // writer pushes an income row into that person's PF plane — if they've
      // linked one. Idempotent on the allocation id; we never read PF back.
      if (payment.direction === "out" && item.writerPartyId) {
        await this.incomeBridge.pushPayout(tx, {
          partyId: item.writerPartyId,
          amount: item.amount,
          currency: "BDT",
          occurredOn: payment.paidAt,
          sourceRef: allocationId,
        });
      }
      if (item.invoiceLineId) {
        const wi = await workItemForInvoiceLine(tx, item.invoiceLineId);
        if (wi) affectedJobs.add(wi);
      }
    }
    for (const wi of affectedJobs) await recomputeMoneyState(tx, wi);

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.payment_allocated",
      entity: "payment",
      entityId: paymentId,
      detail: {
        amount: requested,
        items: dto.items.map((i) => ({
          invoiceLineId: i.invoiceLineId ?? null,
          writerPartyId: i.writerPartyId ?? null,
          chargeId: i.chargeId ?? null,
          amount: i.amount,
        })),
      },
    });
    return { ok: true, allocated: requested };
  }

  /**
   * Correction = reversing entry (append-only). Refuses to reverse a payment that
   * is itself a reversal, or one already reversed (no double/over-reversal, B2).
   */
  async reverse(tx: Db, principal: SessionPrincipal, paymentId: string, reason?: string) {
    const [orig] = await tx.select().from(schema.payment).where(eq(schema.payment.id, paymentId));
    if (!orig) throw new NotFoundException("Payment not found");
    if (orig.reversesPaymentId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx
      .select({ id: schema.payment.id })
      .from(schema.payment)
      .where(eq(schema.payment.reversesPaymentId, paymentId));
    if (existing) throw new BadRequestException("Payment already reversed");

    const [rev] = await tx
      .insert(schema.payment)
      .values({
        orgId: principal.orgId,
        direction: orig.direction,
        counterpartyPartyId: orig.counterpartyPartyId,
        amount: String(-Number(orig.amount)),
        paidAt: orig.paidAt,
        medium: orig.medium,
        originalCurrency: orig.originalCurrency,
        originalAmount: orig.originalAmount != null ? String(-Number(orig.originalAmount)) : null,
        fxRate: orig.fxRate,
        note: `Reversal of ${paymentId}${reason ? `: ${reason}` : ""}`,
        reversesPaymentId: paymentId,
        createdBy: principal.userId,
      })
      .returning();

    const allocs = await tx
      .select()
      .from(schema.paymentAllocation)
      .where(eq(schema.paymentAllocation.paymentId, paymentId));
    const affectedJobs = new Set<string>();
    for (const a of allocs) {
      const revAllocId = randomUUID();
      await tx.insert(schema.paymentAllocation).values({
        id: revAllocId,
        orgId: principal.orgId,
        paymentId: rev!.id,
        invoiceLineId: a.invoiceLineId,
        writerPartyId: a.writerPartyId,
        chargeId: a.chargeId,
        amount: String(-Number(a.amount)),
      });
      // Mirror the income push as a NEGATIVE row so the PF plane nets to zero when
      // a payout is reversed (its own source_ref → append-only, idempotent).
      if (orig.direction === "out" && a.writerPartyId) {
        await this.incomeBridge.pushPayout(tx, {
          partyId: a.writerPartyId,
          amount: -Number(a.amount),
          currency: "BDT",
          occurredOn: orig.paidAt,
          sourceRef: revAllocId,
        });
      }
      if (a.invoiceLineId) {
        const wi = await workItemForInvoiceLine(tx, a.invoiceLineId);
        if (wi) affectedJobs.add(wi);
      }
    }
    for (const wi of affectedJobs) await recomputeMoneyState(tx, wi);

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.payment_reversed",
      entity: "payment",
      entityId: rev!.id,
      detail: { reverses: paymentId, reason: reason ?? null },
    });
    return rev!;
  }

  async attachProof(tx: Db, principal: SessionPrincipal, paymentId: string, fileObjectId: string, side: string) {
    // Confirm the payment is visible/same-org before attaching evidence (S2).
    const [pmt] = await tx
      .select({ id: schema.payment.id })
      .from(schema.payment)
      .where(eq(schema.payment.id, paymentId));
    if (!pmt) throw new NotFoundException("Payment not found");
    await tx.insert(schema.paymentProof).values({
      orgId: principal.orgId,
      paymentId,
      fileObjectId,
      side,
      attachedBy: principal.userId,
    });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.proof_attached",
      entity: "payment",
      entityId: paymentId,
      detail: { fileObjectId, side },
    });
    return { ok: true };
  }

  async list(tx: Db, filters: { counterpartyPartyId?: string }) {
    if (filters.counterpartyPartyId) {
      return tx
        .select()
        .from(schema.payment)
        .where(eq(schema.payment.counterpartyPartyId, filters.counterpartyPartyId))
        .orderBy(schema.payment.paidAt);
    }
    return tx.select().from(schema.payment).orderBy(schema.payment.paidAt);
  }

  /**
   * The unified Cashbook (handoff §7): ONE ledger of every taka in and out —
   * client payments + writer/vendor payouts (payment rows) and expenses / salaries
   * / subscriptions (expense rows), unified as in/out lines by category. A
   * PRESENTATION union over the existing append-only tables — the money model is
   * untouched (payments/expenses stay their own append-only ledgers). Runs under
   * the caller's RLS (org-scoped); gated billing:view. KPIs: total in / out / net.
   */
  async cashbook(tx: Db) {
    const res = await tx.execute(sql`
      select k.* from (
        select 'payment' as kind, p.id, p.paid_at as date, p.direction,
               case when p.direction = 'in' then 'Client payment' else 'Writer/vendor payout' end as category,
               cp.display_name as counterparty, p.medium, p.trx_id as "trxId",
               p.amount, p.note, (p.reverses_payment_id is not null) as reversal
        from payment p left join party cp on cp.id = p.counterparty_party_id
        union all
        select 'expense' as kind, e.id, e.incurred_at as date, 'out' as direction,
               initcap(e.category) as category, pp.display_name as counterparty, null as medium, null as "trxId",
               e.amount, e.note, false as reversal
        from expense e left join party pp on pp.id = e.payee_party_id
      ) k order by k.date desc, k.kind
      limit 500
    `);
    const rows = res.rows as Array<{ direction: string; amount: string }>;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let totalIn = 0;
    let totalOut = 0;
    for (const r of rows) {
      const a = Number(r.amount);
      if (r.direction === "in") totalIn += a;
      else totalOut += a;
    }
    return { rows: res.rows, totalIn: r2(totalIn), totalOut: r2(totalOut), net: r2(totalIn - totalOut) };
  }

  /** A single payment + its allocations + proofs (the detail view; same shape as
   *  the list row for the payment itself). RLS scopes to the caller's org. */
  async getById(tx: Db, id: string) {
    const [payment] = await tx.select().from(schema.payment).where(eq(schema.payment.id, id));
    if (!payment) throw new NotFoundException("Payment not found");
    const allocations = await tx
      .select()
      .from(schema.paymentAllocation)
      .where(eq(schema.paymentAllocation.paymentId, id));
    const proofs = await tx
      .select()
      .from(schema.paymentProof)
      .where(eq(schema.paymentProof.paymentId, id));
    // R5 audit trail — resolve the creator's name (org-scoped).
    const names = await resolveUserNames(tx, payment.orgId, [payment.createdBy]);
    const createdByName = payment.createdBy ? names.get(payment.createdBy) ?? null : null;
    return { payment: { ...payment, createdByName }, allocations, proofs };
  }
}
