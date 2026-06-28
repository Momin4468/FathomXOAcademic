"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import {
  can,
  type CustomFieldDef,
  type PartyRow,
  type RefEntity,
  type WhoAmI,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
} from "@/components/ui";

const TARGETS = ["work_item", "party", "project"] as const;
const TYPES = ["text", "number", "date", "select", "bool"] as const;
const TARGET_LABEL: Record<string, string> = { work_item: "Jobs", party: "Parties", project: "Projects" };
const TYPE_LABEL: Record<string, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  bool: "Yes/No",
};

const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};
const searchUnis = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<RefEntity[]>(`reference?kind=university&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.canonical }));
};

export default function CustomFieldsPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canManage = can(me?.permissions, "custom_fields:approve");

  const [target, setTarget] = useState<string>("work_item");
  const { data: defs, error, isLoading, mutate } = useApi<CustomFieldDef[]>(
    `custom-fields?targetEntity=${target}`,
  );

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Custom fields</h1>

      <div className="mb-4 flex gap-2">
        {TARGETS.map((t) => (
          <Button key={t} aria-pressed={t === target} variant={t === target ? "primary" : "secondary"} className="px-3 text-xs" onClick={() => setTarget(t)}>
            {TARGET_LABEL[t]}
          </Button>
        ))}
      </div>

      {canManage && <CreateField target={target} onCreated={mutate} />}

      <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Fields on {TARGET_LABEL[target]}</h2>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {defs && defs.length === 0 && <EmptyState title="No custom fields yet" hint={canManage ? "Define one above." : undefined} />}
      {defs && defs.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {defs.map((d) => (
            <FieldRow key={d.id} def={d} canManage={canManage} onChanged={mutate} />
          ))}
        </ul>
      )}

      <SearchByField target={target} defs={defs ?? []} />
    </AppShell>
  );
}

function CreateField({ target, onCreated }: { target: string; onCreated: () => void }) {
  const [form, setForm] = useState({ fieldName: "", fieldType: "text", required: false, options: "" });
  const [client, setClient] = useState<string | null>(null);
  const [uni, setUni] = useState<string | null>(null);
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fieldName.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const scope: Record<string, string> = {};
      if (client) scope.clientPartyId = client;
      if (uni) scope.universityRefId = uni;
      const body: Record<string, unknown> = {
        targetEntity: target,
        fieldName: form.fieldName.trim(),
        fieldType: form.fieldType,
        required: form.required,
        scope,
      };
      if (form.fieldType === "select") {
        body.options = form.options.split(",").map((s) => s.trim()).filter(Boolean);
      }
      await apiSend("custom-fields", "POST", body);
      setForm({ fieldName: "", fieldType: "text", required: false, options: "" });
      setClient(null);
      setUni(null);
      setResetSeq((n) => n + 1);
      onCreated();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not create field");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <p className="mb-2 text-sm font-semibold text-gray-700">Define a field on {TARGET_LABEL[target]}</p>
      <form onSubmit={add} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Field name"><Input placeholder="e.g. WhatsApp Reference" value={form.fieldName} onChange={(e) => setForm({ ...form, fieldName: e.target.value })} /></Field>
          <Field label="Type">
            <Select value={form.fieldType} onChange={(e) => setForm({ ...form, fieldType: e.target.value })}>
              {TYPES.map((t) => (<option key={t} value={t}>{TYPE_LABEL[t]}</option>))}
            </Select>
          </Field>
          <Field label="Required">
            <label className="flex h-[44px] items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> required (hard at gate)
            </label>
          </Field>
        </div>
        {form.fieldType === "select" && (
          <Field label="Options (comma-separated)"><Input placeholder="Low, Medium, High" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} /></Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Scope: client (optional)"><EntityPicker key={`c${resetSeq}`} placeholder="All clients (global)…" search={searchParties} onPick={(i) => setClient(i?.id ?? null)} /></Field>
          <Field label="Scope: university (optional)"><EntityPicker key={`u${resetSeq}`} placeholder="All universities…" search={searchUnis} onPick={(i) => setUni(i?.id ?? null)} /></Field>
        </div>
        {err && <ErrorNote message={err} />}
        <Button type="submit" disabled={busy || !form.fieldName.trim()}>{busy ? "Saving…" : "Create field"}</Button>
      </form>
    </Card>
  );
}

function FieldRow({ def, canManage, onChanged }: { def: CustomFieldDef; canManage: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const scoped = def.scopeJson && Object.keys(def.scopeJson).length > 0;
  async function archive() {
    setBusy(true);
    try {
      await apiSend(`custom-fields/${def.id}/archive`, "POST");
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function toggleRequired() {
    setBusy(true);
    try {
      await apiSend(`custom-fields/${def.id}`, "PATCH", { required: !def.required });
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="text-sm">
        <span className="font-medium">{def.fieldName}</span>
        <span className="ml-2 inline-flex gap-1">
          <Badge tone="blue">{TYPE_LABEL[def.fieldType] ?? def.fieldType}</Badge>
          {def.required && <Badge tone="amber">required</Badge>}
          {scoped ? <Badge tone="gray">scoped</Badge> : <Badge tone="gray">global</Badge>}
        </span>
        {def.fieldType === "select" && def.optionsJson && (
          <div className="mt-0.5 text-xs text-gray-500">{def.optionsJson.join(" · ")}</div>
        )}
      </div>
      {canManage && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="px-2 text-xs" disabled={busy} onClick={toggleRequired}>
            {def.required ? "make optional" : "make required"}
          </Button>
          <Button variant="danger" className="px-2 text-xs" disabled={busy} onClick={archive}>Archive</Button>
        </div>
      )}
    </li>
  );
}

function SearchByField({ target, defs }: { target: string; defs: CustomFieldDef[] }) {
  const [fieldId, setFieldId] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Array<{ id: string; label: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!fieldId || !q.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const res = await apiGet<Array<{ id: string; label: string }>>(
        `custom-fields/search?targetEntity=${target}&fieldId=${fieldId}&q=${encodeURIComponent(q.trim())}`,
      );
      setRows(res);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <p className="mb-2 text-sm font-semibold text-gray-700">Search {TARGET_LABEL[target]} by a custom field</p>
      <form onSubmit={run} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
          <option value="">Field…</option>
          {defs.map((d) => (<option key={d.id} value={d.id}>{d.fieldName}</option>))}
        </Select>
        <Input placeholder="Value contains…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={busy || !fieldId || !q.trim()}>{busy ? "Searching…" : "Search"}</Button>
      </form>
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
      {rows && (
        rows.length === 0 ? (
          <p className="mt-3 text-xs text-gray-400">No matches.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {rows.map((r) => (
              <li key={r.id} className="py-2 text-sm">{r.label}</li>
            ))}
          </ul>
        )
      )}
    </Card>
  );
}
