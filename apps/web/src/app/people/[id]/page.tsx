"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { CSSProperties } from "react";
import { useApi } from "@/lib/api";
import { can, type PartyDetail, type WhoAmI, type WorkListRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PartyForm, type PartyFormInitial } from "@/components/PartyForm";
import {
  Badge, Card, CardHead, cell, DGrid, EmptyBox, GhostButton, Loading, money, Note,
  Page, StatCards, T, fmtDay, type DCol, type Stat, type Tone,
} from "@/components/dc";

/**
 * Person record — the consolidated "Team & partners" 360, recreated to the
 * `Business OS v5` handoff. One party is multi-hat (Khalid sources AND writes), so
 * the record shows a facet PER hat: a work log for a writer/employee, sourced jobs
 * for a partner/referrer, a Client 360 link, vendor claims, and a running-balance
 * ledger. Money is gated + §4.4 opacity-safe (the read model only fills money the
 * caller may see; the balance register endpoint is RLS-scoped to visible legs).
 */
interface RegRow { date: string; kind: string; ref: string | null; delta: number; running: number }
interface Reg { rows: RegRow[]; net: number }

const HAT_TONE: Record<string, Tone> = {
  writer: "blue", employee: "blue", partner: "green", referrer: "green", client: "amber", vendor: "gray",
};
const STATE_TONE: Record<string, Tone> = { delivered: "green", confirmed: "blue", pending: "amber", draft: "gray" };
const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "0 0 10px" };

