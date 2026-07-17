"use client";
import type { CSSProperties } from "react";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
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
  Card,
  CardHead,
  cell,
  DGrid,
  dcInput,
  EmptyBox,
  Field,
  GhostButton,
  GoldButton,
  Loading,
  Note,
  Page,
  Pill,
  StatCards,
  T,
} from "@/components/dc";

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

const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "22px 0 10px" };

export default function CustomFieldsPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canManage = can(me?.permissions, "custom_fields:approve");

  const [target, setTarget] = useState<string>("work_item");
  const { data: defs, error, isLoading, mutate } = useApi<CustomFieldDef[]>(
    `custom-fields?targetEntity=${target}`,
  );

  return (
    <AppShell>
      <Page title="Custom fields" sub="add fields to jobs, parties & projects — no code change">
        <StatCards items={[{ label: `Fields on ${TARGET_LABEL[target]}`, value: defs?.length ?? 0, tone: "gold" }]} />

        <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
          {TARGETS.map((t) => (
            <Pill key={t} active={t === target} onClick={() => setTarget(t)}>
              {TARGET_LABEL[t]}
            </Pill>
          ))}
        </div>

        {canManage && <CreateField target={target} onCreated={mutate} />}

        <h2 style={sectionH}>Fields on {TARGET_LABEL[target]}</h2>
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {defs && defs.length === 0 && <EmptyBox title="No custom fields yet" hint={canManage ? "Define one above." : undefined} />}
        {defs && defs.length > 0 && (
          <DGrid<CustomFieldDef>
            rows={defs}
            keyOf={(d) => d.id}
            minWidth={520}
            cols={[
              {
                label: "Field",
                render: (d) => cell(d.fieldName, { sub: d.fieldType === "select" && d.optionsJson ? d.optionsJson.join(" · ") : undefined }),
              },
              { label: "Type", render: (d) => <Badge tone="blue">{TYPE_LABEL[d.fieldType] ?? d.fieldType}</Badge> },
              {
                label: "Flags",
                render: (d) => {
                  const scoped = d.scopeJson && Object.keys(d.scopeJson).length > 0;
                  return (
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      {d.required && <Badge tone="amber">required</Badge>}
                      <Badge tone="gray">{scoped ? "scoped" : "global"}</Badge>
                    </span>
                  );
                },
              },
              ...(canManage
                ? [{ label: "", align: "right" as const, render: (d: CustomFieldDef) => <FieldManage def={d} onChanged={mutate} /> }]
                : []),
            ]}
          />
        )}

        <SearchByField target={target} defs={defs ?? []} />
      </Page>
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
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fieldName.trim()) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not create field") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead>Define a field on {TARGET_LABEL[target]}</CardHead>
      <form onSubmit={add} style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label="Field name" error={fieldErrs.fieldName}><input placeholder="e.g. WhatsApp Reference" value={form.fieldName} onChange={(e) => setForm({ ...form, fieldName: e.target.value })} style={dcInput} /></Field>
          <Field label="Type" error={fieldErrs.fieldType}>
            <select value={form.fieldType} onChange={(e) => setForm({ ...form, fieldType: e.target.value })} style={dcInput}>
              {TYPES.map((t) => (<option key={t} value={t}>{TYPE_LABEL[t]}</option>))}
            </select>
          </Field>
          <Field label="Required" error={fieldErrs.required}>
            <label style={{ display: "flex", height: 36, alignItems: "center", gap: 8, fontSize: 12.5, color: T.ink2 }}>
              <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> required (hard at gate)
            </label>
          </Field>
        </div>
        {form.fieldType === "select" && (
          <Field label="Options (comma-separated)" error={fieldErrs.options}><input placeholder="Low, Medium, High" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} style={dcInput} /></Field>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <Field label="Scope: client (optional)"><EntityPicker key={`c${resetSeq}`} placeholder="All clients (global)…" search={searchParties} onPick={(i) => setClient(i?.id ?? null)} /></Field>
          <Field label="Scope: university (optional)"><EntityPicker key={`u${resetSeq}`} placeholder="All universities…" search={searchUnis} onPick={(i) => setUni(i?.id ?? null)} /></Field>
        </div>
        {err && <Note>{err}</Note>}
        <div><GoldButton type="submit" disabled={busy || !form.fieldName.trim()}>{busy ? "Saving…" : "Create field"}</GoldButton></div>
      </form>
    </Card>
  );
}

function FieldManage({ def, onChanged }: { def: CustomFieldDef; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
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
    <span style={{ display: "inline-flex", gap: 8, whiteSpace: "nowrap" }}>
      <GhostButton type="button" disabled={busy} onClick={toggleRequired}>
        {def.required ? "make optional" : "make required"}
      </GhostButton>
      <GhostButton type="button" danger disabled={busy} onClick={archive}>Archive</GhostButton>
    </span>
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
    <Card style={{ marginTop: 16 }}>
      <CardHead>Search {TARGET_LABEL[target]} by a custom field</CardHead>
      <div style={{ padding: 14 }}>
        <form onSubmit={run} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <select value={fieldId} onChange={(e) => setFieldId(e.target.value)} style={dcInput}>
            <option value="">Field…</option>
            {defs.map((d) => (<option key={d.id} value={d.id}>{d.fieldName}</option>))}
          </select>
          <input placeholder="Value contains…" value={q} onChange={(e) => setQ(e.target.value)} style={dcInput} />
          <GhostButton type="submit" disabled={busy || !fieldId || !q.trim()}>{busy ? "Searching…" : "Search"}</GhostButton>
        </form>
        {err && <div style={{ marginTop: 10 }}><Note>{err}</Note></div>}
        {rows && (
          rows.length === 0 ? (
            <p style={{ marginTop: 12, fontSize: 11.5, color: T.muted }}>No matches.</p>
          ) : (
            <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none" }}>
              {rows.map((r, i) => (
                <li key={r.id} style={{ padding: "8px 0", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>{r.label}</li>
              ))}
            </ul>
          )
        )}
      </div>
    </Card>
  );
}
