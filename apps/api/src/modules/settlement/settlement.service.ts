import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import {
  deriveSettlement,
  resolveDealTerm,
  round2,
  type DealTermLike,
  type SessionPrincipal,
  type SettlementPoolRow,
  type SettlementTransferRow,
} from "@business-os/shared";
import { and, eq, inArray, or } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { ApplyChargeDto, RecordTransferDto } from "./dto.js";

/**
 * Settlement layer (DESIGN_SPEC §4.4, §3): the SHARED Emon↔Momin picture —
 * split/commission profit derived from legs, dated transfers, netting to
 * who-owes-whom — WITHOUT exposing either partner's private legs/margins. The
 * shared pool comes from the settlement_legs() SECURITY DEFINER function (which
 * returns only the downstream-node margin, never the upstream's private client
 * leg, and only to the two partners). All math is the pure deriveSettlement.
 */
@Injectable()
export class SettlementService {
  constructor(private readonly audit: AuditService) {}

  /** Shared settlement summary for the partner pair (no raw legs ever returned). */
  async summary(tx: Db, partnerA: string, partnerB: string) {
    // Shared pool rows (definer is caller-guarded to the two partners → a
    // non-partner gets zero rows, hence an empty/zeroed summary).
    const poolRes = await tx.execute(sql`
      select work_item_id as "workItemId", job_date as "jobDate",
             upstream_party as "upstreamParty", downstream_party as "downstreamParty", pool
      from settlement_legs(${partnerA}, ${partnerB})
    `);
    const poolRows = poolRes.rows as unknown as SettlementPoolRow[];

    // Settlement terms on either direction of the pair (tenant-readable).
    const dealTerms = (await tx
      .select()
      .from(schema.dealTerm)
      .where(
        and(
          inArray(schema.dealTerm.termType, ["split_pct", "commission_pct"]),
          or(
            and(eq(schema.dealTerm.fromPartyId, partnerA), eq(schema.dealTerm.toPartyId, partnerB)),
            and(eq(schema.dealTerm.fromPartyId, partnerB), eq(schema.dealTerm.toPartyId, partnerA)),
          ),
        ),
      )) as unknown as DealTermLike[];

    // Dated transfers between the pair (RLS-scoped: caller must be a partner).
    const transferRows = await tx
      .select({
        fromPartyId: schema.settlementTransfer.fromPartyId,
        toPartyId: schema.settlementTransfer.toPartyId,
        amount: schema.settlementTransfer.amount,
      })
      .from(schema.settlementTransfer)
      .where(
        or(
          and(eq(schema.settlementTransfer.fromPartyId, partnerA), eq(schema.settlementTransfer.toPartyId, partnerB)),
          and(eq(schema.settlementTransfer.fromPartyId, partnerB), eq(schema.settlementTransfer.toPartyId, partnerA)),
        ),
      );

    const result = deriveSettlement(
      poolRows,
      dealTerms,
      transferRows as SettlementTransferRow[],
      { partyA: partnerA, partyB: partnerB },
    );
    return { partnerA, partnerB, ...result };
  }

  async recordTransfer(tx: Db, principal: SessionPrincipal, dto: RecordTransferDto, opts?: { importBatchId?: string }) {
    if (dto.fromPartyId === dto.toPartyId) {
      throw new BadRequestException("from and to must differ");
    }
    const [row] = await tx
      .insert(schema.settlementTransfer)
      .values({
        orgId: principal.orgId,
        fromPartyId: dto.fromPartyId,
        toPartyId: dto.toPartyId,
        amount: String(dto.amount),
        transferredAt: dto.transferredAt.slice(0, 10),
        medium: dto.medium ?? null,
        note: dto.note ?? null,
        importBatchId: opts?.importBatchId ?? null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "settlement.transfer_recorded",
      entity: "settlement_transfer",
      entityId: row!.id,
      detail: { fromPartyId: dto.fromPartyId, toPartyId: dto.toPartyId, amount: dto.amount },
    });
    return row!;
  }

  listTransfers(tx: Db, partyId?: string) {
    // RLS already limits rows to transfers the caller is a party to; the
    // optional filter narrows to one counterparty within that.
    const where = partyId
      ? or(eq(schema.settlementTransfer.fromPartyId, partyId), eq(schema.settlementTransfer.toPartyId, partyId))
      : undefined;
    return tx
      .select()
      .from(schema.settlementTransfer)
      .where(where)
      .orderBy(schema.settlementTransfer.transferredAt);
  }