export default function PersonRecordPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const perms = me?.permissions;
  const canWork = can(perms, "work:view");
  const canMoney = can(perms, "billing:view");
  const canEdit = can(perms, "reference:edit");

  const { data: party, error, isLoading, mutate } = useApi<PartyDetail>(`parties/${id}`);
  const [editing, setEditing] = useState(false);

  const hats = party?.partyType ?? [];
  const isDoer = hats.includes("writer") || hats.includes("employee");
  const isSource = hats.includes("partner") || hats.includes("referrer");
  const isClient = hats.includes("client");
  const isVendor = hats.includes("vendor");

  const { data: jobsDone } = useApi<WorkListRow[]>(party && canWork && isDoer ? `work?doerPartyId=${id}` : null);
  const { data: jobsSourced } = useApi<WorkListRow[]>(party && canWork && isSource ? `work?sourcePartyId=${id}` : null);
  const regGate = canMoney && (isDoer || isSource || isVendor);
  const { data: reg } = useApi<Reg>(party && regGate ? `billing/register/${id}` : null);

  const contact = (party?.contact ?? {}) as Record<string, unknown>;
  const email = typeof contact.email === "string" ? contact.email : null;
  const phone = typeof contact.phone === "string" ? contact.phone : null;

  const meta = party ? [party.universityCanonical, party.programme, party.externalRef ? `Ref ${party.externalRef}` : null].filter(Boolean).join(" · ") : "";

  const stats: Stat[] = [];
  if (isDoer) stats.push({ label: "Jobs done", value: jobsDone?.length ?? "—", tone: "blue" });
  if (isSource) stats.push({ label: "Jobs sourced", value: jobsSourced?.length ?? "—", tone: "green" });
  if (regGate && reg) stats.push({ label: "Net balance", value: money(reg.net), tone: reg.net < 0 ? "red" : "gold", note: reg.net < 0 ? "they owe / were paid" : "owed to them" });

  return (
    <AppShell>
      <Link href="/people" style={{ fontSize: 12, fontWeight: 600, color: T.goldDeep, textDecoration: "none", display: "inline-block", marginBottom: 4 }}>← Team &amp; partners</Link>
      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}
      {!isLoading && !error && !party && <EmptyBox title="Person not found" />}

      {party && (
        <Page
          title={party.displayName}
          sub={meta || undefined}
          action={canEdit && !editing ? <GhostButton onClick={() => setEditing(true)}>Edit</GhostButton> : undefined}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8 }}>
            {hats.map((t) => <Badge key={t} tone={HAT_TONE[t] ?? "gray"}>{t}</Badge>)}
            {hats.length === 0 && <span style={{ fontSize: 11, color: T.muted2 }}>no type set</span>}
          </div>
          <div style={{ fontSize: 12, color: T.muted2, marginBottom: 16 }}>
            One record per person — each hat they wear surfaces the work and money that matters for that role.
          </div>

          {editing && canEdit ? (
            <Card>
              <CardHead>Edit person</CardHead>
              <div style={{ padding: "14px 16px" }}>
                <PartyForm
                  initial={{
                    id: party.id,
                    displayName: party.displayName,
                    partyType: party.partyType,
                    externalRef: party.externalRef,
                    universityId: party.universityId,
                    programme: party.programme,
                    contact: party.contact ?? null,
                    ownerPartyId: party.ownerPartyId ?? null,
                    ownerName: party.ownerName ?? null,
                  } satisfies PartyFormInitial}
                  onSaved={() => { setEditing(false); void mutate(); }}
                  onCancel={() => setEditing(false)}
                />
              </div>
            </Card>
          ) : (
            <>
              {stats.length > 0 && <StatCards min={180} items={stats} />}

              {/* Identity + contact */}
              <Card style={{ marginBottom: 16 }}>
                <CardHead>Details</CardHead>
                <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                  <Detail label="Ref / student ID" value={party.externalRef} />
                  <Detail label="University" value={party.universityCanonical} />
                  <Detail label="Programme" value={party.programme} />
                  <Detail label="Referred by" value={party.referredByName} />
                  <Detail label="Email" value={email} />
                  <Detail label="Phone" value={phone} />
                </div>
                {party.customFields.length > 0 && (
                  <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.eyebrow}`, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                    {party.customFields.map((f) => (
                      <Detail key={f.id} label={`${f.fieldName}${f.required ? " *" : ""}`} value={f.value == null || f.value === "" ? null : String(f.value)} />
                    ))}
                  </div>
                )}
              </Card>

              {isClient && (
                <Card style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Client account</div>
                      <div style={{ fontSize: 11.5, color: T.muted2, marginTop: 2 }}>This person is also a client — invoices, balance &amp; portal live on the Client 360.</div>
                    </div>
                    <GhostButton href={`/clients/${id}`}>Open Client 360 →</GhostButton>
                  </div>
                </Card>
              )}

              {isDoer && (
                <JobsGrid title="Work log — jobs done" empty="No jobs done yet" jobs={jobsDone} canMoney={canMoney} moneyLabel="you're owed" moneyField="writerAmount" />
              )}
              {isSource && (
                <JobsGrid title="Jobs sourced" empty="No sourced jobs yet" jobs={jobsSourced} canMoney={canMoney} moneyLabel="client" moneyField="clientAmount" />
              )}

              {isVendor && (
                <Card style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Vendor claims</div>
                      <div style={{ fontSize: 11.5, color: T.muted2, marginTop: 2 }}>Handoffs &amp; claims this vendor has billed us for.</div>
                    </div>
                    {can(perms, "vendor:approve") && <GhostButton href="/vendor-admin">Open vendor claims →</GhostButton>}
                  </div>
                </Card>
              )}

              {/* Money — running balance register (gated + RLS-scoped) */}
              {regGate && <BalanceRegister reg={reg} />}
            </>
          )}
        </Page>
      )}
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = value == null || value === "";
  return (
    <div>
      <div style={{ fontSize: 10.5, color: T.muted }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: empty ? T.muted2 : T.ink }}>{empty ? "—" : value}</div>
    </div>
  );
}

/** A compact spreadsheet-style job list; a money column shows only when present. */
function JobsGrid({
  title, empty, jobs, canMoney, moneyLabel, moneyField,
}: {
  title: string;
  empty: string;
  jobs: WorkListRow[] | undefined;
  canMoney: boolean;
  moneyLabel: string;
  moneyField: "writerAmount" | "clientAmount";
}) {
  const cols: DCol<WorkListRow>[] = [
    { label: "Code", width: 90, render: (j) => j.courseCode ? cell(j.courseCode, { mono: true }) : <span style={{ color: T.muted2 }}>—</span> },
    {
      label: "Task",
      render: (j) => (
        <Link href={`/work/${j.id}`} style={{ color: T.ink, fontWeight: 500, textDecoration: "none", display: "block" }}>
          {j.title}
          <span style={{ display: "block", fontSize: 10.5, color: T.muted2 }}>
            {[j.wordCount ? `${j.wordCount} words` : null, j.unitLabel].filter(Boolean).join(" · ") || "—"}
          </span>
        </Link>
      ),
    },
    { label: "State", align: "center", render: (j) => <Badge tone={STATE_TONE[j.workState] ?? "gray"}>{j.workState}</Badge> },
  ];
  if (canMoney) {
    cols.push({
      label: moneyLabel,
      align: "right",
      render: (j) => {
        const amt = j[moneyField];
        return amt != null ? cell(money(amt), { nums: true, weight: 600 }) : <span style={{ color: T.muted2 }}>—</span>;
      },
    });
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={sectionH}>{title}</h2>
      <DGrid<WorkListRow> cols={cols} rows={jobs ?? []} keyOf={(j) => j.id} minWidth={canMoney ? 520 : 420} empty={empty} />
    </div>
  );
}

/**
 * QuickBooks-style running-balance register — time-ordered legs with a running
 * balance. `+` = owed to the party, `−` = they owe / were paid. Opacity-safe (the
 * endpoint scopes to the caller's visible legs).
 */
function BalanceRegister({ reg }: { reg: Reg | undefined }) {
  const rows = (reg?.rows ?? []).map((r, i) => ({ ...r, _k: String(i) }));
  type Row = (typeof rows)[number];
  const cols: DCol<Row>[] = [
    { label: "Date", width: 96, render: (r) => cell(fmtDay(r.date), { color: T.muted }) },
    { label: "Entry", render: (r) => <span>{r.kind}{r.ref ? <span style={{ color: T.muted2, marginLeft: 4 }}>· {r.ref}</span> : null}</span> },
    { label: "Amount", align: "right", render: (r) => cell(`${r.delta < 0 ? "−" : "+"}${money(Math.abs(r.delta))}`, { nums: true, weight: 600, color: r.delta < 0 ? T.red : T.green }) },
    { label: "Balance", align: "right", render: (r) => cell(money(r.running), { nums: true, weight: 600 }) },
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={sectionH}>Balance register</h2>
      <DGrid<Row>
        cols={cols}
        rows={rows}
        keyOf={(r) => r._k}
        minWidth={480}
        empty="No ledger entries yet."
        foot={reg ? <span>Balance <b style={{ color: T.ink }}>{money(reg.net)}</b> · <span style={{ color: T.muted }}>+ owed to them · − they owe or were paid. Appended, never edited.</span></span> : undefined}
      />
    </div>
  );
}
