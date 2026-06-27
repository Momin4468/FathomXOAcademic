import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { deriveMargins, type SessionPrincipal } from "@business-os/shared";
import { asc, eq, inArray } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { AppendLegsDto } from "./dto.js";

export interface LegView {
  id: string;
  seq: number;
  fromPartyId: string | null;
  toPartyId: string | null;
  amount: string;
  workLineId: string | null;
}

/**
 * The money chain (SCHEMA §D, DESIGN_SPEC §3.1). Legs are append-only and
 * RLS-protected: getVisibleLegs returns ONLY the legs the caller is party to
 * (or all, for System SuperAdmin) — a non-party gets zero rows. Margin is
 * derived from those visible legs, never stored.
 */
@Injectable()
export class LegService {
  constructor(private readonly audit: AuditService) {}

  /** Admin builds/append the chain. Append-only (no update/delete on legs). */
  async appendLegs(
    tx: Db,
    principal: SessionPrincipal,
    workItemId: string,
    dto: AppendLegsDto,
  ) {
    // Semantic validation of the chain (S2): a leg must connect two distinct
    // parties (or have exactly one open end), and any work_line_id must belong
    // to THIS work item (RLS already scopes org).
    for (const l of dto.legs) {
      if (!l.fromPartyId && !l.toPartyId) {
        throw new BadRequestException(`Leg seq ${l.seq} needs a from or to party`);
      }
      if (l.fromPartyId && l.toPartyId && l.fromPartyId === l.toPartyId) {
        throw new BadRequestException(`Leg seq ${l.seq}: from and to must differ`);
      }
    }
    const lineIds = dto.legs.map((l) => l.workLineId).filter((x): x is string => !!x);
    if (lineIds.length) {
      const found = await tx
        .select({ id: schema.workLine.id, workItemId: schema.workLine.workItemId })
        .from(schema.workLine)
        .where(inArray(schema.workLine.id, lineIds));
      const ok = new Set(found.filter((r) => r.workItemId === workItemId).map((r) => r.id));
      for (const lid of lineIds) {
        if (!ok.has(lid)) throw new BadRequestException(`work_line ${lid} is not on this work item`);
      }
    }

    // NOTE: no RETURNING — under leg RLS, an admin building the chain isn't a
    // party to every leg, so reading the row back would trip the SELECT policy.
    // Generate ids client-side instead.
    const inserted: string[] = [];
    for (const l of dto.legs) {
      const id = randomUUID();
      await tx.insert(schema.leg).values({
        id,
        orgId: principal.orgId,
        workItemId,
        workLineId: l.workLineId ?? null,
        seq: l.seq,
        fromPartyId: l.fromPartyId ?? null,
        toPartyId: l.toPartyId ?? null,
        amount: String(l.amount),
        note: l.note ?? null,
        createdBy: principal.userId,
      });
      inserted.push(id);
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "leg.chain_appended",
      entity: "work_item",
      entityId: workItemId,
      // The actor's own action — record the figures for reconciliation (S5).
      detail: {
        count: inserted.length,
        legs: dto.legs.map((l) => ({
          seq: l.seq,
          fromPartyId: l.fromPartyId ?? null,
          toPartyId: l.toPartyId ?? null,
          amount: l.amount,
        })),
      },
    });
    return { legIds: inserted };
  }

  /** RLS filters this to the caller's own legs (or all for SuperAdmin). */
  async getVisibleLegs(tx: Db, workItemId: string): Promise<LegView[]> {
    return tx
      .select({
        id: schema.leg.id,
        seq: schema.leg.seq,
        fromPartyId: schema.leg.fromPartyId,
        toPartyId: schema.leg.toPartyId,
        amount: schema.leg.amount,
        workLineId: schema.leg.workLineId,
      })
      .from(schema.leg)
      .where(eq(schema.leg.workItemId, workItemId))
      .orderBy(asc(schema.leg.seq));
  }

  /** Margins derived from the visible legs (structural opacity). */
  marginsFor(legs: LegView[]) {
    return deriveMargins(legs);
  }
}
