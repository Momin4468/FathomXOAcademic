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
import type { ApplyPlatformFeeDto, RecordTransferDto } from "./dto.js";

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

  async recordTransfer(tx: Db, principal: SessionPrincipal, dto: RecordTransferDto) {
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
   * Apply the platform/system fee: resolve the platform_fee deal-term (a % of
   * the party's earnings on the job) and insert the party→business charge. The
   * charge is party-RLS and the admin isn't the party, so use a client-side id +
   * no RETURNING (the ChargeService pattern). Idempotent: refuses a second live
   * platform_fee on the same party+job.
   */
  async applyPlatformFee(tx: Db, principal: SessionPrincipal, dto: ApplyPlatformFeeDto) {
    // Job date drives effective-dating (work_item is tenant-readable).
    const [job] = await tx
      .select({ id: schema.workItem.id, createdAt: schema.workItem.createdAt })
      .from(schema.workItem)
      .where(eq(schema.workItem.id, dto.workItemId));
    if (!job) throw new NotFoundException("Work item not found");
    const asOf = job.createdAt.toISOString().slice(0, 10);

    // Resolve the platform_fee term as-of the job date via the shared resolver
    // (precedence + effective-dating, same logic everywhere). A global term
    // (from/to null) matches regardless of the ctx party ids.
    const candidates = (await tx
      .select()
      .from(schema.dealTerm)
      .where(eq(schema.dealTerm.termType, "platform_fee"))) as unknown as DealTermLike[];
    const term = resolveDealTerm(candidates, {
      fromPartyId: dto.partyId,
      toPartyId: dto.partyId,
      termType: "platform_fee",
      asOf,
    });
    if (!term) throw new BadRequestException("No platform_fee deal term in effect for this job");

    // Guard against a double-charge (charge is party-RLS → definer existence check).
    const existsRes = await tx.execute(
      sql`select platform_fee_exists(${dto.partyId}, ${dto.workItemId}) as "exists"`,
    );
    if ((existsRes.rows[0] as { exists: boolean }).exists) {
      throw new BadRequestException("Platform fee already applied for this party + job");
    }

    // Fee base = the party's earnings on this job (legs to them) via definer.
    const baseRes = await tx.execute(
      sql`select party_job_earnings(${dto.partyId}, ${dto.workItemId}) as base`,
    );
    const base = Number((baseRes.rows[0] as { base: string }).base);
    const amount = round2((base * Number(term.value)) / 100);
    if (amount <= 0) throw new BadRequestException("Computed platform fee is zero (no earnings on this job)");

    const id = randomUUID();
    await tx.insert(schema.charge).values({
      id,
      orgId: principal.orgId,
      partyId: dto.partyId,
      workItemId: dto.workItemId,
      dealTermId: term.id,
      category: "platform_fee",
      amount: String(amount),
      reason: `Platform fee ${term.value}% of ${base} earnings`,
      createdBy: principal.userId,
    });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "settlement.platform_fee_applied",
      entity: "charge",
      entityId: id,
      detail: { partyId: dto.partyId, workItemId: dto.workItemId, pct: term.value, base, amount },
    });
    return { id, amount, base, pct: term.value };
  }
}
