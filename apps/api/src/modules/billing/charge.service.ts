import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateChargeDto, ReverseChargeDto } from "./dto.js";

/**
 * Charges a party OWES the business (bidirectional ledger; party→business). Like
 * legs, charges are party-scoped by RLS, so an admin creating a charge on a
 * writer isn't a party to it — use client-side ids + no RETURNING (reading the
 * row back would trip the SELECT policy). Append-only; corrections are reversing
 * (negative) entries.
 */
@Injectable()
export class ChargeService {
  constructor(private readonly audit: AuditService) {}

  async createCharge(tx: Db, principal: SessionPrincipal, dto: CreateChargeDto) {
    const id = randomUUID();
    await tx.insert(schema.charge).values({
      id,
      orgId: principal.orgId,
      partyId: dto.partyId,
      workItemId: dto.workItemId ?? null,
      dealTermId: dto.dealTermId ?? null,
      category: dto.category,
      amount: String(dto.amount),
      reason: dto.reason ?? null,
      createdBy: principal.userId,
    });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.charge_created",
      entity: "charge",
      entityId: id,
      detail: { partyId: dto.partyId, category: dto.category, amount: dto.amount },
    });
    return { id };
  }

  /**
   * Reverse a charge = a negative mirror referencing the original (append-only).
   * party/amount are taken from the SOURCE charge (via the charge_summary
   * SECURITY DEFINER lookup), never the client — and a charge can't be reversed
   * twice (B3). The admin isn't a party to the charge, so RLS hides it from a
   * normal SELECT; charge_summary is the sanctioned read.
   */
  async reverseCharge(tx: Db, principal: SessionPrincipal, dto: ReverseChargeDto) {
    const res = await tx.execute(sql`
      select org_id as "orgId", party_id as "partyId", amount, reversed
      from charge_summary(${dto.originalId})
    `);
    const src = res.rows[0] as
      | { orgId: string; partyId: string; amount: string; reversed: boolean }
      | undefined;
    if (!src || src.orgId !== principal.orgId) throw new NotFoundException("Charge not found");
    if (src.reversed) throw new BadRequestException("Charge already reversed");

    const id = randomUUID();
    const amount = -Math.abs(Number(src.amount));
    await tx.insert(schema.charge).values({
      id,
      orgId: principal.orgId,
      partyId: src.partyId,
      category: "adjustment",
      amount: String(amount),
      reason: `Reversal of ${dto.originalId}${dto.reason ? `: ${dto.reason}` : ""}`,
      reversesChargeId: dto.originalId,
      createdBy: principal.userId,
    });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.charge_reversed",
      entity: "charge",
      entityId: id,
      detail: { reverses: dto.originalId, partyId: src.partyId, amount },
    });
    return { id };
  }

  /** List a party's charges (RLS-scoped: the party themselves or SuperAdmin). */
  listCharges(tx: Db, partyId: string) {
    return tx.select().from(schema.charge).where(eq(schema.charge.partyId, partyId)).orderBy(schema.charge.createdAt);
  }
}
