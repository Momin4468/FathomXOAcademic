import { BadRequestException, Injectable } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { computeLineAmount, deriveLineMargin, type SessionPrincipal } from "@business-os/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { AddLineDto, FanOutDto } from "./dto.js";

type LineRow = typeof schema.workLine.$inferSelect;

const numOrNull = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

/**
 * Work lines (SCHEMA §C, DESIGN_SPEC §3.2–3.3). The single mechanism for copies,
 * mixed-rate layers, and multi-writer parts. Producer side (writer entry) and
 * consumer side (client bills) are kept distinct and never conflated.
 */
@Injectable()
export class LineService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Project a raw line to the API shape. When the caller may NOT see money, both
   * the money columns AND the consumer (client) identity are redacted — a writer
   * should not learn which client a price belongs to (spec §4 opacity).
   */
  mapLine(row: LineRow, canSeeMoney: boolean) {
    const side = row.consumerPartyId ? "consumer" : row.writerPartyId ? "producer" : "unassigned";
    const spec = {
      id: row.id,
      workItemId: row.workItemId,
      lineKind: row.lineKind,
      side,
      writerPartyId: row.writerPartyId,
      wordCount: row.wordCount,
      unitCount: row.unitCount,
      sourceLineId: row.sourceLineId,
      note: row.note,
    };
    if (!canSeeMoney) return spec; // consumer identity + all money withheld
    const rate = side === "consumer" ? row.clientRate : row.writerRate;
    const count = row.wordCount ?? row.unitCount ?? 1;
    return {
      ...spec,
      consumerPartyId: row.consumerPartyId,
      clientRate: row.clientRate,
      writerRate: row.writerRate,
      fixedAmount: row.fixedAmount,
      amount: computeLineAmount({ rate, count, fixedAmount: row.fixedAmount }),
    };
  }

  async getLines(tx: Db, workItemId: string): Promise<LineRow[]> {
    return tx.select().from(schema.workLine).where(eq(schema.workLine.workItemId, workItemId));
  }

  /** The writer-side total of a producer line (same convention as mapLine). */
  private producerTotal(row: LineRow): number {
    return computeLineAmount({
      rate: row.writerRate,
      count: row.wordCount ?? row.unitCount ?? 1,
      fixedAmount: row.fixedAmount,
    });
  }

  /**
   * Map all a job's lines to API shape and, for money-visible callers, enrich each
   * CONSUMER line that links to a producer (source_line_id) with a DERIVED per-line
   * margin flag (P1 item 5). Also returns a job-level `hasNegativeMarginLine`.
   * Non-money callers get the plain redacted specs and no flag.
   */
  mapLines(rows: LineRow[], canSeeMoney: boolean): {
    lines: ReturnType<LineService["mapLine"]>[];
    hasNegativeMarginLine: boolean;
  } {
    const mapped = rows.map((r) => this.mapLine(r, canSeeMoney));
    if (!canSeeMoney) return { lines: mapped, hasNegativeMarginLine: false };
    const byId = new Map(rows.map((r) => [r.id, r]));
    let hasNegative = false;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (!row.consumerPartyId || !row.sourceLineId) continue; // only fanned consumer lines
      const producer = byId.get(row.sourceLineId);
      if (!producer) continue; // no visible producer → cost unknown, don't flag
      const consumerAmount = computeLineAmount({
        rate: row.clientRate,
        count: row.wordCount ?? row.unitCount ?? 1,
        fixedAmount: row.fixedAmount,
      });
      const m = deriveLineMargin({
        consumerAmount,
        producerTotalAmount: this.producerTotal(producer),
        copies: producer.unitCount ?? 1,
      });
      Object.assign(mapped[i]!, { margin: m.margin, negativeMargin: m.negativeMargin });
      if (m.negativeMargin) hasNegative = true;
    }
    return { lines: mapped, hasNegativeMarginLine: hasNegative };
  }

  /** Add a single line — strictly one side (producer XOR consumer). */
  async addLine(tx: Db, principal: SessionPrincipal, workItemId: string, dto: AddLineDto) {
    const isConsumer = !!dto.consumerPartyId;
    const isProducer = !!dto.writerPartyId;
    if (isConsumer && isProducer) {
      throw new BadRequestException("A line is producer OR consumer, not both");
    }
    // A NEGATIVE client amount is a discount/credit — allowed ONLY on a client-side
    // 'discount' line (P1 item 6); everywhere else amounts stay non-negative.
    const negativeAmt =
      (dto.clientRate != null && dto.clientRate < 0) || (dto.fixedAmount != null && dto.fixedAmount < 0);
    if (dto.lineKind === "discount") {
      if (!isConsumer) throw new BadRequestException("A discount line is client-side (needs consumerPartyId)");
      if (isProducer) throw new BadRequestException("A discount line cannot be a writer line");
    } else if (negativeAmt) {
      throw new BadRequestException("A negative amount is only allowed on a 'discount' line");
    }
    const [row] = await tx
      .insert(schema.workLine)
      .values({
        orgId: principal.orgId,
        workItemId,
        lineKind: dto.lineKind,
        consumerPartyId: dto.consumerPartyId ?? null,
        writerPartyId: dto.writerPartyId ?? null,
        wordCount: dto.wordCount ?? null,
        unitCount: dto.unitCount ?? 1,
        clientRate: numOrNull(dto.clientRate),
        writerRate: numOrNull(dto.writerRate),
        fixedAmount: numOrNull(dto.fixedAmount),
        note: dto.note ?? null,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.line_added",
      entity: "work_line",
      entityId: row!.id,
      detail: { workItemId, lineKind: dto.lineKind, side: isConsumer ? "consumer" : "producer" },
    });
    return row!;
  }

  /**
   * Copy fan-out (§3.2): the writer's ONE producer entry expands into N
   * INDEPENDENT consumer lines (each its own client, price, state). The producer
   * line carries writer-side money; each consumer line carries client-side money
   * and points back via source_line_id.
   */
  async fanOutCopies(
    tx: Db,
    principal: SessionPrincipal,
    workItemId: string,
    dto: FanOutDto,
  ) {
    if (!dto.consumers?.length) throw new BadRequestException("At least one consumer line required");

    const [producer] = await tx
      .insert(schema.workLine)
      .values({
        orgId: principal.orgId,
        workItemId,
        lineKind: "copy",
        writerPartyId: dto.producer.writerPartyId ?? null,
        wordCount: dto.producer.wordCount ?? null,
        unitCount: dto.consumers.length, // one writer payable across all copies
        writerRate: numOrNull(dto.producer.writerRate),
        fixedAmount: numOrNull(dto.producer.fixedAmount),
      })
      .returning();

    const consumerLines: LineRow[] = [];
    for (const c of dto.consumers) {
      const [line] = await tx
        .insert(schema.workLine)
        .values({
          orgId: principal.orgId,
          workItemId,
          lineKind: "copy",
          consumerPartyId: c.consumerPartyId,
          wordCount: c.wordCount ?? null,
          unitCount: 1,
          clientRate: numOrNull(c.clientRate),
          fixedAmount: numOrNull(c.fixedAmount),
          sourceLineId: producer!.id,
        })
        .returning();
      consumerLines.push(line!);
    }

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.copies_fanned",
      entity: "work_item",
      entityId: workItemId,
      detail: { producerLineId: producer!.id, copies: dto.consumers.length },
    });
    return { producerLineId: producer!.id, consumerLineIds: consumerLines.map((l) => l.id) };
  }
}
