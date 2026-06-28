import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import {
  creditBalance,
  deriveCheckPnl,
  resolveCompRule,
  type CompRuleLike,
  type SessionPrincipal,
} from "@business-os/shared";
import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import type {
  AddCheckFileDto,
  CreateChannelDto,
  CreateToolAccountDto,
  ListBatchesQueryDto,
  PnlQueryDto,
  RecordBatchDto,
  TopupDto,
  UpdateBatchDto,
  UpdateChannelDto,
} from "./dto.js";

/**
 * The AI/plagiarism check service (§8) — a self-contained mini-business. The
 * batch tally (per employee×account×day) is the capture; claim→confirm is the
 * governance (only confirmed batches hit the P&L + consume credits); the P&L is
 * DERIVED (revenue − allocated account cost − worker comp). A worker sees only
 * their own channels' batches; admins (checks:approve) see all + the P&L.
 */
@Injectable()
export class ChecksService {
  constructor(private readonly audit: AuditService) {}

  private canSeeAll(principal: SessionPrincipal, perms: EffectivePermissions): boolean {
    return principal.isSystemSuperadmin || perms.perms.has("checks:approve");
  }

  // ── channels ──
  async createChannel(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, dto: CreateChannelDto) {
    const employeePartyId = dto.employeePartyId ?? principal.partyId;
    if (!employeePartyId) throw new BadRequestException("An employee party is required");
    // A non-admin may only register a channel for themselves.
    if (!this.canSeeAll(principal, perms) && employeePartyId !== principal.partyId) {
      throw new ForbiddenException("You can only register your own channel");
    }
    const [row] = await tx
      .insert(schema.checkChannel)
      .values({ orgId: principal.orgId, label: dto.label.trim(), employeePartyId, createdBy: principal.userId, updatedBy: principal.userId })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.channel_created",
      entity: "check_channel",
      entityId: row!.id,
      detail: { label: row!.label, employeePartyId },
    });
    return row!;
  }

  listChannels(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions) {
    const conds = [isNull(schema.checkChannel.archivedAt)];
    if (!this.canSeeAll(principal, perms)) {
      if (!principal.partyId) return Promise.resolve([]);
      conds.push(eq(schema.checkChannel.employeePartyId, principal.partyId));
    }
    return tx.select().from(schema.checkChannel).where(and(...conds)).orderBy(asc(schema.checkChannel.label));
  }

  async updateChannel(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, id: string, dto: UpdateChannelDto) {
    const [ch] = await tx.select().from(schema.checkChannel).where(eq(schema.checkChannel.id, id));
    if (!ch) throw new NotFoundException("Channel not found");
    if (!this.canSeeAll(principal, perms) && ch.employeePartyId !== principal.partyId) {
      throw new ForbiddenException("You can only edit your own channel");
    }
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.label !== undefined) patch.label = dto.label.trim();
    if (dto.employeePartyId !== undefined && this.canSeeAll(principal, perms)) patch.employeePartyId = dto.employeePartyId;
    if (dto.archived === true) patch.archivedAt = new Date();
    const [row] = await tx.update(schema.checkChannel).set(patch).where(eq(schema.checkChannel.id, id)).returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.channel_updated",
      entity: "check_channel",
      entityId: id,
    });
    return row!;
  }

  // ── tool accounts + top-ups (admin) ──
  async createToolAccount(tx: Db, principal: SessionPrincipal, dto: CreateToolAccountDto) {
    const [row] = await tx
      .insert(schema.checkToolAccount)
      .values({ orgId: principal.orgId, label: dto.label.trim(), vaultItemId: dto.vaultItemId ?? null, createdBy: principal.userId, updatedBy: principal.userId })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.tool_account_created",
      entity: "check_tool_account",
      entityId: row!.id,
      detail: { label: row!.label },
    });
    return row!;
  }

  /** List tool accounts. Workers get id/label (to pick one when recording);
   *  the DERIVED credit balance + cost is admin-only (it's P&L-adjacent). */
  async listToolAccounts(tx: Db, includeCredit: boolean) {
    const accounts = await tx
      .select()
      .from(schema.checkToolAccount)
      .where(isNull(schema.checkToolAccount.archivedAt))
      .orderBy(asc(schema.checkToolAccount.label));
    if (!includeCredit) {
      return accounts.map((a) => ({ id: a.id, label: a.label, vaultItemId: a.vaultItemId, active: a.active }));
    }
    const topups = await tx.select().from(schema.checkCreditTopup);
    // consumed credits = Σ confirmed files_checked on that account (1 file = 1 credit).
    const confirmed = await tx
      .select({ toolAccountId: schema.checkBatch.toolAccountId, filesChecked: schema.checkBatch.filesChecked })
      .from(schema.checkBatch)
      .where(eq(schema.checkBatch.status, "confirmed"));
    return accounts.map((a) => {
      const accTopups = topups.filter((t) => t.toolAccountId === a.id);
      const consumed = confirmed.filter((b) => b.toolAccountId === a.id).reduce((s, b) => s + (b.filesChecked ?? 0), 0);
      return { ...a, credit: creditBalance(accTopups, consumed) };
    });
  }

  async topup(tx: Db, principal: SessionPrincipal, toolAccountId: string, dto: TopupDto) {
    const [acc] = await tx.select({ id: schema.checkToolAccount.id }).from(schema.checkToolAccount).where(eq(schema.checkToolAccount.id, toolAccountId));
    if (!acc) throw new NotFoundException("Tool account not found");
    const [row] = await tx
      .insert(schema.checkCreditTopup)
      .values({ orgId: principal.orgId, toolAccountId, credits: String(dto.credits), cost: String(dto.cost), purchasedAt: dto.purchasedAt.slice(0, 10), note: dto.note ?? null, createdBy: principal.userId })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.credit_topup",
      entity: "check_tool_account",
      entityId: toolAccountId,
      detail: { credits: dto.credits, cost: dto.cost },
    });
    return row!;
  }

  // ── batches (the tally; governance) ──
  private async loadChannel(tx: Db, id: string) {
    const [ch] = await tx.select().from(schema.checkChannel).where(eq(schema.checkChannel.id, id));
    if (!ch) throw new NotFoundException("Channel not found");
    return ch;
  }

  async recordBatch(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, dto: RecordBatchDto) {
    const channel = await this.loadChannel(tx, dto.channelId);
    // A non-admin may only record on a channel they run.
    if (!this.canSeeAll(principal, perms) && channel.employeePartyId !== principal.partyId) {
      throw new ForbiddenException("You can only record batches on your own channel");
    }
    const [row] = await tx
      .insert(schema.checkBatch)
      .values({
        orgId: principal.orgId,
        channelId: dto.channelId,
        toolAccountId: dto.toolAccountId ?? null,
        periodDate: dto.periodDate.slice(0, 10),
        filesChecked: dto.filesChecked,
        filesPaid: dto.filesPaid,
        amountCollected: String(dto.amountCollected),
        customerPartyId: dto.customerPartyId ?? null,
        workItemId: dto.workItemId ?? null,
        status: "proposed",
        note: dto.note ?? null,
        recordedBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.batch_recorded",
      entity: "check_batch",
      entityId: row!.id,
      detail: { channelId: dto.channelId, filesChecked: dto.filesChecked, amountCollected: dto.amountCollected },
    });
    return row!;
  }

  private async loadBatch(tx: Db, id: string) {
    const [b] = await tx.select().from(schema.checkBatch).where(eq(schema.checkBatch.id, id));
    if (!b) throw new NotFoundException("Batch not found");
    return b;
  }

  async updateBatch(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, id: string, dto: UpdateBatchDto) {
    const batch = await this.loadBatch(tx, id);
    const channel = await this.loadChannel(tx, batch.channelId);
    const admin = this.canSeeAll(principal, perms);
    if (!admin && channel.employeePartyId !== principal.partyId) throw new ForbiddenException("Not your batch");
    // A confirmed tally is a settled fact (it fed the P&L + consumed credits) —
    // immutable. Corrections are a fresh batch, not an in-place edit (§3.4 ethos).
    if (batch.status === "confirmed") {
      throw new ConflictException("A confirmed batch is immutable — record a correcting batch instead");
    }
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.toolAccountId !== undefined) patch.toolAccountId = dto.toolAccountId;
    if (dto.periodDate !== undefined) patch.periodDate = dto.periodDate.slice(0, 10);
    if (dto.filesChecked !== undefined) patch.filesChecked = dto.filesChecked;
    if (dto.filesPaid !== undefined) patch.filesPaid = dto.filesPaid;
    if (dto.amountCollected !== undefined) patch.amountCollected = String(dto.amountCollected);
    if (dto.customerPartyId !== undefined) patch.customerPartyId = dto.customerPartyId;
    if (dto.workItemId !== undefined) patch.workItemId = dto.workItemId;
    if (dto.note !== undefined) patch.note = dto.note;
    const [row] = await tx.update(schema.checkBatch).set(patch).where(eq(schema.checkBatch.id, id)).returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.batch_updated",
      entity: "check_batch",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return row!;
  }

  /** Confirm a claimed tally — governance: only an approver, never the recorder. */
  async confirmBatch(tx: Db, principal: SessionPrincipal, id: string) {
    const batch = await this.loadBatch(tx, id);
    if (batch.status === "confirmed") throw new ConflictException("Batch is already confirmed");
    if (batch.recordedBy && batch.recordedBy === principal.userId) {
      throw new ForbiddenException("You cannot confirm a tally you recorded");
    }
    const [row] = await tx
      .update(schema.checkBatch)
      .set({ status: "confirmed", confirmedBy: principal.userId, confirmedAt: new Date(), updatedBy: principal.userId, updatedAt: new Date() })
      .where(eq(schema.checkBatch.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.batch_confirmed",
      entity: "check_batch",
      entityId: id,
    });
    return row!;
  }

  async listBatches(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, q: ListBatchesQueryDto) {
    const conds = [isNull(schema.checkBatch.archivedAt)];
    if (q.from) conds.push(gte(schema.checkBatch.periodDate, q.from.slice(0, 10)));
    if (q.to) conds.push(lte(schema.checkBatch.periodDate, q.to.slice(0, 10)));
    if (q.channelId) conds.push(eq(schema.checkBatch.channelId, q.channelId));
    if (q.status) conds.push(eq(schema.checkBatch.status, q.status));
    if (!this.canSeeAll(principal, perms)) {
      if (!principal.partyId) return [];
      conds.push(eq(schema.checkChannel.employeePartyId, principal.partyId));
    }
    return tx
      .select({
        id: schema.checkBatch.id,
        channelId: schema.checkBatch.channelId,
        channelLabel: schema.checkChannel.label,
        toolAccountId: schema.checkBatch.toolAccountId,
        periodDate: schema.checkBatch.periodDate,
        filesChecked: schema.checkBatch.filesChecked,
        filesPaid: schema.checkBatch.filesPaid,
        amountCollected: schema.checkBatch.amountCollected,
        customerPartyId: schema.checkBatch.customerPartyId,
        workItemId: schema.checkBatch.workItemId,
        status: schema.checkBatch.status,
        note: schema.checkBatch.note,
        recordedBy: schema.checkBatch.recordedBy,
        confirmedBy: schema.checkBatch.confirmedBy,
      })
      .from(schema.checkBatch)
      .innerJoin(schema.checkChannel, eq(schema.checkBatch.channelId, schema.checkChannel.id))
      .where(and(...conds))
      .orderBy(desc(schema.checkBatch.periodDate))
      .limit(500);
  }

  async getBatch(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, id: string) {
    const batch = await this.loadBatch(tx, id);
    const channel = await this.loadChannel(tx, batch.channelId);
    if (!this.canSeeAll(principal, perms) && channel.employeePartyId !== principal.partyId) {
      throw new ForbiddenException("Not your batch");
    }
    const files = await tx.select().from(schema.checkFile).where(eq(schema.checkFile.batchId, id));
    return { batch, files };
  }

  // ── per-file detail ──
  private async assertBatchEditable(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, batchId: string) {
    const batch = await this.loadBatch(tx, batchId);
    const channel = await this.loadChannel(tx, batch.channelId);
    const admin = this.canSeeAll(principal, perms);
    if (!admin && channel.employeePartyId !== principal.partyId) throw new ForbiddenException("Not your batch");
    // Don't let a worker alter the per-file evidence of a confirmed (settled) batch.
    if (!admin && batch.status === "confirmed") {
      throw new ForbiddenException("A confirmed batch can't be changed");
    }
    return batch;
  }

  async addCheckFile(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, batchId: string, dto: AddCheckFileDto) {
    await this.assertBatchEditable(tx, principal, perms, batchId);
    const [row] = await tx
      .insert(schema.checkFile)
      .values({
        orgId: principal.orgId,
        batchId,
        fileObjectId: dto.fileObjectId ?? null,
        customerRef: dto.customerRef ?? null,
        aiScore: dto.aiScore != null ? String(dto.aiScore) : null,
        plagiarismScore: dto.plagiarismScore != null ? String(dto.plagiarismScore) : null,
        note: dto.note ?? null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.file_added",
      entity: "check_batch",
      entityId: batchId,
      detail: { checkFileId: row!.id },
    });
    return row!;
  }

  async listCheckFiles(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, batchId: string) {
    await this.assertBatchEditable(tx, principal, perms, batchId);
    return tx.select().from(schema.checkFile).where(eq(schema.checkFile.batchId, batchId));
  }

  async removeCheckFile(tx: Db, principal: SessionPrincipal, perms: EffectivePermissions, fileId: string) {
    const [f] = await tx.select().from(schema.checkFile).where(eq(schema.checkFile.id, fileId));
    if (!f) throw new NotFoundException("Check file not found");
    await this.assertBatchEditable(tx, principal, perms, f.batchId);
    await tx.delete(schema.checkFile).where(eq(schema.checkFile.id, fileId));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "checks.file_removed",
      entity: "check_batch",
      entityId: f.batchId,
      detail: { checkFileId: fileId },
    });
    return { ok: true };
  }

  /** The unit's standalone P&L (confirmed batches only) — derived, never stored. */
  async getPnl(tx: Db, q: PnlQueryDto) {
    const conds = [eq(schema.checkBatch.status, "confirmed"), isNull(schema.checkBatch.archivedAt)];
    if (q.from) conds.push(gte(schema.checkBatch.periodDate, q.from.slice(0, 10)));
    if (q.to) conds.push(lte(schema.checkBatch.periodDate, q.to.slice(0, 10)));
    const batches = await tx
      .select({
        channelId: schema.checkBatch.channelId,
        toolAccountId: schema.checkBatch.toolAccountId,
        periodDate: schema.checkBatch.periodDate,
        filesChecked: schema.checkBatch.filesChecked,
        filesPaid: schema.checkBatch.filesPaid,
        amountCollected: schema.checkBatch.amountCollected,
      })
      .from(schema.checkBatch)
      .where(and(...conds));

    let revenue = 0;
    let filesChecked = 0;
    let filesPaid = 0;
    const checkedByAccount = new Map<string, number>();
    for (const b of batches) {
      revenue += Number(b.amountCollected) || 0;
      filesChecked += b.filesChecked ?? 0;
      filesPaid += b.filesPaid ?? 0;
      if (b.toolAccountId) checkedByAccount.set(b.toolAccountId, (checkedByAccount.get(b.toolAccountId) ?? 0) + (b.filesChecked ?? 0));
    }

    // accountCost = Σ per account (confirmed files_checked × that account's cost-per-
    // credit). Use the UNROUNDED ratio per account and round the total once, so the
    // per-credit rounding doesn't drift at volume.
    let accountCost = 0;
    if (checkedByAccount.size > 0) {
      const topups = await tx
        .select({ toolAccountId: schema.checkCreditTopup.toolAccountId, credits: schema.checkCreditTopup.credits, cost: schema.checkCreditTopup.cost })
        .from(schema.checkCreditTopup)
        .where(inArray(schema.checkCreditTopup.toolAccountId, [...checkedByAccount.keys()]));
      for (const [accId, checked] of checkedByAccount) {
        const t = topups.filter((x) => x.toolAccountId === accId);
        const credits = t.reduce((s, x) => s + (Number(x.credits) || 0), 0);
        const cost = t.reduce((s, x) => s + (Number(x.cost) || 0), 0);
        const cpc = credits > 0 ? cost / credits : 0; // unrounded
        accountCost += checked * cpc;
      }
    }

    // workerComp = Σ over batches (files_checked × the channel-employee's per-file comp rate, as-of the batch date).
    let workerComp = 0;
    let unpricedBatches = 0; // batches with files but no resolvable per-file comp rule
    const channelIds = [...new Set(batches.map((b) => b.channelId))];
    if (channelIds.length > 0) {
      const channels = await tx
        .select({ id: schema.checkChannel.id, employeePartyId: schema.checkChannel.employeePartyId })
        .from(schema.checkChannel)
        .where(inArray(schema.checkChannel.id, channelIds));
      const empByChannel = new Map(channels.map((c) => [c.id, c.employeePartyId]));
      const employeeIds = [...new Set(channels.map((c) => c.employeePartyId))];
      const compRules = employeeIds.length
        ? ((await tx
            .select()
            .from(schema.compRule)
            .where(inArray(schema.compRule.partyId, employeeIds))) as unknown as CompRuleLike[])
        : [];
      for (const b of batches) {
        const employee = empByChannel.get(b.channelId);
        if (!employee) continue;
        const rule = resolveCompRule(compRules, { partyId: employee, basis: "per_file", asOf: b.periodDate });
        if (rule?.rate != null) workerComp += (b.filesChecked ?? 0) * Number(rule.rate);
        else if ((b.filesChecked ?? 0) > 0) unpricedBatches += 1;
      }
    }

    // unpricedBatches flags worker comp that couldn't be costed (no per-file rule)
    // so the net isn't silently overstated.
    return { ...deriveCheckPnl({ revenue, filesChecked, filesPaid, accountCost, workerComp }), unpricedBatches };
  }
}
