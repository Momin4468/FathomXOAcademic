"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";

const IMPORT_ENTITIES = ["clients", "jobs", "payments", "settlement_opening"] as const;
const EXPORT_DATASETS = ["clients", "jobs", "payments", "expenses", "invoices", "settlement"] as const;

interface ImportRow { id: string; rowNumber: number; status: string; errorsJson: string[] | null; resolutionJson: Record<string, string> | null }
interface ImportResult { batch: { id: string; entityType: string; status: string; validCount: number; invalidCount: number; committedCount: number; failedCount: number }; rows: ImportRow[] }

export default function DataPage() {
  const { data: me, isLoading } = useApi<WhoAmI>("platform/whoami");
  const allowed = can(me?.permissions, "import_export:view");
  const [tab, setTab] = useState<"import" | "export" | "archive">("import");

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Data — import · export · archive</h1>
      <p className="mb-4 text-xs text-slate-400">
        Three paths into the system: manual template · preprocess script · AI capture. Imports preview before they commit; nothing is created until you confirm.
      </p>

      {isLoading && <Spinner />}
      {!isLoading && !allowed && <EmptyState title="You don't have access to data tools" />}

      {allowed && (
        <>
          <div className="mb-4 flex gap-2">
            {(["import", "export", "archive"] as const).map((t) => (
              <Button key={t} variant={tab === t ? "primary" : "secondary"} className="px-3 capitalize" onClick={() => setTab(t)}>{t}</Button>
            ))}
          </div>
          {tab === "import" && <ImportTab />}
          {tab === "export" && <ExportTab />}
          {tab === "archive" && <ArchiveTab />}
        </>
      )}
    </AppShell>
  );
}

