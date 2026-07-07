import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { desc, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateOtherIncomeDto } from "./dto.js";

/**
 * Business "other income" (0037) — money the business receives that is NOT a
 * client→writer leg (e.g. the govt 2.5%/1000-BDT FX incentive). Append-only and
 * STRUCTURALLY DISJOINT from payment_allocation / invoice_line, so it can never
 * net against a client's dues. `amount` is BDT; the foreign original + rate are
 * provenance. Corrections are reversing rows.
 */
@Injectable()
export class OtherIncomeService {
  constructor(private readonly audit: AuditService) {}

  async create(tx: Db, principal: SessionPrincipal, dto: CreateOtherIncomeDto) {
    const [row] = await tx
      .insert(schema.otherIncome)
      .values({
        orgId: principal.orgId,
        amount: String(dto.amount),
        originalCurrency: dto.originalCurrency ?? "BDT",
        originalAmount: dto.originalAmount != null ? String(dto.originalAmount) : null,
        fxRate: dto.fxRate != null ? String(dto.fxRate) : null,
        category: dto.category,
        occurredOn: dto.occurredOn.slice(0, 10),
        sourcePaymentId: dto.sourcePaymentId ?? null,
        note: dto.note ?? null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.other_income_recorded",
      entity: "other_income",
      entityId: row!.id,
      detail: { amount: dto.amount, category: dto.category, originalCurrency: dto.originalCurrency ?? "BDT" },
    });
    return row!;
  }

  async list(tx: Db) {
    return tx.select().from(schema.otherIncome).orderBy(desc(schema.otherIncome.occurredOn));
  }

  /** Correction = a reversing entry (append-only); no double/over-reversal. */
  async reverse(tx: Db, principal: SessionPrincipal, originalId: string, reason?: string) {
    const [orig] = await tx.select().from(schema.otherIncome).where(eq(schema.otherIncome.id, originalId));
    if (!orig) throw new NotFoundException("Income row not found");
    if (orig.reversesIncomeId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx
      .select({ id: schema.otherIncome.id })
      .from(schema.otherIncome)
      .where(eq(schema.otherIncome.reversesIncomeId, originalId));
    if (existing) throw new BadRequestException("Income already reversed");
    const [rev] = await tx
      .insert(schema.otherIncome)
      .values({
        orgId: principal.orgId,
        amount: String(-Number(orig.amount)),
        originalCurrency: orig.originalCurrency,
        originalAmount: orig.originalAmount != null ? String(-Number(orig.originalAmount)) : null,
        fxRate: orig.fxRate,
        category: orig.category,
        occurredOn: orig.occurredOn,
        sourcePaymentId: orig.sourcePaymentId,
        note: `Reversal of ${originalId}${reason ? `: ${reason}` : ""}`,
        reversesIncomeId: originalId,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "billing.other_income_reversed",
      entity: "other_income",
      entityId: rev!.id,
      detail: { reverses: originalId, reason: reason ?? null },
    });
    return rev!;
  }
}
