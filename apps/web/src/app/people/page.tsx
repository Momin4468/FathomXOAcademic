"use client";
import Link from "next/link";
import { useState } from "react";
import type { CSSProperties } from "react";
import { useSWRConfig } from "swr";
import { apiGet, useApi } from "@/lib/api";
import { type PartyRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PartyForm, type PartyFormInitial } from "@/components/PartyForm";
import { Badge, Card, CardHead, DGrid, GoldButton, Page, T, cell, dcInput } from "@/components/dc";

const TYPES = ["writer", "vendor", "partner", "referrer", "client", "employee"] as const;

const labelStyle: CSSProperties = {
  display: "block", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: T.muted, marginBottom: 5,
};

/**
 * People directory (Phase 3) — full CRUD over every party type (writers, vendors,
 * partners, referrers, …), closing the master-data gap that previously left these
 * creatable only implicitly at job intake. Reuses POST/PATCH /parties. Recreated to
 * the `Business OS v5` design handoff (generic grid + capture-first create panel).
 */
export default function PeoplePage() {
  const { mutate } = useSWRConfig();
  const [type, setType] = useState<string>("writer");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PartyFormInitial | null>(null);
  const key = `parties?type=${type}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
  const { data, error, isLoading } = useApi<PartyRow[]>(key);

  function refresh() {
    setCreating(false);
    setEditing(null);
    void mutate(key);
  }
  async function openEdit(id: string) {
    const p = await apiGet<PartyFormInitial>(`parties/${id}`);
    setCreating(false);
    setEditing(p);
  }

  return (
    <AppShell>
      <Page
        title="People"
        sub="team & partners — writers, vendors, referrers, clients"
        action={!creating && !editing ? <GoldButton onClick={() => setCreating(true)}>+ New person</GoldButton> : undefined}
      >
        {(creating || editing) && (
          <Card style={{ marginBottom: 16 }}>
            <CardHead>{editing ? "Edit person" : "New person"}</CardHead>
            <div style={{ padding: "14px 16px" }}>
              <PartyForm
                initial={editing ?? undefined}
                presetType={editing ? undefined : type}
                onSaved={refresh}
                onCancel={() => { setCreating(false); setEditing(null); }}
              />
            </div>
          </Card>
        )}

        <Card style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "minmax(150px, 220px) 1fr", gap: 12 }}>
            <div>
              <span style={labelStyle}>Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...dcInput, textTransform: "capitalize" }}>
                {TYPES.map((t) => <option key={t} value={t} style={{ textTransform: "capitalize" }}>{t}</option>)}
              </select>
            </div>
            <div>
              <span style={labelStyle}>Search</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" style={dcInput} />
            </div>
          </div>
        </Card>

        {isLoading && <div style={{ padding: "20px 4px", fontSize: 12.5, color: T.muted2 }}>Loading…</div>}
        {error && (
          <div style={{ background: T.redBg, color: T.red, border: "1px solid #F3C9C3", borderRadius: 8, padding: "8px 11px", fontSize: 12, fontWeight: 500 }}>
            {error.message}
          </div>
        )}
        {data && (
          <DGrid<PartyRow>
            rows={data}
            keyOf={(p) => p.id}
            empty={`No ${type}s found`}
            search
            exportName="people"
            cols={[
              {
                label: "Name",
                text: (p) => p.displayName,
                render: (p) => (
                  <Link href={`/people/${p.id}`} style={{ color: T.goldDeep, fontWeight: 600, textDecoration: "none" }}>{p.displayName}</Link>
                ),
              },
              {
                label: "Type",
                text: (p) => (p.partyType ?? []).join(", "),
                render: (p) => (
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(p.partyType ?? []).map((t) => <Badge key={t} tone="gray">{t}</Badge>)}
                  </span>
                ),
              },
              {
                label: "Ref",
                text: (p) => p.externalRef ?? "",
                render: (p) => (p.externalRef ? cell(p.externalRef, { mono: true }) : <span style={{ color: T.muted2 }}>—</span>),
              },
            ]}
            actions={[{ label: "Edit", onClick: (p) => void openEdit(p.id), color: T.goldDeep }]}
          />
        )}
      </Page>
    </AppShell>
  );
}
