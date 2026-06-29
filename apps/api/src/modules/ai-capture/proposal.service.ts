import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { schema, type Db } from "@business-os/db";
import type { AiProposalTarget, SessionPrincipal } from "@business-os/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { CreatePartyDto } from "../refdata/dto.js";
import { PartyService } from "../refdata/party.service.js";
import { CreateWorkItemDto } from "../work/dto.js";
import { WorkService } from "../work/work.service.js";
import { RecordPaymentDto } from "../billing/dto.js";
import { PaymentService } from "../billing/payment.service.js";
import { CreateExpenseDto } from "../expense/dto.js";
import { ExpenseService } from "../expense/expense.service.js";

/** Each target: the permission Accept requires + the entity name recorded. */
const TARGET_PERMISSION: Record<AiProposalTarget, string> = {
  client: "reference:create",
  job: "work:create",
  payment: "billing:create",
  expense: "expenses:create",
};
const TARGET_ENTITY: Record<AiProposalTarget, string> = {
  client: "party",
  job: "work_item",
  payment: "payment",
  expense: "expense",
};

/** Validate a plain object against a DTO class (reusing the real create rules). */
async function asDto<T extends object>(cls: new () => T, obj: unknown): Promise<T> {
  const instance = plainToInstance(cls, obj ?? {});
  const errors = await validate(instance as object, { whitelist: true });
  if (errors.length > 0) {
    const msgs = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new BadRequestException(msgs.length ? msgs : "Invalid proposal fields");
  }
  return instance;
}

/**
 * Review actions on AI proposals (the governance "confirm" step, §2). Accept is
 * the ONLY path that creates a domain record: it validates the (edited) fields
 * against the real create DTO, requires the SAME permission a manual create needs
 * (no escalation), then routes through the existing create service stamped with
 * the `ai_capture_id` provenance marker. Reject/edit never create anything.
 */
@Injectable()
export class ProposalService {
  constructor(
    private readonly parties: PartyService,
    private readonly work: WorkService,
    private readonly payments: PaymentService,
    private readonly expenses: ExpenseService,
    private readonly audit: AuditService,
  ) {}

  private async load(tx: Db, id: string) {
    const [p] = await tx.select().from(schema.aiProposal).where(eq(schema.aiProposal.id, id));
    if (!p) throw new NotFoundException("Proposal not found");
    return p;
  }

  async edit(tx: Db, principal: SessionPrincipal, id: string, fields: Record<string, unknown>) {
    const p = await this.load(tx, id);
    if (p.status !== "pending") throw new BadRequestException("Only a pending proposal can be edited");
    const merged = { ...(p.proposedJson as Record<string, unknown>), ...fields };
    const [row] = await tx
      .update(schema.aiProposal)
      .set({ proposedJson: merged })
      .where(eq(schema.aiProposal.id, id))
      .returning();
    return row!;
  }

  async reject(tx: Db, principal: SessionPrincipal, id: string) {
    const p = await this.load(tx, id);
    if (p.status !== "pending") throw new BadRequestException("Only a pending proposal can be rejected");
    await tx
      .update(schema.aiProposal)
      .set({ status: "rejected", reviewedBy: principal.userId, reviewedAt: new Date() })
      .where(eq(schema.aiProposal.id, id));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "ai_capture.proposal_rejected",
      entity: "ai_proposal",
      entityId: id,
    });
    return { ok: true };
  }

  /** Accept: validate → permission-gate → create via the existing service (AI-stamped). */
  async accept(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, id: string) {
    const p = await this.load(tx, id);
    if (p.status !== "pending") throw new BadRequestException("Only a pending proposal can be accepted");
    const target = p.targetType as AiProposalTarget;

    // No escalation: Accept requires the same permission a manual create needs.
    const need = TARGET_PERMISSION[target];
    if (!principal.isSystemSuperadmin && !perms.perms.has(need)) {
      throw new ForbiddenException(`Accepting a ${target} requires ${need}`);
    }

    const fields = p.proposedJson as Record<string, unknown>;
    const opts = { aiCaptureId: p.captureId };
    let createdId: string;
    if (target === "client") {
      const dto = await asDto(CreatePartyDto, fields);
      const row = await this.parties.create(tx, principal, dto, opts);
      createdId = (row as { id: string }).id;
    } else if (target === "job") {
      const dto = await asDto(CreateWorkItemDto, fields);
      const row = await this.work.create(tx, principal, dto, opts);
      createdId = (row as { id: string }).id;
    } else if (target === "payment") {
      const dto = await asDto(RecordPaymentDto, fields);
      const row = await this.payments.recordPayment(tx, principal, dto, opts);
      createdId = (row as { id: string }).id;
    } else if (target === "expense") {
      const dto = await asDto(CreateExpenseDto, fields);
      const row = await this.expenses.create(tx, principal, dto, opts);
      createdId = (row as { id: string }).id;
    } else {
      throw new BadRequestException(`Unknown target type ${target}`);
    }

    await tx
      .update(schema.aiProposal)
      .set({
        status: "accepted",
        createdEntityType: TARGET_ENTITY[target],
        createdEntityId: createdId,
        reviewedBy: principal.userId,
        reviewedAt: new Date(),
      })
      .where(eq(schema.aiProposal.id, id));

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "ai_capture.proposal_accepted",
      entity: TARGET_ENTITY[target],
      entityId: createdId,
      detail: { proposalId: id, targetType: target, aiCaptureId: p.captureId },
    });

    return { ok: true, targetType: target, createdEntityType: TARGET_ENTITY[target], createdEntityId: createdId };
  }
}
