import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { eq } from "drizzle-orm";
import { PfAuditService } from "../pf-audit.service.js";
import type { CreatePfSavingDto, CreatePfSavingEventDto } from "./pf-saving.dto.js";

const day = (s: string) => s.slice(0, 10);

/**
 * Savings pots (§11). The BALANCE is DERIVED at read, never stored: Σ(deposits) −
 * Σ(withdrawals). Events append-only; a reversal is a same-kind negated mirror.
 */
@Injectable()
export class PfSavingService {
  constructor(private readonly audit: PfAuditService) {}

  async create(tx: Db, pfAccountId: string, dto: CreatePfSavingDto) {
    const [row] = await tx
      .insert(schema.pfSaving)
      .values({
        pfAccountId,
        name: dto.name.trim(),
        currency: dto.currency ?? "BDT",
        targetAmount: dto.targetAmount != null ? String(dto.targetAmount) : null,
        note: dto.note ?? null,
      })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.saving_created", entity: "pf_saving", entityId: row!.id });
    return row!;
  }

  async list(tx: Db, _pfAccountId: string) {
    const res = await tx.execute(sql`
      select s.id, s.name, s.currency, s.target_amount as "targetAmount", s.note,
             s.archived_at as "archivedAt",
             (coalesce(sum(e.amount) filter (where e.kind = 'deposit'), 0)
              - coalesce(sum(e.amount) filter (where e.kind = 'withdraw'), 0)) as "balance"
      from pf_saving s
      left join pf_saving_event e on e.saving_id = s.id
      where s.archived_at is null
      group by s.id
      order by s.created_at desc
    `);
    return res.rows;
  }

  async events(tx: Db, savingId: string) {
    return tx.select().from(schema.pfSavingEvent).where(eq(schema.pfSavingEvent.savingId, savingId)).orderBy(schema.pfSavingEvent.occurredOn);
  }

  async addEvent(tx: Db, pfAccountId: string, savingId: string, dto: CreatePfSavingEventDto) {
    const [s] = await tx.select({ id: schema.pfSaving.id }).from(schema.pfSaving).where(eq(schema.pfSaving.id, savingId));
    if (!s) throw new NotFoundException("Savings pot not found");
    const [row] = await tx
      .insert(schema.pfSavingEvent)
      .values({ pfAccountId, savingId, kind: dto.kind, amount: String(dto.amount), occurredOn: day(dto.occurredOn), note: dto.note ?? null })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.saving_event_added", entity: "pf_saving_event", entityId: row!.id, detail: { savingId, kind: dto.kind, amount: dto.amount } });
    return row!;
  }

  async reverseEvent(tx: Db, pfAccountId: string, eventId: string) {
    const [orig] = await tx.select().from(schema.pfSavingEvent).where(eq(schema.pfSavingEvent.id, eventId));
    if (!orig) throw new NotFoundException("Savings event not found");
    if (orig.reversesId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx.select({ id: schema.pfSavingEvent.id }).from(schema.pfSavingEvent).where(eq(schema.pfSavingEvent.reversesId, eventId));
    if (existing) throw new BadRequestException("Already reversed");
    const [row] = await tx
      .insert(schema.pfSavingEvent)
      .values({ pfAccountId, savingId: orig.savingId, kind: orig.kind, amount: String(-Number(orig.amount)), occurredOn: orig.occurredOn, note: `Reversal of ${eventId}`, reversesId: eventId })
      .returning();
    await this.audit.record(tx, pfAccountId, { action: "pf.saving_event_reversed", entity: "pf_saving_event", entityId: row!.id, detail: { reverses: eventId } });
    return row!;
  }

  async archive(tx: Db, pfAccountId: string, id: string) {
    const [row] = await tx.update(schema.pfSaving).set({ archivedAt: new Date() }).where(eq(schema.pfSaving.id, id)).returning();
    if (!row) throw new NotFoundException("Savings pot not found");
    await this.audit.record(tx, pfAccountId, { action: "pf.saving_archived", entity: "pf_saving", entityId: id });
    return { ok: true };
  }
}
