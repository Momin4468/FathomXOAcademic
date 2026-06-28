import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";
import type { CreatePfExpenseDto, CreatePfIncomeDto, ListPfEntryQueryDto } from "./pf-entry.dto.js";

const day = (s: string) => s.slice(0, 10);

/**
 * Income & expense entries (§11). Append-only: a "delete" is a reversing entry
 * (amount negated, reverses_id set), never a destructive edit (CLAUDE.md §3.4).
 * Multi-currency recorded as entered; an optional user-entered converted amount
 * may accompany it (no automatic FX).
 */
@Injectable()
export class PfEntryService {
  constructor(private readonly audit: PfAuditService) {}

  /** Guard: a referenced category must belong to THIS account and the right kind. */
  private async assertCategory(tx: Db, categoryId: string | undefined, kind: "income" | "expense"): Promise<void> {
    if (!categoryId) return;
    const [c] = await tx
      .select({ id: schema.pfCategory.id, kind: schema.pfCategory.kind })
      .from(schema.pfCategory)
      .where(eq(schema.pfCategory.id, categoryId));
    if (!c) throw new BadRequestException("Category not found");
    if (c.kind !== kind) throw new BadRequestException(`Category is not an ${kind} category`);
  }

  async createIncome(tx: Db, pfAccountId: string, dto: CreatePfIncomeDto) {
    await this.assertCategory(tx, dto.categoryId, "income");
    const [row] = await tx
      .insert(schema.pfIncome)
      .values({
        pfAccountId,
        categoryId: dto.categoryId ?? null,
        amount: String(dto.amount),
        currency: dto.currency ?? "BDT",
        convertedAmount: dto.convertedAmount != null ? String(dto.convertedAmount) : null,
        convertedCurrency: dto.convertedCurrency ?? null,
        occurredOn: day(dto.occurredOn),
        note: dto.note ?? null,
        source: "manual",
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.income_created", entity: "pf_income", entityId: row!.id, detail: { amount: dto.amount, currency: dto.currency ?? "BDT" } });
    return row!;
  }

  async createExpense(tx: Db, pfAccountId: string, dto: CreatePfExpenseDto) {
    await this.assertCategory(tx, dto.categoryId, "expense");
    const [row] = await tx
      .insert(schema.pfExpense)
      .values({
        pfAccountId,
        categoryId: dto.categoryId ?? null,
        amount: String(dto.amount),
        currency: dto.currency ?? "BDT",
        convertedAmount: dto.convertedAmount != null ? String(dto.convertedAmount) : null,
        convertedCurrency: dto.convertedCurrency ?? null,
        occurredOn: day(dto.occurredOn),
        note: dto.note ?? null,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.expense_created", entity: "pf_expense", entityId: row!.id, detail: { amount: dto.amount, currency: dto.currency ?? "BDT" } });
    return row!;
  }

  listIncome(tx: Db, filters: ListPfEntryQueryDto) {
    const conds: SQL[] = [];
    if (filters.categoryId) conds.push(eq(schema.pfIncome.categoryId, filters.categoryId));
    if (filters.from) conds.push(gte(schema.pfIncome.occurredOn, day(filters.from)));
    if (filters.to) conds.push(lte(schema.pfIncome.occurredOn, day(filters.to)));
    return tx
      .select()
      .from(schema.pfIncome)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.pfIncome.occurredOn), desc(schema.pfIncome.createdAt))
      .limit(1000);
  }

  listExpense(tx: Db, filters: ListPfEntryQueryDto) {
    const conds: SQL[] = [];
    if (filters.categoryId) conds.push(eq(schema.pfExpense.categoryId, filters.categoryId));
    if (filters.from) conds.push(gte(schema.pfExpense.occurredOn, day(filters.from)));
    if (filters.to) conds.push(lte(schema.pfExpense.occurredOn, day(filters.to)));
    return tx
      .select()
      .from(schema.pfExpense)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.pfExpense.occurredOn), desc(schema.pfExpense.createdAt))
      .limit(1000);
  }

  /** Reverse an income row (append-only correction). */
  async reverseIncome(tx: Db, pfAccountId: string, id: string) {
    const [orig] = await tx.select().from(schema.pfIncome).where(eq(schema.pfIncome.id, id));
    if (!orig) throw new NotFoundException("Income not found");
    if (orig.reversesId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx.select({ id: schema.pfIncome.id }).from(schema.pfIncome).where(eq(schema.pfIncome.reversesId, id));
    if (existing) throw new BadRequestException("Already reversed");
    const [rev] = await tx
      .insert(schema.pfIncome)
      .values({
        pfAccountId,
        categoryId: orig.categoryId,
        amount: String(-Number(orig.amount)),
        currency: orig.currency,
        convertedAmount: orig.convertedAmount != null ? String(-Number(orig.convertedAmount)) : null,
        convertedCurrency: orig.convertedCurrency,
        occurredOn: orig.occurredOn,
        note: `Reversal of ${id}`,
        source: orig.source,
        reversesId: id,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.income_reversed", entity: "pf_income", entityId: rev!.id, detail: { reverses: id } });
    return rev!;
  }

  /** Reverse an expense row (append-only correction). */
  async reverseExpense(tx: Db, pfAccountId: string, id: string) {
    const [orig] = await tx.select().from(schema.pfExpense).where(eq(schema.pfExpense.id, id));
    if (!orig) throw new NotFoundException("Expense not found");
    if (orig.reversesId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx.select({ id: schema.pfExpense.id }).from(schema.pfExpense).where(eq(schema.pfExpense.reversesId, id));
    if (existing) throw new BadRequestException("Already reversed");
    const [rev] = await tx
      .insert(schema.pfExpense)
      .values({
        pfAccountId,
        categoryId: orig.categoryId,
        amount: String(-Number(orig.amount)),
        currency: orig.currency,
        convertedAmount: orig.convertedAmount != null ? String(-Number(orig.convertedAmount)) : null,
        convertedCurrency: orig.convertedCurrency,
        occurredOn: orig.occurredOn,
        note: `Reversal of ${id}`,
        reversesId: id,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.expense_reversed", entity: "pf_expense", entityId: rev!.id, detail: { reverses: id } });
    return rev!;
  }
}
