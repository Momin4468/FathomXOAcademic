"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { uploadFile } from "@/lib/upload";
import { can, type FileMeta, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Select, Spinner, Textarea } from "@/components/ui";

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

const TARGET_TONE: Record<string, string> = { client: "blue", job: "amber", payment: "green", expense: "gray" };

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
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">AI capture</h1>
        <Badge tone="blue">added by AI → you confirm</Badge>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Paste a chat / notes, or upload an image or voice note. The assistant proposes drafts — nothing is saved until you accept each one.
      </p>

      {meLoading && <Spinner />}
      {!meLoading && !allowed && <EmptyState title="You don't have access to AI capture" />}

      {allowed && (
        <>
          <Card className="mb-5">
            <Field label="Paste text or a WhatsApp export" error={fieldErrs.text}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Paid 5000 to writer for ICT701 essay&#10;Received 12000 BDT from client&#10;New client: John Smith" className="min-h-[140px]" />
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={submitText} disabled={busy || !text.trim()}>{busy ? "Extracting…" : "Extract proposals"}</Button>
              <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50">
                Upload image / voice
                <input type="file" accept="image/*,audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void submitFile(f); }} />
              </label>
            </div>
            {err && <div className="mt-2"><ErrorNote message={err} /></div>}
          </Card>

          {busy && <Spinner label="Extracting…" />}

          {result?.note && <div className="mb-3"><ErrorNote message={result.note} /></div>}

          {result && proposals.length === 0 && !busy && (
            <EmptyState
              title={done > 0 ? "All proposals handled" : "No proposals found"}
              hint={done > 0 ? `${done} reviewed.` : "Try more detail, or configure a media provider for image/voice."}
            />
          )}

          {proposals.length > 0 && (
            <ul className="space-y-3">
              {proposals.map((p) => (
                <ProposalCard key={p.id} proposal={p} onResolved={() => removeProposal(p.id)} />
              ))}
            </ul>
          )}
        </>
      )}
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
    <li>
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium">
            <Badge tone={TARGET_TONE[proposal.targetType] ?? "gray"}>{proposal.targetType}</Badge>
            <span className="ml-2">{proposal.label}</span>
          </span>
          {conf != null && <span className="text-xs text-gray-400">{conf}% sure</span>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {proposal.targetType === "client" && (
            <>
              <Field label="Name" error={fieldErrs.displayName}><Input value={str("displayName")} onChange={(e) => set("displayName", e.target.value)} /></Field>
              <Field label="University (optional)" error={fieldErrs.universityRaw}><Input value={str("universityRaw")} onChange={(e) => set("universityRaw", e.target.value)} /></Field>
            </>
          )}
          {proposal.targetType === "job" && (
            <>
              <Field label="Title" error={fieldErrs.title}><Input value={str("title")} onChange={(e) => set("title", e.target.value)} /></Field>
              <Field label="Details" error={fieldErrs.details}><Input value={str("details")} onChange={(e) => set("details", e.target.value)} /></Field>
            </>
          )}
          {proposal.targetType === "payment" && (
            <>
              <Field label="Direction" error={fieldErrs.direction}><Select value={str("direction") || "in"} onChange={(e) => set("direction", e.target.value)}><option value="in">received (in)</option><option value="out">paid (out)</option></Select></Field>
              <Field label="Amount (৳)" error={fieldErrs.amount}><MoneyInput value={str("amount")} onChange={(v) => set("amount", Number(v))} /></Field>
              <Field label="Date" error={fieldErrs.paidAt}><DateInput value={str("paidAt") || new Date().toISOString().slice(0, 10)} onChange={(v) => set("paidAt", v)} /></Field>
              <Field label="Note" error={fieldErrs.note}><Input value={str("note")} onChange={(e) => set("note", e.target.value)} /></Field>
            </>
          )}
          {proposal.targetType === "expense" && (
            <>
              <Field label="Category" error={fieldErrs.category}><Select value={str("category") || "other"} onChange={(e) => set("category", e.target.value)}>{["subscription", "salary", "promo", "loss", "event", "other"].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
              <Field label="Amount (৳)" error={fieldErrs.amount}><MoneyInput value={str("amount")} onChange={(v) => set("amount", Number(v))} /></Field>
              <Field label="Date" error={fieldErrs.incurredAt}><DateInput value={str("incurredAt") || new Date().toISOString().slice(0, 10)} onChange={(v) => set("incurredAt", v)} /></Field>
              <Field label="Cost bearer" error={fieldErrs.costBearer}><Select value={str("costBearer") || "momin"} onChange={(e) => set("costBearer", e.target.value)}>{["momin", "emon", "split", "writer"].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
              <Field label="Note" error={fieldErrs.note}><Input value={str("note")} onChange={(e) => set("note", e.target.value)} /></Field>
            </>
          )}
        </div>

        {err && <div className="mt-2"><ErrorNote message={err} /></div>}
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={accept} disabled={busy || !canAccept}>{busy ? "…" : "Accept"}</Button>
          <Button variant="danger" className="px-3" onClick={reject} disabled={busy}>Reject</Button>
          <span className="ml-auto text-xs text-gray-400">Accepting creates a draft you can still review.</span>
        </div>
      </Card>
    </li>
  );
}
