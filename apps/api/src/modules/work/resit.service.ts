import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { deriveJobPnl, type JobPnl, type SessionPrincipal } from "@business-os/shared";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { ChargeService } from "../billing/charge.service.js";
import { recomputeMoneyState } from "../billing/money-state.js";
import type { ResitDto } from "./dto.js";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Resit-band leg seqs (a side-band outside the 1..n chain). */
const SEQ_REVERSE_WRITER = 80;
const SEQ_REVERSE_CLIENT = 81;
const SEQ_RESIT_WRITER = 82;

/**
 * Resit / fail handling (DESIGN_SPEC §3, §6, §8). A failed job is redone ON THE
 * SAME work_item: a controlled reopen (work-state redo), the resit (second)
 * writer as an extra line + leg, the original writer's pay reduced via a
 * reversing leg AND/OR an `adjustment` clawback charge (auto by paid-status,
 * disjoint so the same money is never both reversed and charged), and the client
 * optionally re-billed to 0. The loss is DERIVED (job_pnl: legs + clawback +
 * rework), never stored. Append-only throughout; one transaction.
 */
@Injectable()
export class ResitService {
  constructor(
    private readonly audit: AuditService,
    private readonly charges: ChargeService,
  ) {}

  /** The truthful job P&L (derived). reworkCost is added from the outcome in TS. */
  async jobPnl(tx: Db, workItemId: string, reworkCost: number): Promise<JobPnl> {
    const r = await tx.execute(
      sql`select revenue, writer_cost as "writerCost", clawback from job_pnl(${workItemId})`,
    );
    const row = (r.rows[0] ?? {}) as { revenue?: string; writerCost?: string; clawback?: string };
    return deriveJobPnl({
      revenue: Number(row.revenue ?? 0),
      writerCost: Number(row.writerCost ?? 0),
      clawback: Number(row.clawback ?? 0),
      reworkCost: Number(reworkCost ?? 0),
    });
  }

