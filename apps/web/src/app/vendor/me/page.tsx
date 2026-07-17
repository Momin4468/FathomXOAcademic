"use client";
import type { CSSProperties } from "react";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { sanitizeAmount } from "@/lib/format";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, CardHead, cell, DGrid, dcInput, Field, fmtDay, GhostButton, Loading, money, Note, Page, StatCards, T, type Stat } from "@/components/dc";

/**
 * The vendor self-view (audit item 13). Shows ONLY this vendor's own slice —
 * their handoff earnings + balance (chain/client price redacted by RLS) — plus a
 * "submit an invoice" form and the status of their submitted claims.
 */
type VendorHandoff = { id: string; workItemId: string; amount: string; createdAt: string };
type VendorClaim = { id: string; amount: string; note: string | null; status: string; createdAt: string };
interface VendorMe {
  balance: { earnings: { owed: number; paid: number; outstanding: number } };
  handoffs: VendorHandoff[];
  claims: VendorClaim[];
}

const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "22px 0 10px" };

export default function VendorMePage() {
  const { data, error, isLoading, mutate } = useApi<VendorMe>("vendor/me");
  const earnings = data?.balance?.earnings;

  const stats: Stat[] = [
    { label: "Earned", value: money(earnings?.owed), tone: "green" },
    { label: "Paid out", value: money(earnings?.paid), tone: "blue" },
    { label: "Outstanding", value: money(earnings?.outstanding), tone: "amber" },
  ];

  return (
    <AppShell>
      <Page title="My invoices" sub="your earnings, submitted invoices, and handoffs paid via the ledger">
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <>
            <StatCards items={stats} min={180} />

            <SubmitClaim onSaved={mutate} />

            <h2 style={sectionH}>Submitted invoices</h2>
            <DGrid<VendorClaim>
              minWidth={420}
              rows={data.claims}
              keyOf={(c) => c.id}
              cols={[
                { label: "Amount", align: "right", render: (c) => cell(money(c.amount), { nums: true, weight: 600 }) },
                { label: "Note", render: (c) => <span style={{ color: T.ink2 }}>{c.note ?? "—"}</span> },
                { label: "Date", render: (c) => <span style={{ color: T.muted2 }}>{fmtDay(c.createdAt)}</span> },
                { label: "Status", align: "center", render: (c) => <Badge tone={c.status === "approved" ? "green" : c.status === "rejected" ? "red" : "amber"}>{c.status}</Badge> },
              ]}
              empty="No invoices submitted — submit one above; an admin will review it."
              foot={data.claims.length ? <>Total submitted · {money(data.claims.reduce((s, c) => s + Number(c.amount || 0), 0))}</> : undefined}
            />

            <h2 style={sectionH}>Your handoffs (paid via the ledger)</h2>
            <DGrid<VendorHandoff>
              minWidth={320}
              rows={data.handoffs}
              keyOf={(h) => h.id}
              cols={[
                { label: "Date", render: (h) => <span style={{ color: T.muted2 }}>{fmtDay(h.createdAt)}</span> },
                { label: "Amount", align: "right", render: (h) => cell(money(h.amount), { nums: true, weight: 600 }) },
              ]}
              empty="No handoffs yet — jobs paid to you will appear here."
              foot={data.handoffs.length ? <>Total paid · {money(data.handoffs.reduce((s, h) => s + Number(h.amount || 0), 0))}</> : undefined}
            />
          </>
        )}
      </Page>
    </AppShell>
  );
}

function SubmitClaim({ onSaved }: { onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0)) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend("vendor/claims", "POST", { amount: amt, note: note.trim() || undefined });
      setAmount("");
      setNote("");
      onSaved();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not submit") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead>Submit an invoice</CardHead>
      <form onSubmit={submit} style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label="Amount (৳)" error={fieldErrs.amount}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(sanitizeAmount(e.target.value))} placeholder="৳ amount" style={{ ...dcInput, textAlign: "right" }} />
        </Field>
        <Field label="Note (optional)" error={fieldErrs.note}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it's for" style={dcInput} />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <GhostButton type="submit" disabled={busy || !(Number(amount) > 0)}>{busy ? "Submitting…" : "Submit invoice"}</GhostButton>
        </div>
        {err && <div style={{ gridColumn: "1 / -1" }}><Note>{err}</Note></div>}
      </form>
    </Card>
  );
}
