"use client";
import Link from "next/link";
import { useState } from "react";
import { clientApiSend } from "@/lib/client-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { ClientPortalShell } from "@/components/ClientPortalShell";
import { Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";

const MAX_BRIEF_BYTES = 10 * 1024 * 1024; // mirror the server FILES_MAX_BYTES
const BRIEF_ACCEPT = "image/*,.pdf,.doc,.docx,.txt";

export default function NewRequestPage() {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [briefWarning, setBriefWarning] = useState("");

  function pickFile(f: File | null) {
    setError("");
    if (f && f.type.startsWith("video/")) {
      setError("Video files aren’t supported — share a link with us in Messages instead.");
      setFile(null);
      return;
    }
    if (f && f.size > MAX_BRIEF_BYTES) {
      setError("That file is too large (max 10MB).");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    setFieldErrs({});
    try {
      const created = await clientApiSend<{ id: string }>("requests", "POST", {
        title: title.trim(),
        details: details.trim() || undefined,
      });
      // Optional brief upload (multipart) once the draft exists. If it fails, the
      // request is already in — tell the client they can add it from Messages
      // (never imply the whole submission failed → no duplicate re-submits).
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/client/upload/${created.id}`, {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        if (!res.ok) {
          setBriefWarning("Your request was received, but the attachment didn’t upload. You can send it to us in Messages.");
        }
      }
      setDone(true);
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setError(bannerMessage(err, "Could not submit your request") ?? "");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <ClientPortalShell>
        <h1 className="mb-5 text-lg font-semibold tracking-tight">Request submitted</h1>
        <Card>
          <p className="text-sm text-gray-700">Thanks — we’ve received your request and will get back to you with a quote.</p>
          {briefWarning && <p className="mt-2 text-sm text-amber-700">{briefWarning}</p>}
          <div className="mt-4 flex gap-2">
            <Link href="/portal"><Button>View my requests</Button></Link>
            <Link href="/portal/messages"><Button variant="secondary">Message us</Button></Link>
          </div>
        </Card>
      </ClientPortalShell>
    );
  }

  return (
    <ClientPortalShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Submit a request</h1>
      <Card>
        <p className="mb-4 text-sm text-gray-500">
          Tell us what you need. We’ll review it and get back to you with a quote — nothing is charged until you confirm.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="What do you need?" error={fieldErrs.title}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 2000-word essay, ICT701" required />
          </Field>
          <Field label="Details (optional)" error={fieldErrs.details}>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={5} placeholder="Deadline, word count, instructions…" />
          </Field>
          <Field label="Attach a brief (optional)" hint="A document or image (max 10MB) — no video files.">
            <Input type="file" accept={BRIEF_ACCEPT} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </Field>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </form>
      </Card>
    </ClientPortalShell>
  );
}
