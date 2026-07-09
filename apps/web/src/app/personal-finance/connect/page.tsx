"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import type { PfProfile } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Badge, Button, Card, ErrorNote, Field, Input } from "@/components/ui";

export default function PfConnectPage() {
  const { data: me, mutate } = usePfApi<PfProfile>("auth/me");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setErr("");
    setMsg("");
    setFieldErrs({});
    try {
      const r = await pfApiSend<{ linked: boolean; backfilled: number }>("link", "POST", { code: code.trim() });
      setMsg(`Connected! ${r.backfilled} past payout${r.backfilled === 1 ? "" : "s"} imported as income.`);
      setCode("");
      await mutate();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not connect") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PfShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Connect business income</h1>
      <p className="mb-4 text-xs text-gray-500">
        Link this private account to your FathomXO brokerage party so payouts to you flow in automatically as income.
        Your business can never see anything here — the link only pushes income one way.
      </p>

      {me?.linked ? (
        <Card>
          <div className="flex items-center gap-2 text-sm">
            <Badge tone="green">Connected</Badge>
            <span className="text-gray-600">Your business payouts are flowing in as income.</span>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="mb-3 text-sm text-gray-600">
            In the business app, open <span className="font-medium">Connect Personal Finance</span> on your home page to generate a
            one-time code, then paste it here.
          </p>
          <form onSubmit={connect} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1"><Field label="Link code" error={fieldErrs.code}><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste your one-time code" /></Field></div>
            <Button type="submit" disabled={busy || !code.trim()}>{busy ? "Connecting…" : "Connect"}</Button>
          </form>
          {err && <div className="mt-2"><ErrorNote message={err} /></div>}
        </Card>
      )}
      {msg && <p className="mt-3 text-sm text-emerald-800">{msg}</p>}
    </PfShell>
  );
}
