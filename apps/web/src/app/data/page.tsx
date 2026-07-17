"use client";
import type { CSSProperties } from "react";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Card,
  CardHead,
  dcInput,
  EmptyBox,
  Field,
  GoldButton,
  Loading,
  Note,
  Page,
  Pill,
  StatCards,
  T,
} from "@/components/dc";

const IMPORT_ENTITIES = ["clients", "jobs", "payments", "settlement_opening"] as const;
const EXPORT_DATASETS = ["clients", "jobs", "payments", "expenses", "invoices", "settlement"] as const;

interface ImportRow { id: string; rowNumber: number; status: string; errorsJson: string[] | null; resolutionJson: Record<string, string> | null }
interface ImportResult { batch: { id: string; entityType: string; status: string; validCount: number; invalidCount: number; committedCount: number; failedCount: number }; rows: ImportRow[] }

// Ghost/gold-styled download anchors (plain <a> so the browser handles the file download / new tab).
const dlGhost: CSSProperties = { display: "inline-flex", alignItems: "center", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, background: T.card, color: T.ink2, border: `1px solid ${T.border}`, textDecoration: "none" };
const dlGold: CSSProperties = { ...dlGhost, background: T.gold, color: T.goldInk, border: "none" };

export default function DataPage() {
  const { data: me, isLoading } = useApi<WhoAmI>("platform/whoami");
  const allowed = can(me?.permissions, "import_export:view");
  const [tab, setTab] = useState<"import" | "export" | "archive">("import");

  return (
    <AppShell>
      <Page title="Data — import · export · archive" sub="manual template · preprocess script · AI capture — previewed before commit">
        {isLoading && <Loading />}
        {!isLoading && !allowed && <EmptyBox title="You don't have access to data tools" />}

        {allowed && (
          <>
            <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
              {(["import", "export", "archive"] as const).map((t) => (
                <Pill key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Pill>
              ))}
            </div>
            {tab === "import" && <ImportTab />}
            {tab === "export" && <ExportTab />}
            {tab === "archive" && <ArchiveTab />}
          </>
        )}
      </Page>
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
      <Card style={{ marginBottom: 16 }}>
        <div style={{ padding: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="What are you importing?">
              <select value={entity} onChange={(e) => { setEntity(e.target.value); setResult(null); }} style={dcInput}>
                {IMPORT_ENTITIES.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="1. Get the template" hint="Exact headers + a sample row.">
              <a href={`/api/import/template/${entity}`} style={dlGhost}>Download {entity} template ↓</a>
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="2. Upload your filled CSV / Excel" hint="A dry-run preview shows what will be created — nothing is saved yet.">
              <input type="file" accept=".csv,.xlsx,.xls" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} style={{ display: "block", fontSize: 12.5, color: T.ink2 }} />
            </Field>
          </div>
          {err && <div style={{ marginTop: 12 }}><Note>{err}</Note></div>}
        </div>
      </Card>

      {busy && <Loading label="Working…" />}

      {result && (
        <Card>
          <CardHead>{committed ? "Committed" : "Preview"} — {result.batch.entityType.replace("_", " ")}</CardHead>
          <div style={{ padding: 14 }}>
            <StatCards min={130} items={[
              { label: "Valid", value: result.batch.validCount, tone: "green" },
              ...(result.batch.invalidCount > 0 ? [{ label: "Invalid", value: result.batch.invalidCount, tone: "red" as const }] : []),
              ...(committed ? [{ label: "Created", value: result.batch.committedCount, tone: "blue" as const }] : []),
              ...(committed && result.batch.failedCount > 0 ? [{ label: "Failed", value: result.batch.failedCount, tone: "red" as const }] : []),
            ]} />
            <ul style={{ margin: 0, padding: 0, listStyle: "none", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              {result.rows.map((r, i) => (
                <li key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 12px", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>
                  <span style={{ color: T.muted }}>#{r.rowNumber}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <StatusBadge status={r.status} />
                    {r.resolutionJson && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: T.muted }}>
                        {Object.entries(r.resolutionJson).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </span>
                    )}
                    {r.errorsJson && r.errorsJson.length > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: T.red }}>{r.errorsJson.join("; ")}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {!committed && result.batch.validCount > 0 && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <GoldButton type="button" onClick={commit} disabled={busy}>{busy ? "Committing…" : `Commit ${result.batch.validCount} valid row(s)`}</GoldButton>
                <span style={{ fontSize: 11, color: T.muted }}>Creates records through the normal validation + governance, marked &ldquo;added by import&rdquo;.</span>
              </div>
            )}
          </div>
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
      <div style={{ padding: 14 }}>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: T.ink2 }}>Export reflects exactly what you can see in the app — figures you aren&rsquo;t permitted to see are never included.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <Field label="Dataset"><select value={dataset} onChange={(e) => setDataset(e.target.value)} style={dcInput}>{EXPORT_DATASETS.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
          <Field label="Format"><select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")} style={dcInput}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></select></Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <a href={`/api/export/${dataset}?format=${format}`} style={dlGold}>Download {dataset}.{format} ↓</a>
        </div>
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
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <input placeholder="Search archived files…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...dcInput, flex: 1 }} />
        <GoldButton type="button" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Add file"}</GoldButton>
      </div>

      {open && (
        <Card style={{ marginBottom: 16 }}>
          <CardHead>Add a file to the archive</CardHead>
          <form onSubmit={add} style={{ padding: 14, display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="2025 master sheet" style={dcInput} /></Field>
              <Field label="Document date"><input type="date" value={form.docDate} onChange={(e) => setForm({ ...form, docDate: e.target.value })} style={dcInput} /></Field>
              <Field label="Tags (comma-separated)"><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="2025, settlement" style={dcInput} /></Field>
              <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={dcInput} /></Field>
            </div>
            <Field label="File (small) — or a link below (large)">
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: "block", fontSize: 12.5, color: T.ink2 }} />
            </Field>
            <Field label="…or a link (large files)"><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" style={dcInput} /></Field>
            {err && <Note>{err}</Note>}
            <div><GoldButton type="submit" disabled={busy || !form.title.trim()}>{busy ? "Saving…" : "Add to archive"}</GoldButton></div>
          </form>
        </Card>
      )}

      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}
      {data && data.length === 0 && <EmptyBox title="No archived files" hint="Add old sheets, the 2025 file, references." />}
      {data && data.length > 0 && (
        <Card>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {data.map((a, i) => (
              <li key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: T.ink }}>{a.title}</span>
                  {a.docDate && <span style={{ marginLeft: 8, fontSize: 11, color: T.muted }}>{formatDate(a.docDate)}</span>}
                  {a.tags?.length > 0 && <span style={{ marginLeft: 8, display: "inline-flex", gap: 6 }}>{a.tags.map((t) => <Badge key={t} tone="gray">{t}</Badge>)}</span>}
                  {a.description && <div style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: T.muted }}>{a.description}</div>}
                </div>
                {a.fileObjectId && (
                  <a
                    href={a.fileIsLink && a.fileUrl ? a.fileUrl : `/api/files/${a.fileObjectId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: T.blue, textDecoration: "none" }}
                  >
                    open ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
