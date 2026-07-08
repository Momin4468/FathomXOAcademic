import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { CreateAdvanceDto, CreateAdvanceEventDto } from "./dto.js";

const day = (s: string) => s.slice(0, 10);

/**
 * Module 20 — business-plane loan/advance ledger (P1 item 11). Ports the proven PF
 * loan shape to the business plane. The OUTSTANDING balance is DERIVED at read
 * (principal + Σdisbursement − Σrepayment + Σadjustment), never stored; events are
 * append-only (a correction is a reversing event, same kind negated). DISJOINT from
 * the leg/settlement money math — surfaced next to a party's balance, never netted
 * into it automatically.
 */
@Injectable()
export class AdvancesService {
  constructor(private readonly audit: AuditService) {}

  /** Create a header; resolves or creates the counterparty party. */
  async create(tx: Db, principal: SessionPrincipal, dto: CreateAdvanceDto) {
    const counterpartyPartyId = await this.resolveCounterparty(tx, principal, dto);
    const [row] = await tx
      .insert(schema.advance)
      .values({
        orgId: principal.orgId,
        counterpartyPartyId,
        direction: dto.direction,
        principal: String(dto.principal),
        currency: dto.currency?.trim() || "BDT",
        startedOn: day(dto.startedOn),
        dueOn: dto.dueOn ? day(dto.dueOn) : null,
        note: dto.note ?? null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "advance.created",
      entity: "advance",
      entityId: row!.id,
      detail: { counterpartyPartyId, direction: dto.direction, principal: dto.principal },
    });
    return row!;
  }

  /** List advances with derived outstanding (optionally filtered to one counterparty). */
  async list(tx: Db, counterpartyPartyId?: string) {
    const filter = counterpartyPartyId
      ? sql`and l.counterparty_party_id = ${counterpartyPartyId}`
      : sql``;
    const res = await tx.execute(sql`
      select l.id, l.counterparty_party_id as "counterpartyPartyId", p.display_name as "counterpartyName",
             l.direction, l.principal, l.currency, l.started_on as "startedOn", l.due_on as "dueOn",
             l.note, l.created_at as "createdAt",
             (l.principal
               + coalesce(sum(e.amount) filter (where e.kind = 'disbursement'), 0)
               - coalesce(sum(e.amount) filter (where e.kind = 'repayment'), 0)
               + coalesce(sum(e.amount) filter (where e.kind = 'adjustment'), 0)
             ) as "outstanding"
      from advance l
      join party p on p.id = l.counterparty_party_id
      left join advance_event e on e.advance_id = l.id
      where l.archived_at is null ${filter}
      group by l.id, p.display_name
      order by l.started_on desc
    `);
    return res.rows;
  }

  /** One advance: header + events + derived outstanding. */
  async getOne(tx: Db, id: string) {
    const header = (await this.list(tx)).find((r) => (r as { id: string }).id === id) as Record<string, unknown> | undefined;
    if (!header) throw new NotFoundException("Advance not found");
    const events = await tx
      .select()
      .from(schema.advanceEvent)
      .where(eq(schema.advanceEvent.advanceId, id))
      .orderBy(schema.advanceEvent.occurredOn);
    return { ...header, events };
  }

  /**
   * A counterparty's net outstanding, split by direction so the caller can present
   * "they owe us ৳X (given) / we owe them ৳Y (taken)". Surfaced next to the party's
   * BalanceService position — NOT netted into leg/settlement math.
   */
  async partyOutstanding(tx: Db, partyId: string): Promise<{ partyId: string; given: number; taken: number }> {
    const res = await tx.execute(sql`
      select l.direction,
             sum(l.principal
               + coalesce((select sum(e.amount) from advance_event e where e.advance_id = l.id and e.kind = 'disbursement'), 0)
               - coalesce((select sum(e.amount) from advance_event e where e.advance_id = l.id and e.kind = 'repayment'), 0)
               + coalesce((select sum(e.amount) from advance_event e where e.advance_id = l.id and e.kind = 'adjustment'), 0)
             ) as outstanding
      from advance l
      where l.counterparty_party_id = ${partyId} and l.archived_at is null
      group by l.direction
    `);
    let given = 0;
    let taken = 0;
    for (const r of res.rows as Array<{ direction: string; outstanding: string }>) {
      if (r.direction === "given") given = Number(r.outstanding);
      else if (r.direction === "taken") taken = Number(r.outstanding);
    }
    return { partyId, given, taken };
  }

