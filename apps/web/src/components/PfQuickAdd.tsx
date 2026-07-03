"use client";
import { useEffect, useRef, useState } from "react";
import { pfApiSend, pfRevalidate, pfAiQuickAdd, usePfApi } from "@/lib/pf-api";
import type { PfCategory, PfFrequentCategory, PfPreferences } from "@/lib/pf-types";
import { PF_CURRENCIES } from "@/lib/pf-types";
import { Button, cx } from "./ui";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Fast expense entry — the single most important PF action. A floating button
 * opens a bottom sheet: big amount → tap a surfaced recent category → Save (date =
 * today, currency = base, note optional). ≈3 taps, and it stays open for rapid
 * multi-entry. Optional AI line turns "spent 500 on groceries" into a draft.
 */
export function PfQuickAdd() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Quick add expense"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-3xl leading-none text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-700 active:scale-95 sm:bottom-6 sm:right-6"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        +
      </button>
      {open && <QuickAddSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const { data: prefs } = usePfApi<PfPreferences>("preferences");
  const { data: frequent } = usePfApi<PfFrequentCategory[]>("categories/frequent?kind=expense");
  const { data: allCats } = usePfApi<PfCategory[]>("categories?kind=expense");

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [currency, setCurrency] = useState("BDT");
  const [occurredOn, setOccurredOn] = useState(today());
  const [note, setNote] = useState("");
  const [showDate, setShowDate] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  const activeCurrencies = prefs?.activeCurrencies?.length ? prefs.activeCurrencies : PF_CURRENCIES;
  const aiOn = !!prefs?.aiAvailable && !!prefs?.aiQuickaddEnabled;
  const incomeFreq = usePfApi<PfFrequentCategory[]>(kind === "income" ? "categories/frequent?kind=income" : null);
  const incomeCats = usePfApi<PfCategory[]>(kind === "income" ? "categories?kind=income" : null);
  const chips = (kind === "income" ? incomeFreq.data : frequent) ?? [];
  const cats = (kind === "income" ? incomeCats.data : allCats) ?? [];

  useEffect(() => {
    if (prefs?.baseCurrency) setCurrency(prefs.baseCurrency);
  }, [prefs?.baseCurrency]);
  useEffect(() => {
    amountRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    const amt = Number(amount.replace(",", "."));
    if (!(amt > 0)) {
      setError("Enter an amount");
      amountRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await pfApiSend(kind === "expense" ? "expense" : "income", "POST", {
        amount: amt,
        categoryId: categoryId || undefined,
        currency,
        occurredOn,
        note: note.trim() || undefined,
      });
      await pfRevalidate();
      // Keep the sheet open for rapid multi-entry; clear the amount + note only.
      setAmount("");
      setNote("");
      setShowNote(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
      amountRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function runAi() {
    if (!aiText.trim()) return;
    setAiBusy(true);
    setError("");
    try {
      const { draft, note: aiNote } = await pfAiQuickAdd(aiText);
      if (draft) {
        setAmount(String(draft.amount));
        if (draft.currency) setCurrency(draft.currency.toUpperCase());
        if (draft.categoryName) {
          const match = cats.find((c) => c.name.toLowerCase() === draft.categoryName!.toLowerCase());
          if (match) setCategoryId(match.id);
        }
        if (draft.note) {
          setNote(draft.note);
          setShowNote(true);
        }
        setAiText("");
        amountRef.current?.focus();
      } else {
        setError(aiNote ?? "Couldn't read that — try 'spent 500 on groceries'.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI unavailable");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Quick add">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative mx-auto max-h-[88vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-4 shadow-xl sm:mb-0 sm:rounded-2xl" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm">
            {(["expense", "income"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setCategoryId("");
                }}
                className={cx("rounded-md px-3 py-1 font-medium capitalize", kind === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}
              >
                {k}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">
            Close
          </button>
        </div>

        {/* Amount — big, autofocused, numeric */}
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-gray-400">{currency === "BDT" ? "৳" : currency}</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            type="text"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="0"
            className="w-full bg-transparent text-4xl font-semibold tabular-nums outline-none placeholder:text-gray-300"
          />
          {activeCurrencies.length > 1 && (
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm">
              {activeCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Category chips (recent/frequent first) */}
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(categoryId === c.id ? "" : c.id)}
              className={cx(
                "rounded-full border px-3 py-1.5 text-sm transition",
                categoryId === c.id ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "border-gray-200 text-gray-700 hover:border-gray-300",
              )}
            >
              {c.name}
            </button>
          ))}
          {cats.length > chips.length && (
            <select
              value={chips.some((c) => c.id === categoryId) ? "" : categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="rounded-full border border-dashed border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600"
            >
              <option value="">More…</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Optional date + note toggles */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <button type="button" onClick={() => setShowDate((v) => !v)} className="hover:text-gray-800">
            {occurredOn === today() ? "Today" : occurredOn} ▾
          </button>
          {showDate && (
            <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
          )}
          {!showNote && (
            <button type="button" onClick={() => setShowNote(true)} className="hover:text-gray-800">
              + note
            </button>
          )}
        </div>
        {showNote && (
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        )}

        {/* Optional AI quick-add */}
        {aiOn && (
          <div className="mt-3 flex items-center gap-2">
            <input
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runAi()}
              placeholder="or type: spent 500 on groceries"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <Button variant="secondary" className="shrink-0 px-3" disabled={aiBusy || !aiText.trim()} onClick={runAi}>
              {aiBusy ? "…" : "✨"}
            </Button>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-4 flex items-center gap-3">
          <Button className="flex-1" disabled={busy} onClick={save}>
            {busy ? "Saving…" : saved ? "Saved ✓" : `Add ${kind}`}
          </Button>
        </div>
        <p className="mt-2 text-center text-[11px] text-gray-400">Stays open for quick multi-entry · Enter to save</p>
      </div>
    </div>
  );
}
