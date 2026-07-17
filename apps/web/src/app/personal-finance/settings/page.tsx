"use client";
import { useEffect, useState } from "react";
import { usePfApi, pfApiSend, pfRevalidate } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { PF_CURRENCIES, type PfPreferences } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { PF, PfBtn, PfCard, PfCardHead, PfField, PfSelect, PfToggle, PfNote, PfLoading } from "@/components/pf-dc";

const SENSITIVITY = [
  { pct: 200, label: "Only large jumps" },
  { pct: 150, label: "Balanced" },
  { pct: 120, label: "Sensitive" },
];

export default function PfSettingsPage() {
  const { data } = usePfApi<PfPreferences>("preferences");
  const [form, setForm] = useState<PfPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [checkMsg, setCheckMsg] = useState("");

  async function checkNow() {
    setCheckMsg("Checking…");
    try {
      const r = await pfApiSend<{ raised: number }>("anomaly-notices/run", "POST");
      await pfRevalidate();
      setCheckMsg(r.raised > 0 ? `Flagged ${r.raised} — see your overview.` : "All good — nothing unusual.");
    } catch {
      setCheckMsg("Couldn't check right now.");
    }
  }

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  if (!form) {
    return (
      <PfShell>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: "0 0 12px", color: PF.onGrad }}>Settings</h1>
        <PfLoading />
      </PfShell>
    );
  }

  const set = <K extends keyof PfPreferences>(k: K, v: PfPreferences[K]) => setForm({ ...form, [k]: v });
  const toggleCurrency = (c: string) => {
    const has = form.activeCurrencies.includes(c);
    const next = has ? form.activeCurrencies.filter((x) => x !== c) : [...form.activeCurrencies, c];
    set("activeCurrencies", next.length ? next : [c]);
  };

  async function save() {
    if (!form) return;
    setBusy(true);
    setError("");
    setFieldErrs({});
    try {
      await pfApiSend("preferences", "PATCH", {
        rollupPeriod: form.rollupPeriod,
        rollupCustomDays: form.rollupCustomDays,
        subscriptionLeadDays: form.subscriptionLeadDays,
        reminderSubscriptions: form.reminderSubscriptions,
        reminderNotes: form.reminderNotes,
        anomalyEnabled: form.anomalyEnabled,
        anomalyThresholdPct: form.anomalyThresholdPct,
        activeCurrencies: form.activeCurrencies,
        defaultBudgetPeriod: form.defaultBudgetPeriod,
        aiQuickaddEnabled: form.aiQuickaddEnabled,
        defaultCurrency: form.baseCurrency,
      });
      await pfRevalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setFieldErrs(fieldErrorMap(e));
      setError(bannerMessage(e, "Could not save") ?? "");
    } finally {
      setBusy(false);
    }
  }

  const numInput: React.CSSProperties = { width: 64, border: `1px solid ${PF.border}`, borderRadius: 7, padding: "6px 8px", fontSize: 12.5, background: PF.card, color: PF.text, fontVariantNumeric: "tabular-nums" };

  return (
    <PfShell>
      <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Settings</h1>
      <p style={{ fontSize: 12, color: PF.onGradSub, margin: "4px 0 16px" }}>Everything works out of the box — tweak only what you like. Private to your account.</p>

      <div style={{ display: "grid", gap: 12 }}>
        {/* Summary period */}
        <PfCard>
          <PfCardHead>Summary period</PfCardHead>
          <p style={{ fontSize: 11, color: PF.muted, margin: "0 0 8px" }}>Groups your overview, charts and spending alerts.</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {(["week", "month", "custom"] as const).map((k) => {
              const active = form.rollupPeriod === k;
              return (
                <span key={k} onClick={() => set("rollupPeriod", k)} style={{ fontSize: 12, fontWeight: 600, padding: "6px 13px", borderRadius: 999, cursor: "pointer", textTransform: "capitalize", background: active ? PF.accent : "transparent", color: active ? PF.onGrad : PF.muted, border: `1px solid ${active ? PF.accent : PF.border}` }}>{k}</span>
              );
            })}
            {form.rollupPeriod === "custom" && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: PF.muted }}>
                every
                <input type="number" min={1} max={366} value={form.rollupCustomDays} onChange={(e) => set("rollupCustomDays", Math.max(1, Math.min(366, Number(e.target.value) || 30)))} style={numInput} />
                days
              </label>
            )}
          </div>
        </PfCard>

        {/* Currencies */}
        <PfCard>
          <PfCardHead>Currencies</PfCardHead>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <PfField label="Default currency" hint="Used for your totals & charts." error={fieldErrs.defaultCurrency}>
              <PfSelect value={form.baseCurrency} onChange={(e) => set("baseCurrency", e.target.value)}>
                {Array.from(new Set([form.baseCurrency, ...PF_CURRENCIES])).map((c) => (<option key={c} value={c}>{c}</option>))}
              </PfSelect>
            </PfField>
            <PfField label="Show in pickers" hint="Which currencies appear when adding money." error={fieldErrs.activeCurrencies}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 2 }}>
                {PF_CURRENCIES.map((c) => {
                  const on = form.activeCurrencies.includes(c);
                  return (
                    <button key={c} type="button" onClick={() => toggleCurrency(c)} style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer", background: on ? "#E9F6F2" : PF.card, color: on ? PF.accentDeep : PF.muted, border: `1px solid ${on ? PF.greenBorder : PF.border}` }}>{c}</button>
                  );
                })}
              </div>
            </PfField>
          </div>
        </PfCard>

        {/* Budgets */}
        <PfCard>
          <PfCardHead>Budgets</PfCardHead>
          <PfField label="Default budget period" error={fieldErrs.defaultBudgetPeriod}>
            <PfSelect value={form.defaultBudgetPeriod} onChange={(e) => set("defaultBudgetPeriod", e.target.value as "month" | "year")} style={{ maxWidth: 200 }}>
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </PfSelect>
          </PfField>
        </PfCard>

        {/* Reminders */}
        <PfCard>
          <PfCardHead>Reminders</PfCardHead>
          <div style={{ display: "grid", gap: 12 }}>
            <PfToggle label="Subscription reminders" desc="Email before a subscription is due." on={form.reminderSubscriptions} onChange={(v) => set("reminderSubscriptions", v)} />
            {form.reminderSubscriptions && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: PF.text2, marginLeft: 4 }}>
                Remind
                <input type="number" min={0} max={30} value={form.subscriptionLeadDays} onChange={(e) => set("subscriptionLeadDays", Math.max(0, Math.min(30, Number(e.target.value) || 0)))} style={numInput} />
                days before
              </label>
            )}
            <PfToggle label="Note reminders" desc="Email a note on its remind-on date." on={form.reminderNotes} onChange={(v) => set("reminderNotes", v)} />
          </div>
        </PfCard>

        {/* Spending alerts */}
        <PfCard>
          <PfCardHead>Spending alerts</PfCardHead>
          <PfToggle label="Gentle anomaly alerts" desc="A friendly heads-up when a period or category runs above your recent average." on={form.anomalyEnabled} onChange={(v) => set("anomalyEnabled", v)} />
          {form.anomalyEnabled && (
            <div style={{ marginTop: 12 }}>
              <PfField label="Sensitivity" hint="How far above your average before we mention it." error={fieldErrs.anomalyThresholdPct}>
                <PfSelect value={String(form.anomalyThresholdPct)} onChange={(e) => set("anomalyThresholdPct", Number(e.target.value))} style={{ maxWidth: 220 }}>
                  {SENSITIVITY.map((s) => (<option key={s.pct} value={s.pct}>{s.label}</option>))}
                </PfSelect>
              </PfField>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                <PfBtn variant="secondary" onClick={checkNow}>Check now</PfBtn>
                {checkMsg && <span style={{ fontSize: 11, color: PF.muted }}>{checkMsg}</span>}
              </div>
            </div>
          )}
        </PfCard>

        {/* AI quick-add */}
        {form.aiAvailable && (
          <PfCard>
            <PfCardHead>AI quick-add</PfCardHead>
            <PfToggle label="Type-to-add with AI" desc={`Turn "spent 500 on groceries" into a draft you confirm. Nothing is saved without your OK.`} on={form.aiQuickaddEnabled} onChange={(v) => set("aiQuickaddEnabled", v)} />
          </PfCard>
        )}
      </div>

      {error && <div style={{ marginTop: 16 }}><PfNote tone="red">{error}</PfNote></div>}

      <div style={{ position: "sticky", bottom: 0, marginTop: 16, marginLeft: -16, marginRight: -16, borderTop: `1px solid ${PF.grad2}`, background: PF.grad1, padding: "12px 16px calc(12px + env(safe-area-inset-bottom))" }}>
        <button type="button" disabled={busy} onClick={save} style={{ width: "100%", background: PF.accent, color: PF.onGrad, fontWeight: 700, fontSize: 13, padding: "10px 0", borderRadius: 8, border: "none", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
        </button>
      </div>
    </PfShell>
  );
}
