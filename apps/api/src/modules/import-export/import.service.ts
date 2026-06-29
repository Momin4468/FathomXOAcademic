import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { schema, type Db } from "@business-os/db";
import type { ImportEntity, RlsContext, SessionPrincipal } from "@business-os/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { DbService } from "../../common/db/db.service.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { ReferenceService } from "../refdata/reference.service.js";
import { PartyService } from "../refdata/party.service.js";
import { CreatePartyDto } from "../refdata/dto.js";
import { WorkService } from "../work/work.service.js";
import { CreateWorkItemDto } from "../work/dto.js";
import { PaymentService } from "../billing/payment.service.js";
import { RecordPaymentDto } from "../billing/dto.js";
import { SettlementService } from "../settlement/settlement.service.js";
import { RecordTransferDto } from "../settlement/dto.js";
import type { Row } from "./parse.js";

const CREATE_PERMISSION: Record<ImportEntity, string> = {
  clients: "reference:create",
  jobs: "work:create",
  payments: "billing:create",
  settlement_opening: "billing:create",
};

const num = (v: string | undefined): number => Number((v ?? "").replace(/,/g, ""));
const isDate = (v: string | undefined): boolean => !!v && !Number.isNaN(Date.parse(v));

async function validateDto<T extends object>(cls: new () => T, obj: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, obj ?? {}) as object, { whitelist: true });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

interface RowOutcome {
  status: "valid" | "invalid";
  errors: string[];
  resolution: Record<string, string>;
  mapped: Record<string, unknown>;
}