  async resit(tx: Db, principal: SessionPrincipal, workItemId: string, dto: ResitDto) {
    const [item] = await tx
      .select({ id: schema.workItem.id, workState: schema.workItem.workState })
      .from(schema.workItem)
      .where(eq(schema.workItem.id, workItemId));
    if (!item) throw new NotFoundException("Work item not found");

    // Governance: a resit answers a RECORDED fail.
    const [outcome] = await tx
      .select()
      .from(schema.workOutcome)
      .where(eq(schema.workOutcome.workItemId, workItemId));
    if (!outcome || !outcome.failed) {
      throw new BadRequestException("Record a failed outcome on this job before a resit");
    }

    // ── work-state redo: a narrow, audited reopen (delivered/confirmed → pending) ──
    let reopened = false;
    if (dto.reopen !== false && (item.workState === "delivered" || item.workState === "confirmed")) {
      await tx
        .update(schema.workItem)
        .set({ workState: "pending", updatedBy: principal.userId, updatedAt: new Date() })
        .where(eq(schema.workItem.id, workItemId));
      reopened = true;
    }

    // ── original-writer reduction: auto-split reversing leg vs clawback charge ──
    const legInserts: Array<{ seq: number; from: string | null; to: string | null; amount: number; note: string }> = [];
    let reverseAmt = 0;
    let chargeAmt = 0;
    const R = round2(Number(dto.originalWriterReduction || 0));
    if (R > 0) {
      // L1: a reduction can't exceed the original writer's earning ON THIS JOB.
      const je = await tx.execute(
        sql`select party_job_earnings(${dto.originalWriterPartyId}, ${workItemId}) as v`,
      );
      const jobEarning = Number((je.rows[0] as { v: string }).v);
      if (R > jobEarning + 0.005) {
        throw new BadRequestException(
          `Reduction ${R} exceeds the original writer's earning on this job (${round2(jobEarning)})`,
        );
      }
      // Auto-split by paid-status: reverse what's still owed, claw back the rest.
      const o = await tx.execute(
        sql`select party_earnings_outstanding(${dto.originalWriterPartyId}) as v`,
      );
      const outstanding = Number((o.rows[0] as { v: string }).v);
      reverseAmt = round2(Math.max(0, Math.min(R, Math.max(0, outstanding))));
      chargeAmt = round2(R - reverseAmt);
      if (reverseAmt > 0) {
        // The from-party is only needed for the reversing-leg portion.
        if (!dto.originalWriterFromPartyId) {
          throw new BadRequestException(
            "originalWriterFromPartyId is required to post the reversing leg",
          );
        }
        legInserts.push({
          seq: SEQ_REVERSE_WRITER,
          from: dto.originalWriterFromPartyId,
          to: dto.originalWriterPartyId,
          amount: -reverseAmt, // negative = reverses part of their earning
          note: "resit: original writer reduction (reversing leg)",
        });
      }
      if (chargeAmt > 0) {
        // Already-paid portion → an explicit recoverable debt (clawback).
        await this.charges.createCharge(tx, principal, {
          partyId: dto.originalWriterPartyId,
          workItemId,
          category: "adjustment" as const,
          amount: chargeAmt,
          reason: "resit clawback (original writer)",
        });
      }
    }

    // ── resit (second) writer: an extra producer line + a positive leg ──
    if (dto.resitWriter) {
      const w = dto.resitWriter;
      if (w.fromPartyId === w.partyId) {
        throw new BadRequestException("Resit writer leg: from and to must differ");
      }
      await tx.insert(schema.workLine).values({
        orgId: principal.orgId,
        workItemId,
        lineKind: w.lineKind ?? "extra",
        writerPartyId: w.partyId,
        wordCount: w.wordCount ?? null,
        note: w.note ?? "resit: second writer",
      });
      legInserts.push({
        seq: SEQ_RESIT_WRITER,
        from: w.fromPartyId,
        to: w.partyId,
        amount: round2(w.amount),
        note: "resit: second writer",
      });
    }

    // ── client side: re-bill the whole job to 0 (escalation) ──
    if (dto.zeroClientBilling) {
      if (!dto.clientReversal) {
        throw new BadRequestException("clientReversal is required to zero client billing");
      }
      const c = dto.clientReversal;
      if (c.fromPartyId === c.toPartyId) {
        throw new BadRequestException("Client reversal leg: from and to must differ");
      }
      // Guard (M3): if the client already PAID, zeroing billing needs a reversing
      // payment, not a silent void — block it so a real payment isn't stranded.
      const alloc = await tx.execute(sql`
        select coalesce(sum(pa.amount), 0) as v from payment_allocation pa
        where pa.org_id = ${principal.orgId} and pa.invoice_line_id in (
          select il.id from invoice_line il
          join work_line wl on wl.id = il.work_line_id
          where wl.work_item_id = ${workItemId}
        )
      `);
      if (Number((alloc.rows[0] as { v: string }).v) > 0) {
        throw new BadRequestException(
          "Client has payments allocated on this job — reverse the payment before zeroing billing",
        );
      }
      legInserts.push({
        seq: SEQ_REVERSE_CLIENT,
        from: c.fromPartyId,
        to: c.toPartyId,
        amount: -round2(c.amount), // negative = reverses the client revenue → 0
        note: "resit: client re-bill to 0",
      });
      // Void the job's invoices, then recompute money-state (→ unbilled).
      // (invoice has no updated_at column — status only, like invoice.service supersede.)
      await tx.execute(sql`
        update invoice set status = 'void'
        where org_id = ${principal.orgId} and status <> 'void'
          and id in (
            select distinct il.invoice_id from invoice_line il
            join work_line wl on wl.id = il.work_line_id
            where wl.work_item_id = ${workItemId}
          )
      `);
      await recomputeMoneyState(tx, workItemId);
    }

    // ── append the legs (append-only; client-side id, no RETURNING) ──
    for (const l of legInserts) {
      await tx.insert(schema.leg).values({
        id: randomUUID(),
        orgId: principal.orgId,
        workItemId,
        seq: l.seq,
        fromPartyId: l.from,
        toPartyId: l.to,
        amount: String(l.amount),
        note: l.note,
        createdBy: principal.userId,
      });
    }

    // ── stamp the outcome (resit performed; rework cost if given) ──
    const reworkCost = dto.reworkCost != null ? round2(dto.reworkCost) : Number(outcome.reworkCost ?? 0);
    await tx
      .update(schema.workOutcome)
      .set({
        resit: true,
        reworkCost: dto.reworkCost != null ? String(round2(dto.reworkCost)) : outcome.reworkCost,
        updatedBy: principal.userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.workOutcome.id, outcome.id));

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.resit",
      entity: "work_item",
      entityId: workItemId,
      detail: {
        reopened,
        originalWriterPartyId: dto.originalWriterPartyId,
        reduction: R,
        reverseAmt,
        chargeAmt,
        resitWriter: dto.resitWriter ? { partyId: dto.resitWriter.partyId, amount: round2(dto.resitWriter.amount) } : null,
        zeroClientBilling: !!dto.zeroClientBilling,
        reworkCost,
      },
    });

    const pnl = await this.jobPnl(tx, workItemId, reworkCost);
    return { ok: true, reopened, reverseAmt, chargeAmt, pnl };
  }
}
