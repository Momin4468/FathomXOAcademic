import { Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";
import type { CreatePfSubscriptionDto, UpdatePfSubscriptionDto } from "./pf-subscription.dto.js";

const day = (s: string) => s.slice(0, 10);

/** Subscription tracking (§11). A reminder fires 3 days before next_due_date. */
@Injectable()
export class PfSubscriptionService {
  constructor(private readonly audit: PfAuditService) {}

  async create(tx: Db, pfAccountId: string, dto: CreatePfSubscriptionDto) {
    const [row] = await tx
      .insert(schema.pfSubscription)
      .values({
        pfAccountId,
        name: dto.name.trim(),
        categoryId: dto.categoryId ?? null,
        amount: String(dto.amount),
        currency: dto.currency ?? "BDT",
        nextDueDate: dto.nextDueDate ? day(dto.nextDueDate) : null,
        note: dto.note ?? null,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.subscription_created", entity: "pf_subscription", entityId: row!.id });
    return row!;
  }

  list(tx: Db, _pfAccountId: string) {
    return tx
      .select()
      .from(schema.pfSubscription)
      .where(isNull(schema.pfSubscription.archivedAt))
      .orderBy(asc(schema.pfSubscription.nextDueDate));
  }

  async update(tx: Db, pfAccountId: string, id: string, dto: UpdatePfSubscriptionDto) {
    const [existing] = await tx.select().from(schema.pfSubscription).where(eq(schema.pfSubscription.id, id));
    if (!existing) throw new NotFoundException("Subscription not found");
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.amount !== undefined) patch.amount = String(dto.amount);
    if (dto.currency !== undefined) patch.currency = dto.currency;
    if (dto.note !== undefined) patch.note = dto.note;
    if (dto.nextDueDate !== undefined) {
      patch.nextDueDate = dto.nextDueDate ? day(dto.nextDueDate) : null;
      // A changed due-date re-arms the reminder for the new date.
      patch.lastRemindedDue = null;
    }
    const [row] = await tx.update(schema.pfSubscription).set(patch).where(eq(schema.pfSubscription.id, id)).returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.subscription_updated", entity: "pf_subscription", entityId: id });
    return row!;
  }

  async archive(tx: Db, pfAccountId: string, id: string) {
    const [row] = await tx
      .update(schema.pfSubscription)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.pfSubscription.id, id), isNull(schema.pfSubscription.archivedAt)))
      .returning();
    if (!row) throw new NotFoundException("Subscription not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.subscription_archived", entity: "pf_subscription", entityId: id });
    return { ok: true };
  }
}