  async addEvent(tx: Db, principal: SessionPrincipal, advanceId: string, dto: CreateAdvanceEventDto) {
    const [adv] = await tx
      .select({ id: schema.advance.id, archivedAt: schema.advance.archivedAt })
      .from(schema.advance)
      .where(eq(schema.advance.id, advanceId));
    if (!adv) throw new NotFoundException("Advance not found");
    if (adv.archivedAt) throw new BadRequestException("Advance is archived");
    // disbursement/repayment are positive movements; only an adjustment may be signed.
    if (dto.kind !== "adjustment" && dto.amount <= 0) {
      throw new BadRequestException("A disbursement or repayment amount must be positive");
    }
    if (dto.kind === "adjustment" && dto.amount === 0) {
      throw new BadRequestException("An adjustment cannot be zero");
    }
    const [row] = await tx
      .insert(schema.advanceEvent)
      .values({
        orgId: principal.orgId,
        advanceId,
        kind: dto.kind,
        amount: String(dto.amount),
        occurredOn: day(dto.occurredOn),
        note: dto.note ?? null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "advance.event_added",
      entity: "advance_event",
      entityId: row!.id,
      detail: { advanceId, kind: dto.kind, amount: dto.amount },
    });
    return row!;
  }

  /** Reverse an event (append-only: same kind, negated amount). */
  async reverseEvent(tx: Db, principal: SessionPrincipal, eventId: string) {
    const [orig] = await tx.select().from(schema.advanceEvent).where(eq(schema.advanceEvent.id, eventId));
    if (!orig) throw new NotFoundException("Advance event not found");
    if (orig.reversesId) throw new BadRequestException("Cannot reverse a reversal");
    const [existing] = await tx
      .select({ id: schema.advanceEvent.id })
      .from(schema.advanceEvent)
      .where(eq(schema.advanceEvent.reversesId, eventId));
    if (existing) throw new BadRequestException("Already reversed");
    const [row] = await tx
      .insert(schema.advanceEvent)
      .values({
        orgId: principal.orgId,
        advanceId: orig.advanceId,
        kind: orig.kind,
        amount: String(-Number(orig.amount)),
        occurredOn: orig.occurredOn,
        note: `Reversal of ${eventId}`,
        reversesId: eventId,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "advance.event_reversed",
      entity: "advance_event",
      entityId: row!.id,
      detail: { reverses: eventId },
    });
    return row!;
  }

  async archive(tx: Db, principal: SessionPrincipal, id: string) {
    const [row] = await tx
      .update(schema.advance)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.advance.id, id), isNull(schema.advance.archivedAt)))
      .returning({ id: schema.advance.id });
    if (!row) throw new NotFoundException("Advance not found");
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "advance.archived",
      entity: "advance",
      entityId: id,
      detail: null,
    });
    return { ok: true };
  }

  /** Resolve an existing counterparty party or create a provisional directory party. */
  private async resolveCounterparty(tx: Db, principal: SessionPrincipal, dto: CreateAdvanceDto): Promise<string> {
    if (dto.counterpartyPartyId) {
      const [p] = await tx
        .select({ id: schema.party.id })
        .from(schema.party)
        .where(and(eq(schema.party.id, dto.counterpartyPartyId), isNull(schema.party.archivedAt)));
      if (!p) throw new NotFoundException("Counterparty party not found");
      return p.id;
    }
    const name = dto.counterpartyName?.trim();
    if (!name) throw new BadRequestException("Provide a counterpartyPartyId or counterpartyName");
    const [created] = await tx
      .insert(schema.party)
      .values({
        orgId: principal.orgId,
        displayName: name,
        partyType: [], // a directory contact — no business role required for a loan counterparty
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning({ id: schema.party.id });
    return created!.id;
  }
}
