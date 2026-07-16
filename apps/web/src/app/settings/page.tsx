"use client";
import { useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { TERM_TYPES } from "@business-os/shared";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { can, type PartyRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataGrid, type DataGridColumn } from "@/components/DataGrid";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { useToast } from "@/components/toast";

interface DealTerm {
  id: string;
  fromPartyId: string | null;
  toPartyId: string | null;
  appliesTo: string;
  termType: string;
  basis: string | null;
  value: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

const PCT_TYPES = new Set(["split_pct", "commission_pct", "referral_pct", "profit_share"]);
const searchParty = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: (r.partyType ?? []).join(", ") }));
};

/**
 * Settings (handoff §21) — the future-proofing layer. Its load-bearing tab is
 * **Split terms**: each party/relationship's deal, EFFECTIVE-DATED so a past job
 * keeps its era's terms (a change is a new dated term, never an edit — §3.5).
 * Editing a party's usual term here is what pre-fills the per-task cut. Other
 * config surfaces are linked below.
 */
export default function SettingsPage() {
  const { mutate } = useSWRConfig();
  const { toast } = useToast();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canView = can(me?.permissions, "rules:view");
  const canCreate = can(me?.permissions, "rules:create");

  const key = "deal-terms";
  const { data: terms, isLoading } = useApi<DealTerm[]>(canView ? key : null);

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [termType, setTermType] = useState<string>("split_pct");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function addTerm() {
    if (!toId || !(Number(value) >= 0)) return;
    setBusy(true);
    try {
      await apiSend("deal-terms", "POST", {
        fromPartyId: fromId ?? undefined,
        toPartyId: toId,
        termType,
        value: Number(value),
        effectiveFrom: from,
      });
      setValue(""); setToId(null); setFromId(null);
      await mutate(key);
      toast({ title: "Split term added", description: "Effective-dated — past jobs keep their era's terms.", variant: "success" });
    } catch (e) {
      toast({ title: "Could not add", description: e instanceof Error ? e.message : "", variant: "error" });
    } finally { setBusy(false); }
  }

  const columns: DataGridColumn<DealTerm>[] = [
    { key: "fromPartyId", label: "From", render: (r) => (r.fromPartyId ? <PartyName id={r.fromPartyId} /> : <span className="text-slate-500">business</span>) },
    { key: "toPartyId", label: "To", render: (r) => (r.toPartyId ? <PartyName id={r.toPartyId} /> : <span className="text-slate-500">—</span>) },
    { key: "appliesTo", label: "Applies to", render: (r) => <Badge tone="gray">{r.appliesTo}</Badge> },
    { key: "termType", label: "Type", render: (r) => <Badge tone="purple">{r.termType.replace(/_/g, " ")}</Badge> },
    { key: "value", label: "Value", align: "right", render: (r) => <span className="tabular-nums">{PCT_TYPES.has(r.termType) ? `${Number(r.value)}%` : `৳${Number(r.value)}`}</span> },
    { key: "effectiveFrom", label: "Effective", render: (r) => <span className="text-xs text-slate-400">{formatDate(r.effectiveFrom)}{r.effectiveTo ? ` → ${formatDate(r.effectiveTo)}` : " → open"}</span> },
  ];

  const configLinks = [
    { href: "/custom-fields", label: "Custom fields", perm: "custom_fields:view" },
    { href: "/channels", label: "Channels", perm: "channels:approve" },
    { href: "/roles", label: "Roles & permissions", perm: "platform:view" },
    { href: "/users", label: "Users", perm: "platform:view" },
    { href: "/reference-data", label: "Academic / reference governance", perm: "reference:view" },
  ].filter((l) => can(me?.permissions, l.perm));

  return (
    <AppShell>
      <DataGrid<DealTerm>
        title="Settings · Split terms"
        sub="Each party/relationship's deal — effective-dated so old jobs keep their era's terms. A change is a NEW dated term, never an edit."
        columns={columns}
        rows={terms}
        getRowId={(r) => r.id}
        isAdmin={canCreate}
        loading={isLoading}
        emptyTitle="No split terms yet"
        addButton="+ Add split term"
        addForm={
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]"><Field label="From (blank = business)"><EntityPicker placeholder="Search party…" search={searchParty} onPick={(i) => setFromId(i?.id ?? null)} /></Field></div>
            <div className="min-w-[180px]"><Field label="To (beneficiary)" required><EntityPicker placeholder="Search party…" search={searchParty} onPick={(i) => setToId(i?.id ?? null)} /></Field></div>
            <Field label="Type"><Select value={termType} onChange={(e) => setTermType(e.target.value)} className="w-auto">{TERM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</Select></Field>
            <Field label={PCT_TYPES.has(termType) ? "Value %" : "Value ৳"}><Input value={value} onChange={(e) => setValue(e.target.value)} className="w-24 text-right" inputMode="decimal" /></Field>
            <Field label="Effective from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Button disabled={busy || !toId || !(Number(value) >= 0)} onClick={addTerm}>{busy ? "Adding…" : "Add"}</Button>
          </div>
        }
        foot="Your deal with a partner is yours alone; you don't manage their deals with their own vendors. Terms are append-only — supersede to change, never mutate history."
      />
      {configLinks.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Other settings</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {configLinks.map((l) => (
              <li key={l.href}><Link href={l.href} className="rounded-lg border border-ink-700 px-3 py-1.5 text-gold-600 hover:bg-ink-800 dark:text-gold-400">{l.label} →</Link></li>
            ))}
          </ul>
        </div>
      )}
    </AppShell>
  );
}
