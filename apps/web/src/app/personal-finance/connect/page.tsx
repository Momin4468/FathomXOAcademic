"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import type { PfProfile } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { PF, PfBtn, PfCard, PfField, PfInput, PfBadge, PfNote } from "@/components/pf-dc";

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
      <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Connect business income</h1>
      <p style={{ fontSize: 12, color: PF.onGradSub, margin: "4px 0 16px", maxWidth: 560 }}>
        Link this private account to your FathomXO brokerage party so payouts to you flow in automatically as income.
        Your business can never see anything here — the link only pushes income one way.
      </p>

      {me?.linked ? (
        <PfCard>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <PfBadge tone="green">Connected</PfBadge>
            <span style={{ color: PF.text2 }}>Your business payouts are flowing in as income.</span>
          </div>
        </PfCard>
      ) : (
        <PfCard>
          <p style={{ fontSize: 12.5, color: PF.text2, margin: "0 0 12px" }}>
            In the business app, open <span style={{ fontWeight: 600, color: PF.text }}>Connect Personal Finance</span> on your home page to generate a
            one-time code, then paste it here.
          </p>
          <form onSubmit={connect} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 200 }}><PfField label="Link code" error={fieldErrs.code}><PfInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste your one-time code" /></PfField></div>
            <PfBtn type="submit" disabled={busy || !code.trim()}>{busy ? "Connecting…" : "Connect"}</PfBtn>
          </form>
          {err && <div style={{ marginTop: 8 }}><PfNote tone="red">{err}</PfNote></div>}
        </PfCard>
      )}
      {msg && <p style={{ marginTop: 12, fontSize: 12.5, color: PF.light }}>{msg}</p>}
    </PfShell>
  );
}
