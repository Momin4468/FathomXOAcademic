import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { computeLineAmount, sumAmounts, type SessionPrincipal } from "@business-os/shared";
import { eq, inArray } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreatePriceGroupDto } from "./dto.js";

/**
 * Ad-hoc bulk pricing (P1 item 9) — several separate tasks billed as ONE combined
 * sum, each keeping its own record. Anchor-line model: the group's member consumer
 * lines all get `price_group_id`; ONE anchor carries the combined `fixed_amount`,
 * the siblings sit at ৳0 (tagged, so "৳0 = billed in group X" is explicit). Billing
 * is unchanged — the anchor line attaches to the invoice like any consumer line.
 */
@Injectable()
export class PriceGroupService {
  constructor(private readonly audit: AuditService) {}

  async createGroup(tx: Db, principal: SessionPrincipal, dto: CreatePriceGroupDto) {
    if (dto.lineIds.length < 2) throw new BadRequestException("A price group needs at least 2 consumer lines");
    if (new Set(dto.lineIds).size !== dto.lineIds.length) throw new BadRequestException("Duplicate line ids");

    const lines = await tx
      .select({ id: schema.workLine.id, consumerPartyId: schema.workLine.consumerPartyId, priceGroupId: schema.workLine.priceGroupId })
      .from(schema.workLine)
      .where(inArray(schema.workLine.id, dto.lineIds));
    if (lines.length !== dto.lineIds.length) throw new BadRequestException("Some lines were not found in this org");
    for (const l of lines) {
      if (!l.consumerPartyId) throw new BadRequestException("Every group line must be a consumer (client) line");
      if (l.priceGroupId) throw new BadRequestException(`Line ${l.id} is already in a price group`);
    }
    const clients = new Set(lines.map((l) => l.consumerPartyId));
    if (clients.size > 1) throw new BadRequestException("All group lines must be for the same client");
    const anchorClient = lines.find((l) => l.id === dto.lineIds[0])!.consumerPartyId!;
    if (dto.clientPartyId && dto.clientPartyId !== anchorClient) {
      throw new BadRequestException("clientPartyId must match the lines' consumer");
    }

    const [group] = await tx
      .insert(schema.priceGroup)
      .values({ orgId: principal.orgId, clientPartyId: anchorClient, note: dto.note ?? null, createdBy: principal.userId })
      .returning();

    // Anchor carries the combined price; siblings go to ৳0 — all tagged.
    const anchorId = dto.lineIds[0]!;
    await tx
      .update(schema.workLine)
      .set({ fixedAmount: String(dto.combinedAmount), clientRate: null, priceGroupId: group!.id })
      .where(eq(schema.workLine.id, anchorId));
    for (const lid of dto.lineIds.slice(1)) {
      await tx
        .update(schema.workLine)
        .set({ fixedAmount: "0", clientRate: null, priceGroupId: group!.id })
        .where(eq(schema.workLine.id, lid));
    }

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.price_group_created",
      entity: "price_group",
      entityId: group!.id,
      detail: { combinedAmount: dto.combinedAmount, anchorLineId: anchorId, memberLineIds: dto.lineIds },
    });
    return { id: group!.id, anchorLineId: anchorId, memberLineIds: dto.lineIds, combinedAmount: dto.combinedAmount };
  }

  async getGroup(tx: Db, id: string) {
    const [group] = await tx.select().from(schema.priceGroup).where(eq(schema.priceGroup.id, id));
    if (!group) throw new NotFoundException("Price group not found");
    const lines = await tx
      .select({
        id: schema.workLine.id,
        workItemId: schema.workLine.workItemId,
        consumerPartyId: schema.workLine.consumerPartyId,
        fixedAmount: schema.workLine.fixedAmount,
        clientRate: schema.workLine.clientRate,
        wordCount: schema.workLine.wordCount,
        unitCount: schema.workLine.unitCount,
      })
      .from(schema.workLine)
      .where(eq(schema.workLine.priceGroupId, id));
    const combinedAmount = sumAmounts(
      lines.map((l) => computeLineAmount({ rate: l.clientRate, count: l.wordCount ?? l.unitCount ?? 1, fixedAmount: l.fixedAmount })),
    );
    return { group, lines, combinedAmount };
  }
}
