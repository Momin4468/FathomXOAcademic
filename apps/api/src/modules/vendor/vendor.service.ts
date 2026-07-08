import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, desc, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { BalanceService } from "../billing/balance.service.js";
import type { DecideVendorClaimDto, SubmitVendorClaimDto } from "./dto.js";

/**
 * Module 21 — vendor self-service (audit item 13). A vendor is a LIGHT business-plane
 * user; the self-view reuses BalanceService + the vendor's OWN handoff legs (leg RLS
 * hides the rest of the chain). Invoicing is a propose→confirm governance record
 * (vendor_claim): the vendor submits, an admin approves/rejects. Approval does NOT
 * post a leg — the admin realizes the payment in the job flow (chain context).
 */
@Injectable()
export class VendorService {
  constructor(
    private readonly audit: AuditService,
    private readonly balance: BalanceService,
  ) {}

  /** The vendor self-view: own balance + own handoff legs + own submitted claims. */
  async me(tx: Db, principal: SessionPrincipal) {
    if (!principal.partyId) {
      return { balance: await this.balance.balance(tx, null), handoffs: [], claims: [] };
    }
    const balance = await this.balance.balance(tx, principal.partyId);
    // Own handoff legs (RLS returns only legs this party is on).
    const handoffs = await tx.execute(sql`
      select id, work_item_id as "workItemId", amount, created_at as "createdAt"
      from leg where to_party_id = ${principal.partyId}
      order by created_at desc
    `);
    const claims = await this.ownClaims(tx, principal.partyId);
    return { balance, handoffs: handoffs.rows, claims };
  }

  /** Submit a proposed invoice — the vendor is always the caller (never from the body). */
  async submitClaim(tx: Db, principal: SessionPrincipal, dto: SubmitVendorClaimDto) {
    if (!principal.partyId) throw new ForbiddenException("Only a vendor party can submit a claim");
    const [row] = await tx
      .insert(schema.vendorClaim)
      .values({
        orgId: principal.orgId,
        vendorPartyId: principal.partyId,
        workItemId: dto.workItemId ?? null,
        amount: String(dto.amount),
        note: dto.note ?? null,
        status: "proposed",
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "vendor.claim_submitted",
      entity: "vendor_claim",
      entityId: row!.id,
      detail: { amount: dto.amount, workItemId: dto.workItemId ?? null },
    });
    return row!;
  }

  /** The caller's own claims (self-scoped). */
  ownClaims(tx: Db, vendorPartyId: string) {
    return tx
      .select()
      .from(schema.vendorClaim)
      .where(eq(schema.vendorClaim.vendorPartyId, vendorPartyId))
      .orderBy(desc(schema.vendorClaim.createdAt));
  }

  // ── admin side ──────────────────────────────────────────────────────────────

  /** All claims in the org (admin), optionally filtered by status. */
  listClaims(tx: Db, status?: string) {
    const base = tx
      .select({
        id: schema.vendorClaim.id,
        vendorPartyId: schema.vendorClaim.vendorPartyId,
        vendorName: schema.party.displayName,
        workItemId: schema.vendorClaim.workItemId,
        amount: schema.vendorClaim.amount,
        note: schema.vendorClaim.note,
        status: schema.vendorClaim.status,
        createdAt: schema.vendorClaim.createdAt,
        decidedAt: schema.vendorClaim.decidedAt,
      })
      .from(schema.vendorClaim)
      .innerJoin(schema.party, eq(schema.party.id, schema.vendorClaim.vendorPartyId));
    const filtered = status ? base.where(eq(schema.vendorClaim.status, status)) : base;
    return filtered.orderBy(desc(schema.vendorClaim.createdAt));
  }

  /** Approve or reject a proposed claim (admin). Only a still-proposed claim can be decided. */
  async decide(tx: Db, principal: SessionPrincipal, id: string, dto: DecideVendorClaimDto) {
    const [claim] = await tx.select().from(schema.vendorClaim).where(eq(schema.vendorClaim.id, id));
    if (!claim) throw new NotFoundException("Vendor claim not found");
    if (claim.status !== "proposed") throw new BadRequestException(`Claim is already ${claim.status}`);
    const [row] = await tx
      .update(schema.vendorClaim)
      .set({ status: dto.status, decidedBy: principal.userId, decidedAt: new Date() })
      .where(and(eq(schema.vendorClaim.id, id), eq(schema.vendorClaim.status, "proposed")))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: `vendor.claim_${dto.status}`,
      entity: "vendor_claim",
      entityId: id,
      detail: { amount: claim.amount, vendorPartyId: claim.vendorPartyId },
    });
    return row!;
  }
}
