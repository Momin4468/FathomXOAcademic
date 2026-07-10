import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { desc, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateOpeningBalanceDto } from "./opening-balance.dto.js";

/**
 * Opening balance (Phase 5) — a one-time, dated starting point per party (or the
 * business overall), fed into the DERIVED balance as a constant. Its own entry
 * type, never a fake backdated job/payment. Append-only: a correction is a
 * reversing entry (negated amount), never an edit. `as_of` may be any past date.
 */
@Injectable()
export class OpeningBalanceService {
  constructor(private readonly audit: AuditService) {}

  async create(tx: Db, principal: SessionPrincipal, dto: CreateOpeningBalanceDto) {
    const [row] = await tx
      .insert(schema.openingBalance)
      .values({
        orgId: principal.orgId,
        partyId: dto.partyId ?? null, // null = the business overall
        amount: String(dto.amount),
        currency: dto.currency ?? "BDT",
        asOf: dto.asOf, // a real past date is always allowed
        note: dto.note ?? null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "opening_balance.created",
      entity: "opening_balance",
      entityId: row!.id,
      detail: { partyId: dto.partyId ?? null, amount: dto.amount, asOf: dto.asOf },
    });
    return row!;
  }

  /** List entries — for one party, or (scope=business) the business-overall set. */
  list(tx: Db, opts: { partyId?: string; business?: boolean }) {
    const base = tx.select().from(schema.openingBalance);
    if (opts.business) return base.where(sql`${schema.openingBalance.partyId} is null`).orderBy(desc(schema.openingBalance.asOf));
    if (opts.partyId) return base.where(eq(schema.openingBalance.partyId, opts.partyId)).orderBy(desc(schema.openingBalance.asOf));
    return base.orderBy(desc(schema.openingBalance.asOf)).limit(500);
  }

  /** Reverse an entry with a negated mirror (append-only correction). */
  async reverse(tx: Db, principal: SessionPrincipal, id: string) {
    const [orig] = await tx.select().from(schema.openingBalance).where(eq(schema.openingBalance.id, id));
    if (!orig) throw new NotFoundException("Opening balance not found");
    if (orig.reversesId) throw new BadRequestException("Cannot reverse a reversal");
    const [row] = await tx
      .insert(schema.openingBalance)
      .values({
        orgId: principal.orgId,
        partyId: orig.partyId,
        amount: String(-Number(orig.amount)),
        currency: orig.currency,
        asOf: orig.asOf,
        note: `Reversal of ${id}`,
        reversesId: id,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "opening_balance.reversed",
      entity: "opening_balance",
      entityId: row!.id,
      detail: { reverses: id },
    });
    return row!;
  }

  /** The party's net opening balance (base currency) — used by BalanceService. */
  static async sumForParty(tx: Db, partyId: string): Promise<number> {
    const res = await tx.execute(
      sql`select coalesce(sum(amount), 0) as v from opening_balance where party_id = ${partyId} and currency = 'BDT'`,
    );
    return Number((res.rows[0] as { v: string }).v);
  }
}
