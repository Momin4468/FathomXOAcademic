import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { desc, eq } from "drizzle-orm";
import type { SessionPrincipal } from "@business-os/shared";
import { AuditService } from "../../common/audit/audit.service.js";
import { FilesService } from "../files/files.service.js";
import { AI_CAPTURE_PROVIDER, type AiCaptureProvider, type CaptureInput } from "./provider/ai-capture.port.js";
import type { CaptureDto } from "./dto.js";

const DAILY_CAP = Number(process.env.AI_CAPTURE_DAILY_CAP ?? 25);

/** Drain a Node Readable into a Buffer. */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    chunks.push(typeof c === "string" ? Buffer.from(c) : Buffer.from(c as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * AI capture (DESIGN_SPEC §10). Runs the swappable provider to EXTRACT proposals
 * from unstructured input and persists them as `ai_proposal` rows — it writes NO
 * domain record (that only happens on human Accept, in ProposalService). Enforces
 * the per-user daily cap BEFORE calling the provider to bound paid-provider cost.
 */
@Injectable()
export class CaptureService {
  constructor(
    @Inject(AI_CAPTURE_PROVIDER) private readonly provider: AiCaptureProvider,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private async assertUnderCap(tx: Db, principal: SessionPrincipal): Promise<void> {
    // Serialize a user's concurrent captures so the count→insert can't race past
    // the cap (TOCTOU), mirroring the payment-allocation advisory lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${principal.userId}))`);
    // The cap is per (user, org, day) — the org filter is explicit (not just
    // RLS-implicit), so each tenant's AI spend is bounded independently.
    const res = await tx.execute(sql`
      select count(*)::int as c from ai_usage
      where user_id = ${principal.userId}
        and org_id = ${principal.orgId}
        and used_on = current_date
    `);
    const used = Number((res.rows[0] as { c: number }).c);
    if (used >= DAILY_CAP) {
      throw new HttpException(
        `Daily AI capture limit reached (${DAILY_CAP}/day). Try again tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async capture(tx: Db, principal: SessionPrincipal, dto: CaptureDto) {
    if (!dto.text?.trim() && !dto.fileObjectId) {
      throw new BadRequestException("Provide text or a fileObjectId");
    }
    await this.assertUnderCap(tx, principal);

    // Resolve the provider input (media bytes via the file pipeline, ACL-checked).
    const input: CaptureInput = { kind: dto.kind, text: dto.text?.trim() || undefined };
    if (dto.fileObjectId) {
      const f = await this.files.openForDownload(tx, principal, dto.fileObjectId);
      if (f.isLink) throw new BadRequestException("Linked files can't be analysed — upload the file itself");
      input.media = { buffer: await streamToBuffer(f.stream), mime: f.mime };
    }

    const [cap] = await tx
      .insert(schema.aiCapture)
      .values({
        orgId: principal.orgId,
        kind: dto.kind,
        inputText: dto.text?.trim() || null,
        fileObjectId: dto.fileObjectId ?? null,
        provider: this.provider.name,
        status: "processing",
        createdBy: principal.userId,
      })
      .returning();

    // Extract — PROPOSALS ONLY. The provider never writes a domain record.
    const result = await this.provider.extract(input);

    if (result.proposals.length > 0) {
      await tx.insert(schema.aiProposal).values(
        result.proposals.map((p) => ({
          orgId: principal.orgId,
          captureId: cap!.id,
          targetType: p.targetType,
          proposedJson: p.fields,
          confidence: p.confidence != null ? String(p.confidence) : null,
          label: p.label,
          status: "pending" as const,
        })),
      );
    }

    // Count usage (the cap ledger) — append-only.
    await tx.insert(schema.aiUsage).values({
      orgId: principal.orgId,
      userId: principal.userId,
      provider: this.provider.name,
      tokens: result.tokens ?? 0,
      captureId: cap!.id,
    });

    await tx
      .update(schema.aiCapture)
      .set({ status: "proposed", model: result.model, usageTokens: result.tokens ?? 0, updatedAt: new Date() })
      .where(eq(schema.aiCapture.id, cap!.id));

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "ai_capture.extracted",
      entity: "ai_capture",
      entityId: cap!.id,
      detail: { kind: dto.kind, provider: this.provider.name, proposals: result.proposals.length },
    });

    return this.getById(tx, cap!.id, result.note);
  }

  async getById(tx: Db, id: string, note?: string) {
    const [cap] = await tx.select().from(schema.aiCapture).where(eq(schema.aiCapture.id, id));
    if (!cap) throw new BadRequestException("Capture not found");
    const proposals = await tx
      .select()
      .from(schema.aiProposal)
      .where(eq(schema.aiProposal.captureId, id))
      .orderBy(schema.aiProposal.createdAt);
    return { capture: cap, proposals, note };
  }

  async listRecent(tx: Db) {
    return tx.select().from(schema.aiCapture).orderBy(desc(schema.aiCapture.createdAt)).limit(50);
  }
}
