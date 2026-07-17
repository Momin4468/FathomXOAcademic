"use client";
import { useState } from "react";
import type { CSSProperties } from "react";
import { apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { uploadFile } from "@/lib/upload";
import { can, type FileMeta, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DateInput, MoneyInput } from "@/components/ui";
import { Badge, Card, EmptyBox, Field, Loading, Note, Page, T, dcInput, type Tone } from "@/components/dc";

interface Proposal {
  id: string;
  targetType: "client" | "job" | "payment" | "expense";
  proposedJson: Record<string, unknown>;
  confidence: string | null;
  label: string | null;
  status: string;
}
interface CaptureResult {
  capture: { id: string; kind: string };
  proposals: Proposal[];
  note?: string;
}

const TARGET_TONE: Record<string, Tone> = { client: "blue", job: "amber", payment: "green", expense: "gray" };

// Design (AI capture): navy "Extract proposals", green Accept, gray Reject.
const navyBtn: CSSProperties = { background: T.ink, color: "#F0D08C", fontWeight: 700, fontSize: 12.5, padding: "8px 16px", borderRadius: 8, cursor: "pointer", border: "none" };
const acceptBtn: CSSProperties = { fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7, cursor: "pointer", background: T.greenBg, color: T.green, border: "none" };
const rejectBtn: CSSProperties = { fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7, cursor: "pointer", background: "#F1F3F7", color: T.muted, border: "none" };

export default function CapturePage() {
  const { data: me, isLoading: meLoading } = useApi<WhoAmI>("platform/whoami");
  const allowed = can(me?.permissions, "ai_capture:create");

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [done, setDone] = useState(0);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      const r = await apiSend<CaptureResult>("ai-capture", "POST", body);
      setResult(r);
      setProposals(r.proposals.filter((p) => p.status === "pending"));
      setDone(0);
    } catch (e) {
      setFieldErrs(fieldErrorMap(e));
      setErr(bannerMessage(e, "Could not extract") ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function submitText() {
    if (!text.trim()) return;
    const kind = /\b\d{1,2}[:/]\d{2}\b|: /.test(text) && text.split("\n").length > 3 ? "whatsapp" : "text";
    await run({ kind, text });
  }
  async function submitFile(file: File) {
    setBusy(true);
    setErr("");
    try {
      const meta: FileMeta = await uploadFile(file, "other");
      const kind = file.type.startsWith("image/") ? "image" : "voice";
      await run({ kind, fileObjectId: meta.id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not upload");
      setBusy(false);
    }
  }

  function removeProposal(id: string) {
    setProposals((ps) => ps.filter((p) => p.id !== id));
    setDone((d) => d + 1);
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 820 }}>
        <Page
          title="AI capture"
          sub="paste a WhatsApp message → proposed records → you Accept. The AI proposes, a human confirms."
          action={<Badge tone="blue">added by AI → you confirm</Badge>}
        >
          <p style={{ fontSize: 12, color: T.muted, margin: "-4px 0 14px" }}>
            Paste a chat / notes, or upload an image or voice note. Nothing is created until you accept — Accept runs through the same create rules, stamped &ldquo;added by AI&rdquo;.
          </p>

          {meLoading && <Loading />}
          {!meLoading && !allowed && <EmptyBox title="You don't have access to AI capture" />}

          {allowed && (
            <>
              <Card style={{ padding: 14, marginBottom: 20 }}>
                <Field label="Paste text or a WhatsApp export" error={fieldErrs.text}>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="e.g. Paid 5000 to writer for ICT701 essay&#10;Received 12000 BDT from client&#10;New client: John Smith"
                    style={{ ...dcInput, minHeight: 140, resize: "vertical", lineHeight: 1.5 }}
                  />
                </Field>
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <button type="button" onClick={submitText} disabled={busy || !text.trim()} style={{ ...navyBtn, opacity: busy || !text.trim() ? 0.5 : 1, cursor: busy || !text.trim() ? "not-allowed" : "pointer" }}>
                    {busy ? "Extracting…" : "Extract proposals"}
                  </button>
                  <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", borderRadius: 8, border: `1px solid ${T.border}`, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: T.ink2, background: T.card }}>
                    Upload image / voice
                    <input type="file" accept="image/*,audio/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void submitFile(f); }} />
                  </label>
                </div>
                {err && <div style={{ marginTop: 10 }}><Note>{err}</Note></div>}
              </Card>

              {busy && <Loading label="Extracting…" />}

              {result?.note && <div style={{ marginBottom: 12 }}><Note tone="amber">{result.note}</Note></div>}

              {result && proposals.length === 0 && !busy && (
                <EmptyBox
                  title={done > 0 ? "All proposals handled" : "No proposals found"}
                  hint={done > 0 ? `${done} reviewed.` : "Try more detail, or configure a media provider for image/voice."}
                />
              )}

              {proposals.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {proposals.map((p) => (
                    <ProposalCard key={p.id} proposal={p} onResolved={() => removeProposal(p.id)} />
                  ))}
                </div>
              )}
            </>
          )}
        </Page>
      </div>
    </AppShell>
  );
}

function ProposalCard({ proposal, onResolved }: { proposal: Proposal; onResolved: () => void }) {
  const [fields, setFields] = useState<Record<string, unknown>>(proposal.proposedJson ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const set = (k: string, v: unknown) => setFields((f) => ({ ...f, [k]: v }));
  const str = (k: string) => (fields[k] == null ? "" : String(fields[k]));

  async function accept() {
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend(`ai-capture/proposals/${proposal.id}/edit`, "POST", { fields });
      await apiSend(`ai-capture/proposals/${proposal.id}/accept`, "POST");
      onResolved();
    } catch (e) {
      setFieldErrs(fieldErrorMap(e));
      setErr(bannerMessage(e, "Could not accept") ?? "");
      setBusy(false);
    }
  }
  async function reject() {
    setBusy(true);
    try {
      await apiSend(`ai-capture/proposals/${proposal.id}/reject`, "POST");
      onResolved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reject");
      setBusy(false);
    }
  }

  const conf = proposal.confidence != null ? Math.round(Number(proposal.confidence) * 100) : null;
  // Money targets need a positive amount before Accept (the server also enforces it).
  const needsAmount = proposal.targetType === "payment" || proposal.targetType === "expense";
  const canAccept = !needsAmount || Number(fields.amount) > 0;

  return (
    <Card style={{ padding: 14 }}>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
          <Badge tone={TARGET_TONE[proposal.targetType] ?? "gray"}>{proposal.targetType}</Badge>
          <span>{proposal.label}</span>
        </span>
        {conf != null && <span style={{ fontSize: 11.5, color: T.muted2 }}>{conf}% sure</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {proposal.targetType === "client" && (
          <>
            <Field label="Name" error={fieldErrs.displayName}><input value={str("displayName")} onChange={(e) => set("displayName", e.target.value)} style={dcInput} /></Field>
            <Field label="University (optional)" error={fieldErrs.universityRaw}><input value={str("universityRaw")} onChange={(e) => set("universityRaw", e.target.value)} style={dcInput} /></Field>
          </>
        )}
        {proposal.targetType === "job" && (
          <>
            <Field label="Title" error={fieldErrs.title}><input value={str("title")} onChange={(e) => set("title", e.target.value)} style={dcInput} /></Field>
            <Field label="Details" error={fieldErrs.details}><input value={str("details")} onChange={(e) => set("details", e.target.value)} style={dcInput} /></Field>
          </>
        )}
        {proposal.targetType === "payment" && (
          <>
            <Field label="Direction" error={fieldErrs.direction}><select value={str("direction") || "in"} onChange={(e) => set("direction", e.target.value)} style={dcInput}><option value="in">received (in)</option><option value="out">paid (out)</option></select></Field>
            <Field label="Amount (৳)" error={fieldErrs.amount}><MoneyInput value={str("amount")} onChange={(v) => set("amount", Number(v))} /></Field>
            <Field label="Date" error={fieldErrs.paidAt}><DateInput value={str("paidAt") || new Date().toISOString().slice(0, 10)} onChange={(v) => set("paidAt", v)} /></Field>
            <Field label="Note" error={fieldErrs.note}><input value={str("note")} onChange={(e) => set("note", e.target.value)} style={dcInput} /></Field>
          </>
        )}
        {proposal.targetType === "expense" && (
          <>
            <Field label="Category" error={fieldErrs.category}><select value={str("category") || "other"} onChange={(e) => set("category", e.target.value)} style={dcInput}>{["subscription", "salary", "promo", "loss", "event", "other"].map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
            <Field label="Amount (৳)" error={fieldErrs.amount}><MoneyInput value={str("amount")} onChange={(v) => set("amount", Number(v))} /></Field>
            <Field label="Date" error={fieldErrs.incurredAt}><DateInput value={str("incurredAt") || new Date().toISOString().slice(0, 10)} onChange={(v) => set("incurredAt", v)} /></Field>
            <Field label="Cost bearer" error={fieldErrs.costBearer}><select value={str("costBearer") || "momin"} onChange={(e) => set("costBearer", e.target.value)} style={dcInput}>{["momin", "emon", "split", "writer"].map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
            <Field label="Note" error={fieldErrs.note}><input value={str("note")} onChange={(e) => set("note", e.target.value)} style={dcInput} /></Field>
          </>
        )}
      </div>

      {err && <div style={{ marginTop: 10 }}><Note>{err}</Note></div>}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={accept} disabled={busy || !canAccept} style={{ ...acceptBtn, opacity: busy || !canAccept ? 0.5 : 1, cursor: busy || !canAccept ? "not-allowed" : "pointer" }}>{busy ? "…" : "Accept"}</button>
        <button type="button" onClick={reject} disabled={busy} style={{ ...rejectBtn, opacity: busy ? 0.5 : 1, cursor: busy ? "not-allowed" : "pointer" }}>Reject</button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: T.muted2 }}>Accepting creates a draft you can still review.</span>
      </div>
    </Card>
  );
}
