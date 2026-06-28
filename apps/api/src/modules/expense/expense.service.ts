import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { sumAmounts, type SessionPrincipal } from "@business-os/shared";
import { and, desc, eq, gte, isNull, lte, type SQL } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateExpenseDto, ListExpensesQueryDto, UpdateExpenseDto } from "./dto.js";

const day = (s: string) => s.slice(0, 10);
const numOrNull = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

/** A split must be a non-empty object of numeric shares (cost-bearer is load-bearing). */
function isValidSplit(split: unknown): boolean {
  if (!split || typeof split !== "object") return false;
  const entries = Object.entries(split as Record<string, unknown>);
  return entries.length > 0 && entries.every(([, v]) => typeof v === "number" && Number.isFinite(v));
}

@Injectable()
export class ExpenseService {
  constructor(private readonly audit: AuditService) {}

  async create(tx: Db, principal: SessionPrincipal, dto: CreateExpenseDto) {
    if (dto.costBearer === "split" && !isValidSplit(dto.costBearerSplitJson)) {
      throw new BadRequestException("A split expense needs a non-empty numeric cost_bearer_split_json");
    }
    const [row] = await tx
      .insert(schema.expense)
      .values({
        orgId: principal.orgId,
        category: dto.category,
        amount: String(dto.amount),
        incurredAt: day(dto.incurredAt),
        costBearer: dto.costBearer,
        costBearerSplitJson: dto.costBearerSplitJson ?? null,
        payeePartyId: dto.payeePartyId ?? null,
        campaignTag: dto.campaignTag ?? null,
        revenueLinkId: dto.revenueLinkId ?? null,
        receiptFileId: dto.receiptFileId ?? null,
        note: dto.note ?? null,
        nextDueDate: dto.nextDueDate ? day(dto.nextDueDate) : null,
        currency: dto.currency ?? null,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "expense.created",
      entity: "expense",
      entityId: row!.id,
      detail: { category: dto.category, amount: dto.amount, costBearer: dto.costBearer },
    });
    return row!;
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateExpenseDto) {
    const [existing] = await tx.select().from(schema.expense).where(eq(schema.expense.id, id));
    if (!existing) throw new NotFoundException("Expense not found");
    const nextCostBearer = dto.costBearer ?? existing.costBearer;
    const nextSplit = dto.costBearerSplitJson ?? existing.costBearerSplitJson;
    if (nextCostBearer === "split" && !isValidSplit(nextSplit)) {
      throw new BadRequestException("A split expense needs a non-empty numeric cost_bearer_split_json");
    }
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.amount !== undefined && dto.amount !== null) patch.amount = numOrNull(dto.amount);
    if (dto.incurredAt !== undefined) patch.incurredAt = day(dto.incurredAt);
    if (dto.costBearer !== undefined) patch.costBearer = dto.costBearer;
    if (dto.costBearerSplitJson !== undefined) patch.costBearerSplitJson = dto.costBearerSplitJson;
    if (dto.payeePartyId !== undefined) patch.payeePartyId = dto.payeePartyId;
    if (dto.campaignTag !== undefined) patch.campaignTag = dto.campaignTag;
    if (dto.revenueLinkId !== undefined) patch.revenueLinkId = dto.revenueLinkId;
    if (dto.receiptFileId !== undefined) patch.receiptFileId = dto.receiptFileId;
    if (dto.note !== undefined) patch.note = dto.note;
    if (dto.nextDueDate !== undefined) {
      patch.nextDueDate = dto.nextDueDate ? day(dto.nextDueDate) : null;
      // A changed due-date re-arms the reminder for the new date.
      patch.lastRemindedDue = null;
    }
    if (dto.currency !== undefined) patch.currency = dto.currency;
    const [row] = await tx.update(schema.expense).set(patch).where(eq(schema.expense.id, id)).returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "expense.updated",
      entity: "expense",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return row!;
  }

  async getById(tx: Db, id: string) {
    const [row] = await tx.select().from(schema.expense).where(eq(schema.expense.id, id));
    if (!row) throw new NotFoundException("Expense not found");
    return row;
  }

  async list(tx: Db, filters: ListExpensesQueryDto) {
    const conds: SQL[] = [isNull(schema.expense.archivedAt)];
    if (filters.category) conds.push(eq(schema.expense.category, filters.category));
    if (filters.costBearer) conds.push(eq(schema.expense.costBearer, filters.costBearer));
    if (filters.from) conds.push(gte(schema.expense.incurredAt, day(filters.from)));
    if (filters.to) conds.push(lte(schema.expense.incurredAt, day(filters.to)));
    const rows = await tx
      .select()
      .from(schema.expense)
      .where(and(...conds))
      .orderBy(desc(schema.expense.incurredAt))
      .limit(500);
    const total = sumAmounts(rows.map((r) => r.amount));
    return { expenses: rows, total };
  }
}