/**
 * Bulk import (preview → commit). Preview STAGES rows (no domain write) with
 * per-row validation + read-only reference/party resolution. Commit routes each
 * valid row through the EXISTING create service (canonical resolveOrCreate +
 * validation + RLS + an `import_batch_id` provenance stamp), per-row savepoint =
 * partial commit. The 2025 settlement opening becomes a dated transfer.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly db: DbService,
    private readonly reference: ReferenceService,
    private readonly parties: PartyService,
    private readonly work: WorkService,
    private readonly payments: PaymentService,
    private readonly settlement: SettlementService,
    private readonly audit: AuditService,
  ) {}

  // ── read-only validation + resolution (preview) ────────────────────────────
  private async previewRow(tx: Db, entity: ImportEntity, raw: Row): Promise<RowOutcome> {
    const errors: string[] = [];
    const resolution: Record<string, string> = {};
    const refNote = async (kind: "university" | "course" | "assignment_type", val: string | undefined, label: string) => {
      if (!val?.trim()) return;
      const hit = await this.reference.lookup(tx, kind, val);
      resolution[label] = hit ? `matched: ${hit.canonical}` : `will create: ${val.trim()}`;
    };
    const partyNote = async (val: string | undefined, label: string, opts: { required?: boolean; createIfMissing?: boolean }) => {
      if (!val?.trim()) { if (opts.required) errors.push(`${label} is required`); return; }
      const hit = await this.parties.findByName(tx, val);
      if (hit) resolution[label] = `matched: ${hit.displayName}`;
      else if (opts.createIfMissing) resolution[label] = `will create new client: ${val.trim()}`;
      else errors.push(`${label} "${val.trim()}" not found`);
    };

    if (entity === "clients") {
      if (!raw.displayName?.trim()) errors.push("displayName is required");
      await refNote("university", raw.universityName, "university");
      if (raw.referredByName?.trim()) await partyNote(raw.referredByName, "referredBy", { createIfMissing: false });
    } else if (entity === "jobs") {
      if (!raw.title?.trim()) errors.push("title is required");
      await partyNote(raw.clientName, "client", { required: true, createIfMissing: true });
      await refNote("course", raw.courseCode, "course");
      await refNote("assignment_type", raw.assignmentType, "assignmentType");
      if (raw.doerName?.trim()) await partyNote(raw.doerName, "doer", { createIfMissing: false });
    } else if (entity === "payments") {
      if (raw.direction !== "in" && raw.direction !== "out") errors.push("direction must be 'in' or 'out'");
      if (!(num(raw.amount) > 0)) errors.push("amount must be a positive number");
      if (!isDate(raw.paidAt)) errors.push("paidAt must be a date (YYYY-MM-DD)");
      await partyNote(raw.counterpartyName, "counterparty", { required: true, createIfMissing: true });
    } else if (entity === "settlement_opening") {
      if (!(num(raw.amount) > 0)) errors.push("amount must be a positive number");
      await partyNote(raw.fromPartyName, "fromParty", { required: true, createIfMissing: false });
      await partyNote(raw.toPartyName, "toParty", { required: true, createIfMissing: false });
      if (raw.asOfDate?.trim() && !isDate(raw.asOfDate)) errors.push("asOfDate must be a date");
      resolution.openingDate = raw.asOfDate?.trim() || "2026-01-01 (default)"; // the date that will be stored
    }
    return { status: errors.length ? "invalid" : "valid", errors, resolution, mapped: raw };
  }

  async preview(tx: Db, principal: SessionPrincipal, entity: ImportEntity, filename: string, rows: Row[]) {
    if (rows.length === 0) throw new BadRequestException("The file has no data rows");
    if (rows.length > 5000) throw new BadRequestException("Too many rows (max 5000 per import)");
    const [batch] = await tx
      .insert(schema.importBatch)
      .values({ orgId: principal.orgId, entityType: entity, filename, status: "preview", rowTotal: rows.length, createdBy: principal.userId })
      .returning();
    let valid = 0;
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i]!;
      const o = await this.previewRow(tx, entity, raw);
      if (o.status === "valid") valid++;
      await tx.insert(schema.importRow).values({
        orgId: principal.orgId,
        batchId: batch!.id,
        rowNumber: i + 1,
        rawJson: raw,
        mappedJson: o.mapped,
        status: o.status,
        errorsJson: o.errors.length ? o.errors : null,
        resolutionJson: o.resolution,
      });
    }
    await tx
      .update(schema.importBatch)
      .set({ validCount: valid, invalidCount: rows.length - valid, updatedAt: new Date() })
      .where(eq(schema.importBatch.id, batch!.id));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "import.previewed",
      entity: "import_batch",
      entityId: batch!.id,
      detail: { entity, rows: rows.length, valid },
    });
    return this.getBatch(tx, batch!.id);
  }

  async getBatch(tx: Db, id: string) {
    const [batch] = await tx.select().from(schema.importBatch).where(eq(schema.importBatch.id, id));
    if (!batch) throw new NotFoundException("Import batch not found");
    const rows = await tx.select().from(schema.importRow).where(eq(schema.importRow.batchId, id)).orderBy(schema.importRow.rowNumber);
    return { batch, rows };
  }

  // ── commit: create the valid rows through the existing services ─────────────
  private async commitRow(tx: Db, principal: SessionPrincipal, entity: ImportEntity, raw: Row, importBatchId: string): Promise<{ type: string; id: string }> {
    const opts = { importBatchId };
    if (entity === "clients") {
      const dto = {
        displayName: raw.displayName?.trim(),
        partyType: (raw.partyType?.trim() ? raw.partyType.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : ["client"]),
        externalRef: raw.externalRef?.trim() || undefined,
        universityRaw: raw.universityName?.trim() || undefined,
        programme: raw.programme?.trim() || undefined,
        contact: { email: raw.contactEmail?.trim() || undefined, phone: raw.contactPhone?.trim() || undefined },
        referredByPartyId: raw.referredByName?.trim() ? (await this.parties.findByName(tx, raw.referredByName))?.id : undefined,
      };
      const errs = await validateDto(CreatePartyDto, dto);
      if (errs.length) throw new BadRequestException(errs);
      const row = await this.parties.create(tx, principal, dto as unknown as CreatePartyDto, opts);
      return { type: "party", id: (row as { id: string }).id };
    }
    if (entity === "jobs") {
      const sourcePartyId = await this.resolvePartyOrCreate(tx, principal, raw.clientName, importBatchId);
      const courseRefId = raw.courseCode?.trim() ? (await this.reference.resolveOrCreate(tx, principal, { kind: "course", raw: raw.courseCode })).entity.id : undefined;
      const assignmentTypeRefId = raw.assignmentType?.trim() ? (await this.reference.resolveOrCreate(tx, principal, { kind: "assignment_type", raw: raw.assignmentType })).entity.id : undefined;
      const doerPartyId = raw.doerName?.trim() ? (await this.parties.findByName(tx, raw.doerName))?.id : undefined;
      const dto = { title: raw.title?.trim(), details: raw.details?.trim() || undefined, notes: raw.notes?.trim() || undefined, sourcePartyId, doerPartyId, courseRefId, assignmentTypeRefId };
      const errs = await validateDto(CreateWorkItemDto, dto);
      if (errs.length) throw new BadRequestException(errs);
      const row = await this.work.create(tx, principal, dto as unknown as CreateWorkItemDto, opts);
      return { type: "work_item", id: (row as { id: string }).id };
    }
    if (entity === "payments") {
      const counterpartyPartyId = await this.resolvePartyOrCreate(tx, principal, raw.counterpartyName, importBatchId);
      const dto = { direction: raw.direction, counterpartyPartyId, amount: num(raw.amount), paidAt: raw.paidAt, medium: raw.medium?.trim() || undefined, trxId: raw.trxId?.trim() || undefined, note: raw.note?.trim() || undefined };
      const errs = await validateDto(RecordPaymentDto, dto);
      if (errs.length) throw new BadRequestException(errs);
      const row = await this.payments.recordPayment(tx, principal, dto as unknown as RecordPaymentDto, opts);
      return { type: "payment", id: (row as { id: string }).id };
    }
    // settlement_opening
    const fromPartyId = (await this.parties.findByName(tx, raw.fromPartyName ?? ""))?.id;
    const toPartyId = (await this.parties.findByName(tx, raw.toPartyName ?? ""))?.id;
    if (!fromPartyId) throw new BadRequestException(`Partner "${raw.fromPartyName}" not found`);
    if (!toPartyId) throw new BadRequestException(`Partner "${raw.toPartyName}" not found`);
    const dto = { fromPartyId, toPartyId, amount: num(raw.amount), transferredAt: raw.asOfDate?.trim() || "2026-01-01", note: `2025 opening: ${raw.note?.trim() ?? ""}`.trim() };
    const errs = await validateDto(RecordTransferDto, dto);
    if (errs.length) throw new BadRequestException(errs);
    const row = await this.settlement.recordTransfer(tx, principal, dto as unknown as RecordTransferDto, opts);
    return { type: "settlement_transfer", id: (row as { id: string }).id };
  }

  private async resolvePartyOrCreate(tx: Db, principal: SessionPrincipal, name: string | undefined, importBatchId: string): Promise<string> {
    const hit = await this.parties.findByName(tx, name ?? "");
    if (hit) return hit.id;
    const created = await this.parties.create(tx, principal, { displayName: (name ?? "").trim(), partyType: ["client"] } as unknown as CreatePartyDto, { importBatchId });
    return (created as { id: string }).id;
  }

  async commit(ctx: RlsContext, principal: SessionPrincipal, perms: EffectivePermissions, batchId: string) {
    // Load + gate in one read tx.
    const { batch, rows } = await this.db.withTenant(ctx, async (tx) => {
      const [b] = await tx.select().from(schema.importBatch).where(eq(schema.importBatch.id, batchId));
      if (!b) throw new NotFoundException("Import batch not found");
      if (b.status !== "preview") throw new BadRequestException("This batch is not in preview state");
      const rs = await tx.select().from(schema.importRow).where(eq(schema.importRow.batchId, batchId)).orderBy(schema.importRow.rowNumber);
      return { batch: b, rows: rs };
    });
    const entity = batch.entityType as ImportEntity;
    const need = CREATE_PERMISSION[entity];
    if (!principal.isSystemSuperadmin && !perms.perms.has(need)) {
      throw new ForbiddenException(`Importing ${entity} requires ${need}`);
    }

    let committed = 0;
    let failed = 0;
    // Each row commits in its OWN transaction → partial commit (one bad row fails
    // alone; the rest still succeed) without poisoning a shared transaction.
    for (const row of rows) {
      if (row.status !== "valid") continue;
      try {
        await this.db.withTenant(ctx, async (tx) => {
          const created = await this.commitRow(tx, principal, entity, row.rawJson as Row, batchId);
          await tx
            .update(schema.importRow)
            .set({ status: "committed", createdEntityType: created.type, createdEntityId: created.id })
            .where(eq(schema.importRow.id, row.id));
        });
        committed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "commit failed";
        await this.db.withTenant(ctx, (tx) =>
          tx.update(schema.importRow).set({ status: "failed", errorsJson: [msg] }).where(eq(schema.importRow.id, row.id)),
        );
        failed++;
      }
    }
    await this.db.withTenant(ctx, async (tx) => {
      await tx
        .update(schema.importBatch)
        .set({ status: "committed", committedCount: committed, failedCount: failed, updatedAt: new Date() })
        .where(eq(schema.importBatch.id, batchId));
      await this.audit.record(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "import.committed",
        entity: "import_batch",
        entityId: batchId,
        detail: { entity, committed, failed },
      });
    });
    return this.db.withTenant(ctx, (tx) => this.getBatch(tx, batchId));
  }
}
