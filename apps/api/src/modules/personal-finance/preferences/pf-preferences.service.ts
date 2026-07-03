import { Injectable } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { eq } from "drizzle-orm";
import { isModuleEnabled } from "../../../feature-flags.js";
import { PfAuditService } from "../pf-audit.service.js";
import type { UpdatePfPreferencesDto } from "./pf-preferences.dto.js";

export type PfPreferencesRow = typeof schema.pfPreferences.$inferSelect;

/**
 * Per-account PF settings (0035). "Sensible defaults, few visible settings" — a row
 * is created lazily with defaults the first time it's read, so every account
 * (existing or new) always has one without a backfill. base/default currency lives
 * on pf_account.base_currency (not duplicated here) and is edited through here too.
 */
@Injectable()
export class PfPreferencesService {
  constructor(private readonly audit: PfAuditService) {}

  /** Read-or-create-defaults. Returns the prefs row + baseCurrency + AI availability. */
  async get(tx: Db, pfAccountId: string): Promise<PfPreferencesRow & { baseCurrency: string; aiAvailable: boolean }> {
    const prefs = await this.ensure(tx, pfAccountId);
    const [acct] = await tx
      .select({ baseCurrency: schema.pfAccount.baseCurrency })
      .from(schema.pfAccount)
      .where(eq(schema.pfAccount.id, pfAccountId));
    return { ...prefs, baseCurrency: acct?.baseCurrency ?? "BDT", aiAvailable: isModuleEnabled("ai_capture") };
  }

  /** The raw prefs row (used by insights/anomaly/reminder services). */
  async ensure(tx: Db, pfAccountId: string): Promise<PfPreferencesRow> {
    const [existing] = await tx.select().from(schema.pfPreferences).where(eq(schema.pfPreferences.pfAccountId, pfAccountId));
    if (existing) return existing;
    // Insert defaults; tolerate a concurrent create via the unique index.
    const [created] = await tx
      .insert(schema.pfPreferences)
      .values({ pfAccountId })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [row] = await tx.select().from(schema.pfPreferences).where(eq(schema.pfPreferences.pfAccountId, pfAccountId));
    return row!;
  }

  async update(tx: Db, pfAccountId: string, dto: UpdatePfPreferencesDto): Promise<PfPreferencesRow & { baseCurrency: string; aiAvailable: boolean }> {
    await this.ensure(tx, pfAccountId);
    const patch: Partial<typeof schema.pfPreferences.$inferInsert> = { updatedAt: new Date() };
    if (dto.rollupPeriod !== undefined) patch.rollupPeriod = dto.rollupPeriod;
    if (dto.rollupCustomDays !== undefined) patch.rollupCustomDays = dto.rollupCustomDays;
    if (dto.subscriptionLeadDays !== undefined) patch.subscriptionLeadDays = dto.subscriptionLeadDays;
    if (dto.reminderSubscriptions !== undefined) patch.reminderSubscriptions = dto.reminderSubscriptions;
    if (dto.reminderNotes !== undefined) patch.reminderNotes = dto.reminderNotes;
    if (dto.anomalyEnabled !== undefined) patch.anomalyEnabled = dto.anomalyEnabled;
    if (dto.anomalyThresholdPct !== undefined) patch.anomalyThresholdPct = dto.anomalyThresholdPct;
    if (dto.activeCurrencies !== undefined) patch.activeCurrencies = dto.activeCurrencies.map((c) => c.toUpperCase());
    if (dto.defaultBudgetPeriod !== undefined) patch.defaultBudgetPeriod = dto.defaultBudgetPeriod;
    if (dto.aiQuickaddEnabled !== undefined) patch.aiQuickaddEnabled = dto.aiQuickaddEnabled;

    await tx.update(schema.pfPreferences).set(patch).where(eq(schema.pfPreferences.pfAccountId, pfAccountId));

    // Default/base currency lives on pf_account.
    if (dto.defaultCurrency !== undefined) {
      await tx
        .update(schema.pfAccount)
        .set({ baseCurrency: dto.defaultCurrency.toUpperCase(), updatedAt: new Date() })
        .where(eq(schema.pfAccount.id, pfAccountId));
    }
    await this.audit.record(tx, pfAccountId, { action: "pf.preferences_updated", entity: "pf_preferences", detail: { ...dto } });
    return this.get(tx, pfAccountId);
  }
}
