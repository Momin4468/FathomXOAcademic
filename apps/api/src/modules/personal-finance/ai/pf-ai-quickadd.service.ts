import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import { isModuleEnabled } from "../../../feature-flags.js";
import { AI_CAPTURE_PROVIDER, type AiCaptureProvider, type ProposedRecord } from "../../ai-capture/provider/ai-capture.port.js";
import { PfAuditService } from "../pf-audit.service.js";
import { PfPreferencesService } from "../preferences/pf-preferences.service.js";

const DAILY_CAP = Number(process.env.AI_CAPTURE_DAILY_CAP ?? 25);

export interface PfExpenseDraft {
  amount: number;
  categoryName: string | null;
  note: string | null;
  currency: string | null;
}

/**
 * PF AI quick-add (§10/§2). REUSES the shared extraction provider (dev|gemini|
 * claude) — not a second pipeline — to turn "spent 500 on groceries" into a DRAFT
 * expense the user confirms via the normal POST /pf/expense (proposals only, human
 * governance). PRIVACY: everything stays in the PF plane under withPfAccount — the
 * daily cap uses pf_ai_usage, NEVER the business ai_usage/ai_capture tables, so a
 * PF action can't leak into the business plane. Nothing is persisted here except
 * the usage counter; no domain row is written until the user confirms.
 */
@Injectable()
export class PfAiQuickAddService {
  constructor(
    @Inject(AI_CAPTURE_PROVIDER) private readonly provider: AiCaptureProvider,
    private readonly prefs: PfPreferencesService,
    private readonly audit: PfAuditService,
  ) {}

  async draft(tx: Db, pfAccountId: string, text: string): Promise<{ draft: PfExpenseDraft | null; note?: string }> {
    if (!isModuleEnabled("ai_capture")) throw new NotFoundException("AI capture is not enabled");
    const prefs = await this.prefs.ensure(tx, pfAccountId);
    if (!prefs.aiQuickaddEnabled) throw new BadRequestException("AI quick-add is turned off in settings");
    if (!text?.trim()) throw new BadRequestException("Type what you spent, e.g. 'spent 500 on groceries'");

    await this.assertUnderCap(tx, pfAccountId);
    const result = await this.provider.extract({ kind: "text", text: text.trim() });
    await this.bumpUsage(tx, pfAccountId);

    const draft = this.toExpenseDraft(result.proposals);
    await this.audit.record(tx, pfAccountId, { action: "pf.ai_quickadd", entity: "pf_expense", detail: { drafted: draft != null } });
    return {
      draft,
      note: draft ? undefined : result.note ?? "Couldn't read an amount — try like 'spent 500 on groceries'.",
    };
  }

  /** Pick the best expense-like proposal (one with a positive amount) → a PF draft. */
  private toExpenseDraft(proposals: ProposedRecord[]): PfExpenseDraft | null {
    const p = proposals.find((pp) => Number(pp.fields.amount) > 0);
    if (!p) return null;
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      amount: Number(p.fields.amount),
      categoryName: str(p.fields.category),
      note: str(p.fields.note) ?? p.label ?? null,
      currency: str(p.fields.currency),
    };
  }

  /** Per-account daily cap (TOCTOU-safe via advisory lock, mirroring CaptureService). */
  private async assertUnderCap(tx: Db, pfAccountId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pfAccountId}))`);
    const res = await tx.execute(sql`select coalesce((select count from pf_ai_usage where pf_account_id = ${pfAccountId} and day = current_date), 0)::int as c`);
    const used = Number((res.rows[0] as { c: number }).c);
    if (used >= DAILY_CAP) {
      throw new HttpException(`Daily AI quick-add limit reached (${DAILY_CAP}/day). Try again tomorrow.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async bumpUsage(tx: Db, pfAccountId: string): Promise<void> {
    await tx.execute(sql`
      insert into pf_ai_usage (pf_account_id, day, count) values (${pfAccountId}, current_date, 1)
      on conflict (pf_account_id, day) do update set count = pf_ai_usage.count + 1
    `);
  }
}