function ImportTab() {
  const [entity, setEntity] = useState<string>("clients");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState(false);

  async function onFile(file: File) {
    setBusy(true); setErr(""); setResult(null); setCommitted(false);
    try {
      const fd = new FormData();
      fd.append("entity", entity);
      fd.append("file", file);
      const res = await fetch("/api/import/preview", { method: "POST", credentials: "same-origin", body: fd });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(Array.isArray(data?.message) ? data.message.join(", ") : data?.message ?? "Preview failed");
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!result) return;
    setBusy(true); setErr("");
    try {
      const r = await apiSend<ImportResult>(`import/${result.batch.id}/commit`, "POST");
      setResult(r); setCommitted(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="What are you importing?">
            <Select value={entity} onChange={(e) => { setEntity(e.target.value); setResult(null); }}>
              {IMPORT_ENTITIES.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}
            </Select>
          </Field>
          <Field label="1. Get the template" hint="Exact headers + a sample row.">
            <a href={`/api/import/template/${entity}`} className="inline-flex min-h-[44px] items-center rounded-lg border border-ink-700 px-4 text-sm font-medium text-slate-200 hover:bg-ink-800">Download {entity} template ↓</a>
          </Field>
        </div>
        <div className="mt-3">
          <Field label="2. Upload your filled CSV / Excel" hint="A dry-run preview shows what will be created — nothing is saved yet.">
            <input type="file" accept=".csv,.xlsx,.xls" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} className="block text-sm" />
          </Field>
        </div>
        {err && <div className="mt-2"><ErrorNote message={err} /></div>}
      </Card>

      {busy && <Spinner label="Working…" />}

      {result && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-200">
              {committed ? "Committed" : "Preview"} — {result.batch.entityType.replace("_", " ")}
            </p>
            <div className="flex items-center gap-2 text-xs">
              <Badge tone="green">{result.batch.validCount} valid</Badge>
              {result.batch.invalidCount > 0 && <Badge tone="red">{result.batch.invalidCount} invalid</Badge>}
              {committed && <Badge tone="blue">{result.batch.committedCount} created</Badge>}
              {committed && result.batch.failedCount > 0 && <Badge tone="red">{result.batch.failedCount} failed</Badge>}
            </div>
          </div>
          <ul className="divide-y divide-ink-800 overflow-hidden rounded-lg border border-ink-700">
            {result.rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-slate-500">#{r.rowNumber}</span>
                <div className="min-w-0 flex-1">
                  <StatusBadge status={r.status} />
                  {r.resolutionJson && (
                    <span className="ml-2 text-xs text-slate-400">
                      {Object.entries(r.resolutionJson).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                    </span>
                  )}
                  {r.errorsJson && r.errorsJson.length > 0 && (
                    <span className="ml-2 text-xs text-red-600">{r.errorsJson.join("; ")}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!committed && result.batch.validCount > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <Button onClick={commit} disabled={busy}>{busy ? "Committing…" : `Commit ${result.batch.validCount} valid row(s)`}</Button>
              <span className="text-xs text-slate-500">Creates records through the normal validation + governance, marked "added by import".</span>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "valid" ? "blue" : status === "committed" ? "green" : status === "failed" || status === "invalid" ? "red" : "gray";
  const label = { valid: "ready", invalid: "has errors", committed: "created", failed: "failed" }[status] ?? status;
  return <Badge tone={tone}>{label}</Badge>;
}

function ExportTab() {
  const [dataset, setDataset] = useState<string>("clients");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  return (
    <Card>
      <p className="mb-3 text-sm text-slate-300">Export reflects exactly what you can see in the app — figures you aren&rsquo;t permitted to see are never included.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Dataset"><Select value={dataset} onChange={(e) => setDataset(e.target.value)}>{EXPORT_DATASETS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
        <Field label="Format"><Select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></Select></Field>
      </div>
      <div className="mt-3">
        <a href={`/api/export/${dataset}?format=${format}`} className="inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800">Download {dataset}.{format} ↓</a>
      </div>
    </Card>
  );
}

function ArchiveTab() {
  const [q, setQ] = useState("");
  const { data, error, isLoading, mutate } = useApi<Array<{ id: string; title: string; description: string | null; docDate: string | null; tags: string[]; fileObjectId: string | null; fileIsLink: boolean | null; fileUrl: string | null }>>(`archive?q=${encodeURIComponent(q)}`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", docDate: "", tags: "", url: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || (!file && !form.url.trim())) { setErr("A title and a file or link are required"); return; }
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("title", form.title.trim());
      if (form.description) fd.append("description", form.description);
      if (form.docDate) fd.append("docDate", form.docDate);
      if (form.tags) fd.append("tags", form.tags);
      if (file) fd.append("file", file);
      else fd.append("url", form.url.trim());
      const res = await fetch("/api/archive/upload", { method: "POST", credentials: "same-origin", body: fd });
      if (!res.ok) { const t = await res.text(); throw new Error(JSON.parse(t || "{}")?.message ?? "Upload failed"); }
      setForm({ title: "", description: "", docDate: "", tags: "", url: "" }); setFile(null); setOpen(false);
      await mutate();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="flex-1"><Input placeholder="Search archived files…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button className="shrink-0" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Add file"}</Button>
      </div>

      {open && (
        <Card className="mb-5">
          <form onSubmit={add} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="2025 master sheet" /></Field>
              <Field label="Document date"><DateInput value={form.docDate} onChange={(v) => setForm({ ...form, docDate: v })} /></Field>
              <Field label="Tags (comma-separated)"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="2025, settlement" /></Field>
              <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </div>
            <Field label="File (small) — or a link below (large)">
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
            </Field>
            <Field label="…or a link (large files)"><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></Field>
            {err && <ErrorNote message={err} />}
            <Button type="submit" disabled={busy || !form.title.trim()}>{busy ? "Saving…" : "Add to archive"}</Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No archived files" hint="Add old sheets, the 2025 file, references." />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
          {data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{a.title}</span>
                {a.docDate && <span className="ml-2 text-xs text-slate-500">{formatDate(a.docDate)}</span>}
                {a.tags?.length > 0 && <span className="ml-2">{a.tags.map((t) => <Badge key={t} tone="gray">{t}</Badge>)}</span>}
                {a.description && <div className="mt-0.5 truncate text-xs text-slate-400">{a.description}</div>}
              </div>
              {a.fileObjectId && (
                <a
                  href={a.fileIsLink && a.fileUrl ? a.fileUrl : `/api/files/${a.fileObjectId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-blue-700 hover:underline"
                >
                  open ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