  /** Reverse a transfer = a negative mirror (append-only). The actor is a party
   *  to the transfer (RLS lets them read it); refuse double/again-reversal. */
  async reverseTransfer(tx: Db, principal: SessionPrincipal, originalId: string, reason?: string) {
    const [orig] = await tx
      .select()
      .from(schema.settlementTransfer)
      .where(eq(schema.settlementTransfer.id, originalId));
    if (!orig) throw new NotFoundException("Transfer not found");
    if (orig.reversesTransferId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx
      .select({ id: schema.settlementTransfer.id })
      .from(schema.settlementTransfer)
      .where(eq(schema.settlementTransfer.reversesTransferId, originalId));
    if (existing) throw new BadRequestException("Transfer already reversed");

    const [rev] = await tx
      .insert(schema.settlementTransfer)
      .values({
        orgId: principal.orgId,
        fromPartyId: orig.fromPartyId,
        toPartyId: orig.toPartyId,
        amount: String(-Number(orig.amount)),
        transferredAt: orig.transferredAt,
        medium: orig.medium,
        note: `Reversal of ${originalId}${reason ? `: ${reason}` : ""}`,
        reversesTransferId: originalId,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "settlement.transfer_reversed",
      entity: "settlement_transfer",
      entityId: rev!.id,
      detail: { reverses: originalId },
    });
    return rev!;
  }

  /**
   * Apply the platform/system fee: a % the party owes the business on the job.
   * Thin wrapper over applyCharge (term_type='platform_fee'; pct of earnings).
   */
  applyPlatformFee(tx: Db, principal: SessionPrincipal, dto: ApplyChargeDto) {
    return this.applyCharge(tx, principal, {
      ...dto,
      termType: "platform_fee",
      category: "platform_fee",
      label: "Platform fee",
      auditAction: "settlement.platform_fee_applied",
    });
  }

  /**
   * Apply a writer commission: a % OF the writer's job earnings OR a FIXED amount
   * the writer owes the business per job (DESIGN_SPEC §3.5 — a party-owes-business
   * charge / comp rule on the writer). Same mechanism as the platform fee.
   */
  applyWriterCommission(tx: Db, principal: SessionPrincipal, dto: ApplyChargeDto) {
    return this.applyCharge(tx, principal, {
      ...dto,
      termType: "writer_commission",
      category: "writer_commission",
      label: "Writer commission",
      auditAction: "settlement.writer_commission_applied",
    });
  }

  /**
   * Generalized party→business charge: resolve the deal-term (effective-dated via
   * the shared resolver) and insert the charge. basis='fixed' → the value is the
   * amount (works even with zero leg earnings); otherwise (null/'pct') → a % of
   * the party's earnings on the job (party_job_earnings definer). The charge is
   * party-RLS and the admin isn't the party, so use a client-side id + no
   * RETURNING. Idempotent per (party, job, category) via the charge_exists definer
   * (backstopped by a partial unique index). Guards on the COMPUTED amount > 0 so
   * a valid fixed charge is never rejected for want of leg earnings.
   */
  private async applyCharge(
    tx: Db,
    principal: SessionPrincipal,
    args: ApplyChargeDto & {
      termType: "platform_fee" | "writer_commission";
      category: "platform_fee" | "writer_commission";
      label: string;
      auditAction: string;
    },
  ) {
    // Job date drives effective-dating (work_item is tenant-readable).
    const [job] = await tx
      .select({ id: schema.workItem.id, createdAt: schema.workItem.createdAt })
      .from(schema.workItem)
      .where(eq(schema.workItem.id, args.workItemId));
    if (!job) throw new NotFoundException("Work item not found");
    const asOf = job.createdAt.toISOString().slice(0, 10);

    // Resolve the term as-of the job date (precedence + effective-dating). A
    // global term (from/to null) matches regardless of the ctx party ids.
    const candidates = (await tx
      .select()
      .from(schema.dealTerm)
      .where(eq(schema.dealTerm.termType, args.termType))) as unknown as DealTermLike[];
    const term = resolveDealTerm(candidates, {
      fromPartyId: args.partyId,
      toPartyId: args.partyId,
      termType: args.termType,
      asOf,
    });
    if (!term) throw new BadRequestException(`No ${args.termType} deal term in effect for this job`);

    // Idempotency: refuse a second live charge of this category on the party+job.
    const existsRes = await tx.execute(
      sql`select charge_exists(${args.partyId}, ${args.workItemId}, ${args.category}) as "exists"`,
    );
    if ((existsRes.rows[0] as { exists: boolean }).exists) {
      throw new BadRequestException(`${args.label} already applied for this party + job`);
    }

    const isFixed = term.basis === "fixed";
    let base = 0;
    let amount: number;
    let reason: string;
    if (isFixed) {
      amount = round2(Number(term.value));
      reason = `${args.label} (fixed) ${amount}`;
    } else {
      // base = the party's earnings on this job (legs to them) via definer.
      const baseRes = await tx.execute(
        sql`select party_job_earnings(${args.partyId}, ${args.workItemId}) as base`,
      );
      base = Number((baseRes.rows[0] as { base: string }).base);
      amount = round2((base * Number(term.value)) / 100);
      reason = `${args.label} ${term.value}% of ${base} earnings`;
    }
    if (amount <= 0) {
      throw new BadRequestException(`Computed ${args.label.toLowerCase()} is zero`);
    }

    const id = randomUUID();
    await tx.insert(schema.charge).values({
      id,
      orgId: principal.orgId,
      partyId: args.partyId,
      workItemId: args.workItemId,
      dealTermId: term.id,
      category: args.category,
      amount: String(amount),
      reason,
      createdBy: principal.userId,
    });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: args.auditAction,
      entity: "charge",
      entityId: id,
      detail: { partyId: args.partyId, workItemId: args.workItemId, basis: term.basis ?? "pct", base, amount },
    });
    return { id, amount, base, pct: isFixed ? null : term.value, basis: term.basis ?? "pct" };
  }
}
