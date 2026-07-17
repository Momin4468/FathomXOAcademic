"use client";
import { useEffect, useState } from "react";
import { usePfApi, pfApiSend, pfRevalidate } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { PF_CURRENCIES, type PfPreferences } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Button, Card, ErrorNote, Field, Select, Spinner, cx } from "@/components/ui";

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
        <h1 className="mb-4 text-lg font-semibold tracking-tight">Settings</h1>
        <Spinner />
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

  return (
    <PfShell>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      </div>
      <p className="mb-4 text-xs text-slate-400">Everything works out of the box — tweak only what you like. Private to your account.</p>

      <div className="space-y-3">
        {/* Summary period */}
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Summary period</h2>
          <p className="mb-2 text-xs text-slate-400">Groups your overview, charts and spending alerts.</p>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-ink-800 p-0.5 text-sm">
              {(["week", "month", "custom"] as const).map((k) => (
                <button key={k} type="button" onClick={() => set("rollupPeriod", k)} className={cx("rounded-md px-3 py-1 font-medium capitalize", form.rollupPeriod === k ? "bg-ink-850 text-slate-100 shadow-sm" : "text-slate-400")}>
                  {k}
                </button>
              ))}
            </div>
            {form.rollupPeriod === "custom" && (
              <label className="flex items-center gap-1 text-xs text-slate-400">
                every
                <input type="number" min={1} max={366} value={form.rollupCustomDays} onChange={(e) => set("rollupCustomDays", Math.max(1, Math.min(366, Number(e.target.value) || 30)))} className="w-16 rounded-lg border border-ink-700 px-2 py-1 text-xs tabular-nums" />
                days
              </label>
            )}
          </div>
        </Card>

        {/* Currencies */}
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Currencies</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Default currency" hint="Used for your totals & charts." error={fieldErrs.defaultCurrency}>
              <Select value={form.baseCurrency} onChange={(e) => set("baseCurrency", e.target.value)}>
                {Array.from(new Set([form.baseCurrency, ...PF_CURRENCIES])).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Show in pickers" hint="Which currencies appear when adding money." error={fieldErrs.activeCurrencies}>
              <div className="flex flex-wrap gap-2 pt-1">
                {PF_CURRENCIES.map((c) => (
                  <button key={c} type="button" onClick={() => toggleCurrency(c)} className={cx("rounded-full border px-3 py-1 text-sm", form.activeCurrencies.includes(c) ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-ink-700 text-slate-300")}>
                    {c}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>

        {/* Budgets */}
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Budgets</h2>
          <Field label="Default budget period" error={fieldErrs.defaultBudgetPeriod}>
            <Select value={form.defaultBudgetPeriod} onChange={(e) => set("defaultBudgetPeriod", e.target.value as "month" | "year")} className="max-w-[200px]">
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </Select>
          </Field>
        </Card>

        {/* Reminders */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Reminders</h2>
          <div className="space-y-3">
            <Toggle label="Subscription reminders" desc="Email before a subscription is due." on={form.reminderSubscriptions} onChange={(v) => set("reminderSubscriptions", v)} />
            {form.reminderSubscriptions && (
              <label className="ml-1 flex items-center gap-2 text-sm text-slate-300">
                Remind
                <input type="number" min={0} max={30} value={form.subscriptionLeadDays} onChange={(e) => set("subscriptionLeadDays", Math.max(0, Math.min(30, Number(e.target.value) || 0)))} className="w-16 rounded-lg border border-ink-700 px-2 py-1 text-sm tabular-nums" />
                days before
              </label>
            )}
            <Toggle label="Note reminders" desc="Email a note on its remind-on date." on={form.reminderNotes} onChange={(v) => set("reminderNotes", v)} />
          </div>
        </Card>

        {/* Spending alerts */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Spending alerts</h2>
          <Toggle label="Gentle anomaly alerts" desc="A friendly heads-up when a period or category runs above your recent average." on={form.anomalyEnabled} onChange={(v) => set("anomalyEnabled", v)} />
          {form.anomalyEnabled && (
            <>
              <Field label="Sensitivity" hint="How far above your average before we mention it." error={fieldErrs.anomalyThresholdPct}>
                <Select value={String(form.anomalyThresholdPct)} onChange={(e) => set("anomalyThresholdPct", Number(e.target.value))} className="max-w-[220px]">
                  {SENSITIVITY.map((s) => (
                    <option key={s.pct} value={s.pct}>{s.label}</option>
                  ))}
                </Select>
              </Field>
              <div className="mt-2 flex items-center gap-3">
                <Button variant="secondary" className="px-3 text-sm" onClick={checkNow}>
                  Check now
                </Button>
                {checkMsg && <span className="text-xs text-slate-400">{checkMsg}</span>}
              </div>
            </>
          )}
        </Card>

        {/* AI quick-add */}
        {form.aiAvailable && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">AI quick-add</h2>
            <Toggle label="Type-to-add with AI" desc={`Turn "spent 500 on groceries" into a draft you confirm. Nothing is saved without your OK.`} on={form.aiQuickaddEnabled} onChange={(v) => set("aiQuickaddEnabled", v)} />
          </Card>
        )}
      </div>

      {error && <div className="mt-4"><ErrorNote message={error} /></div>}

      <div className="sticky bottom-0 mt-4 -mx-4 border-t border-ink-800 bg-ink-850/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <Button className="w-full" disabled={busy} onClick={save}>
          {busy ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
        </Button>
      </div>
    </PfShell>
  );
}

function Toggle({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        {desc && <div className="text-xs text-slate-400">{desc}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cx("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition", on ? "bg-emerald-600" : "bg-ink-700")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-ink-850 transition", on ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}
