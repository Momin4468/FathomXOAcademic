"use client";
import { useRef, useState } from "react";
import { uploadFile } from "@/lib/upload";
import type { FileMeta } from "@/lib/types";
import { Button, ErrorNote } from "./ui";

/**
 * Capture-first file upload. Picks a file, uploads it through the multipart BFF
 * (which enforces the file rule + compresses images server-side), and hands the
 * resulting file_object metadata to the caller. Large files / video should be
 * linked instead (a separate flow).
 */
export function FileUpload({
  kind,
  onUploaded,
  label = "Attach file",
}: {
  kind: string;
  onUploaded: (file: FileMeta) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const meta = await uploadFile(file, kind);
      onUploaded(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <input ref={ref} type="file" className="hidden" onChange={pick} />
      <Button type="button" variant="secondary" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "Uploading…" : label}
      </Button>
      {error && <ErrorNote message={error} />}
    </div>
  );
}
