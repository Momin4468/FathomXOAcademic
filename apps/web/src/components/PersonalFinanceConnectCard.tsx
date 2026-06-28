"use client";
import { useState } from "react";
import { apiSend } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Button, Card, ErrorNote } from "@/components/ui";

/**
 * Business-side action to connect a user's income to their (separate) Personal
 * Finance plane (§11). Mints a one-time, expiring code for the caller's OWN party;
 * the user pastes it inside the PF app's "Connect income". One-way: this never
 * reads the PF plane.
 */
export function PersonalFinanceConnectCard() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setErr("");
    try {
      const r = await apiSend<{ code: string; expiresAt: string }>("me/personal-finance/link-token", "POST");
      setCode(r.code);
      setExpiresAt(r.expiresAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not generate a code");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the code is shown to select manually */
    }
  }

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">Connect Personal Finance</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Generate a one-time code, then paste it in your private Personal Finance app to receive your payouts as income.
          </p>
        </div>
        <Button variant="secondary" onClick={generate} disabled={busy}>{busy ? "…" : "Generate code"}</Button>
      </div>
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
      {code && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <code className="break-all font-mono text-sm">{code}</code>
            <button type="button" className="shrink-0 text-xs text-gray-500 hover:underline" onClick={copy}>{copied ? "copied" : "copy"}</button>
          </div>
          {expiresAt && <p className="mt-1 text-xs text-gray-400">Expires {formatDateTime(expiresAt)} · single use</p>}
        </div>
      )}
    </Card>
  );
}
