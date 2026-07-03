import { Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";
import type { CreatePfCategoryDto, ListPfCategoryQueryDto, UpdatePfCategoryDto } from "./pf-category.dto.js";

/** User-defined income/expense categories (§11). Archived, never hard-deleted. */
@Injectable()
export class PfCategoryService {
  constructor(private readonly audit: PfAuditService) {}

  async create(tx: Db, pfAccountId: string, dto: CreatePfCategoryDto) {
    const [row] = await tx
      .insert(schema.pfCategory)
      .values({ pfAccountId, kind: dto.kind, name: dto.name.trim() })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.category_created", entity: "pf_category", entityId: row!.id, detail: { kind: dto.kind } });
    return row!;
  }

  list(tx: Db, _pfAccountId: string, filters: ListPfCategoryQueryDto) {
    const conds = [isNull(schema.pfCategory.archivedAt)];
    if (filters.kind) conds.push(eq(schema.pfCategory.kind, filters.kind));
    return tx.select().from(schema.pfCategory).where(and(...conds)).orderBy(asc(schema.pfCategory.name));
  }

  /**
   * Most-used categories (by usage in the last 90 days), for surfacing as quick-add
   * chips. Derived at read; a LEFT JOIN keeps unused categories present (ranked
   * after used ones) so a fresh account still has chips.
   */
  async frequent(tx: Db, kind: "income" | "expense", limit = 6) {
    const res =
      kind === "income"
        ? await tx.execute(sql`
            select c.id, c.name, count(t.id)::int as uses
            from pf_category c
            left join pf_income t on t.category_id = c.id and t.reverses_id is null
              and t.occurred_on >= (current_date - interval '90 days')
            where c.archived_at is null and c.kind = 'income'
            group by c.id, c.name order by uses desc, c.name asc limit ${limit}`)
        : await tx.execute(sql`
            select c.id, c.name, count(t.id)::int as uses
            from pf_category c
            left join pf_expense t on t.category_id = c.id and t.reverses_id is null
              and t.occurred_on >= (current_date - interval '90 days')
            where c.archived_at is null and c.kind = 'expense'
            group by c.id, c.name order by uses desc, c.name asc limit ${limit}`);
    return res.rows;
  }

  async rename(tx: Db, pfAccountId: string, id: string, dto: UpdatePfCategoryDto) {
    const [row] = await tx
      .update(schema.pfCategory)
      .set({ name: dto.name.trim() })
      .where(eq(schema.pfCategory.id, id))
      .returning();
    if (!row) throw new NotFoundException("Category not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.category_renamed", entity: "pf_category", entityId: id });
    return row;
  }

  async archive(tx: Db, pfAccountId: string, id: string) {
    const [row] = await tx
      .update(schema.pfCategory)
      .set({ archivedAt: new Date() })
      .where(eq(schema.pfCategory.id, id))
      .returning();
    if (!row) throw new NotFoundException("Category not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.category_archived", entity: "pf_category", entityId: id });
    return { ok: true };
  }
}
