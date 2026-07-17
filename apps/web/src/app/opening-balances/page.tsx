"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { CURRENCIES } from "@business-os/shared";
import { apiGet, apiSend, useApi } from "@/lib/api";
import type { PartyRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { useConfirm } from "@/components/confirm";
import {
  Badge, Card, DGrid, EmptyBox, Field, GoldButton, Loading, Note, Page, T,
  cell, dcInput, fmtDay, type DCol,
} from "@/components/dc";

interface OpeningBalanceRow {
  id: string;
  partyId: string | null;
  amount: string;
  currency: string;
  asOf: string;
  note: string | null;
  reversesId: string | null;
}

const searchAnyParty = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((p) => ({ id: p.id, label: p.displayName, sub: (p.partyType ?? []).join(", ") || undefined }));
};

const fmtSigned = (amount: string, currency: string) => {
  const n = Number(amount);
  const prefix = currency === "BDT" ? "৳" : `${currency} `;
  const mag = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return n < 0 ? `(${prefix}${mag})` : `${prefix}${mag}`;
};

/**
 * Opening balances (Phase 5) — a one-time, dated starting point per party (or the
 * business overall) that feeds the derived balance. A distinct, clearly-labeled
 * entry, never a fake backdated job/payment. Append-only (correct with a reversal).
 */
export default function OpeningBalancesPage() {
  const { mutate } = useSWRConfig();
  const confirm = useConfirm();
  const { data, error, isLoading } = useApi<OpeningBalanceRow[]>("opening-balances");

  const [scope, setScope] = useState<"party" | "business">("party");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"owed_to" | "owes_us">("owed_to");
  const [magnitude, setMagnitude] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [asOf, setAsOf] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const mag = Number(magnitude);
    if (!asOf || !(mag > 0) || (scope === "party" && !partyId)) return;
    setBusy(true);
    setFormError("");
    try {
      await apiSend("opening-balances", "POST", {
        partyId: scope === "party" ? partyId : undefined,
        amount: direction === "owes_us" ? -mag : mag,
        currency,
        asOf,
        note: note.trim() || undefined,
      });
      setMagnitude("");
      setNote("");
      setPartyId(null);
      await mutate("opening-balances");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function reverse(id: string) {
    if (!(await confirm({ title: "Reverse this opening balance?", body: "Posts a negating entry (append-only).", danger: true, confirmLabel: "Reverse" }))) return;
    await apiSend(`opening-balances/${id}/reverse`, "POST");
    await mutate("opening-balances");
  }

  const cols: DCol<OpeningBalanceRow>[] = [
    {
      label: "Party",
      text: (r) => [r.partyId ? "" : "Business overall", r.reversesId ? "reversal" : "", r.note ?? ""].filter(Boolean).join(" "),
      render: (r) => (
        <span>
          <span style={{ fontWeight: 600 }}>{r.partyId ? <PartyName id={r.partyId} /> : "Business overall"}</span>
          {r.reversesId && <span style={{ marginLeft: 8 }}><Badge tone="gray">reversal</Badge></span>}
          {r.note && <span style={{ display: "block", fontSize: 10.5, color: T.muted2 }}>{r.note}</span>}
        </span>
      ),
    },
    { label: "As of", text: (r) => r.asOf, render: (r) => cell(fmtDay(r.asOf), { color: T.muted2 }) },
    { label: "Amount", align: "right", text: (r) => Number(r.amount), render: (r) => cell(fmtSigned(r.amount, r.currency), { nums: true, weight: 600, color: Number(r.amount) < 0 ? T.red : undefined }) },
    {
      label: "", align: "right", render: (r) =>
        !r.reversesId ? (
          <span onClick={() => void reverse(r.id)} style={{ fontSize: 11, fontWeight: 600, color: T.muted, cursor: "pointer" }}>reverse</span>
        ) : null,
    },
  ];

  return (
    <AppShell>
      <Page title="Opening balances" sub="a one-time dated starting point per party (or the business overall) — distinct from a job or payment; append-only">
        <p style={{ fontSize: 11.5, color: T.muted, marginBottom: 14, maxWidth: 720 }}>
          From here, normal legs and payments carry the balance forward. Backdating is allowed.
        </p>

        <Card style={{ marginBottom: 16 }}>
          <form onSubmit={submit} style={{ padding: 16, display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="Applies to">
                <select value={scope} onChange={(e) => setScope(e.target.value as "party" | "business")} style={dcInput}>
                  <option value="party">A specific party</option>
                  <option value="business">The business overall</option>
                </select>
              </Field>
              {scope === "party" && (
                <Field label="Party" required>
                  <EntityPicker placeholder="Search any party…" search={searchAnyParty} onPick={(i) => setPartyId(i?.id ?? null)} />
                </Field>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <Field label="Direction">
                <select value={direction} onChange={(e) => setDirection(e.target.value as "owed_to" | "owes_us")} style={dcInput}>
                  <option value="owed_to">Owed to them (+)</option>
                  <option value="owes_us">They owe us (−)</option>
                </select>
              </Field>
              <Field label="Amount" required>
                <input inputMode="decimal" value={magnitude} onChange={(e) => setMagnitude(e.target.value)} style={{ ...dcInput, textAlign: "right" }} />
              </Field>
              <Field label="Currency">
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={dcInput}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="As of" required hint="A real date — may be in the past.">
                <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} required style={dcInput} />
              </Field>
              <Field label="Note">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" style={dcInput} />
              </Field>
            </div>
            {formError && <Note>{formError}</Note>}
            <div>
              <GoldButton type="submit" disabled={busy || !asOf || !(Number(magnitude) > 0) || (scope === "party" && !partyId)}>
                {busy ? "Saving…" : "Record opening balance"}
              </GoldButton>
            </div>
          </form>
        </Card>

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (data.length === 0 ? (
          <EmptyBox title="No opening balances yet" hint="Record one above to seed a starting position." />
        ) : (
          <DGrid cols={cols} rows={data} keyOf={(r) => r.id} minWidth={520} search exportName="opening-balances" />
        ))}
      </Page>
    </AppShell>
  );
}
