"use client";
import type { CSSProperties } from "react";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate, sanitizeAmount } from "@/lib/format";
import {
  can,
  type Channel,
  type JobProfitShares,
  type PartyRow,
  type ProfitShareTerm,
  type WhoAmI,
  type WorkListRow,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import {
  Badge,
  Card,
  CardHead,
  dcInput,
  EmptyBox,
  Field,
  GhostButton,
  Loading,
  money,
  Note,
  Page,
  StatCards,
  T,
} from "@/components/dc";

const today = () => new Date().toISOString().slice(0, 10);
const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};
const searchChannels = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=channel`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: "channel" }));
};

const BASIS_LABELS: Record<string, string> = {
  pct_of_net: "% of net profit",
  pct_after_writer: "% after writer pay",
  pct_of_channel: "% of channel earnings",
  fixed: "fixed amount",
};

const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "0 0 6px" };
const sectionSub: CSSProperties = { margin: "0 0 12px", fontSize: 11.5, color: T.muted, maxWidth: 640 };
const formGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };

function MoneyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 9, top: 0, bottom: 0, display: "flex", alignItems: "center", fontSize: 12.5, color: T.muted2, pointerEvents: "none" }}>৳</span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(sanitizeAmount(e.target.value))} style={{ ...dcInput, paddingLeft: 20, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
    </div>
  );
}
function PctField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ position: "relative" }}>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(sanitizeAmount(e.target.value))} style={{ ...dcInput, paddingRight: 20, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
      <span style={{ position: "absolute", right: 9, top: 0, bottom: 0, display: "flex", alignItems: "center", fontSize: 12.5, color: T.muted2, pointerEvents: "none" }}>%</span>
    </div>
  );
}

export default function ChannelsPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canApprove = can(me?.permissions, "channels:approve");
  // Summary figures (SWR dedupes these with the child components' fetches).
  const { data: channels } = useApi<Channel[]>(canApprove ? "channels" : null);
  const { data: terms } = useApi<ProfitShareTerm[]>(canApprove ? "channels/profit-shares" : null);

  if (me && !canApprove) {
    return (
      <AppShell>
        <Page title="Channels">
          <EmptyBox title="No access to channel management" hint="See your own profit share under “My share”." />
        </Page>
      </AppShell>
    );
  }

  const activeCount = (channels ?? []).filter((c) => c.isActive).length;

  return (
    <AppShell>
      <Page title="Channels & profit-share" sub="sources, N-way profit splits & per-job pools">
        <StatCards items={[
          { label: "Channels", value: channels?.length ?? 0, tone: "gold", note: `${activeCount} active` },
          { label: "Profit-share terms", value: terms?.length ?? 0, tone: "purple", note: "owners / investors" },
        ]} />
        <ChannelsManager />
        <ProfitShareTerms />
        <JobPoolViewer />
      </Page>
    </AppShell>
  );
}

// ─── Channels: list + create + archive ────────────────────────────────────────
function ChannelsManager() {
  const { data: channels, error, isLoading, mutate } = useApi<Channel[]>("channels");
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={sectionH}>Sources</h2>
      <p style={sectionSub}>
        A channel is an admin-defined source (Web, Facebook, …). Set who controls it — the business, or a person who
        takes its residual margin. Add or tune one anytime; no code change needed.
      </p>
      <AddChannel onAdded={mutate} />
      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}
      {channels && channels.length === 0 && <div style={{ marginTop: 12 }}><EmptyBox title="No channels yet" hint="Add one above." /></div>}
      {channels && channels.length > 0 && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {channels.map((c) => (
            <ChannelRow key={c.id} channel={c} onChange={mutate} />
          ))}
        </div>
      )}
    </section>
  );
}

function AddChannel({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [medium, setMedium] = useState("");
  const [controllerPartyId, setControllerPartyId] = useState<string | null>(null);
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !medium.trim()) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend("channels", "POST", {
        name: name.trim(),
        medium: medium.trim(),
        controllerPartyId: controllerPartyId ?? undefined,
      });
      setName("");
      setMedium("");
      setControllerPartyId(null);
      setResetSeq((n) => n + 1);
      onAdded();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not add channel") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead>Add a channel</CardHead>
      <form onSubmit={add} style={{ padding: 14, ...formGrid }}>
        <Field label="Name" error={fieldErrs.name}>
          <input placeholder="e.g. Web" value={name} onChange={(e) => setName(e.target.value)} style={dcInput} />
        </Field>
        <Field label="Medium" error={fieldErrs.medium}>
          <input placeholder="e.g. web / facebook" value={medium} onChange={(e) => setMedium(e.target.value)} style={dcInput} />
        </Field>
        <Field label="Controller (blank = the business)" error={fieldErrs.controllerPartyId}>
          <EntityPicker key={resetSeq} placeholder="Business (default)…" search={searchParties} onPick={(i) => setControllerPartyId(i?.id ?? null)} />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <GhostButton type="submit" disabled={busy || !name.trim() || !medium.trim()}>
            {busy ? "Adding…" : "Add channel"}
          </GhostButton>
        </div>
        {err && <div style={{ gridColumn: "1 / -1" }}><Note>{err}</Note></div>}
      </form>
    </Card>
  );
}

function ChannelRow({ channel, onChange }: { channel: Channel; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      await apiSend(`channels/${channel.id}`, "PATCH", body);
      onChange();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive the “${channel.name}” channel?`)) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend(`channels/${channel.id}`, "DELETE");
      onChange();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not archive");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{channel.name}</span>
          <Badge tone="gray">{channel.medium}</Badge>
          {!channel.isActive && <Badge tone="amber">inactive</Badge>}
          <span style={{ fontSize: 11, color: T.muted }}>
            controller: {channel.controllerName ?? "the business"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GhostButton type="button" disabled={busy} onClick={() => patch({ isActive: !channel.isActive })}>
            {channel.isActive ? "Deactivate" : "Activate"}
          </GhostButton>
          <GhostButton type="button" danger disabled={busy} onClick={archive}>
            Archive
          </GhostButton>
        </div>
      </div>
      {err && <div style={{ marginTop: 10 }}><Note>{err}</Note></div>}
    </Card>
  );
}

// ─── Profit-share terms (N-way owner/investor shares + dividends) ──────────────
function ProfitShareTerms() {
  const { data: terms, error, isLoading, mutate } = useApi<ProfitShareTerm[]>("channels/profit-shares");
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={sectionH}>Profit-share &amp; dividends</h2>
      <p style={sectionSub}>
        Give any owner/investor/partner a date-versioned share of the profit pool. The formula (basis) and rate are both
        configurable; old jobs keep their old terms. A standing (default) share is an owner dividend — it applies to
        every job automatically.
      </p>
      <AddProfitShareTerm onAdded={mutate} />
      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}
      {terms && terms.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12.5 }}>
            {terms.map((t, i) => (
              <li key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderTop: i ? `1px solid ${T.hair}` : undefined }}>
                <span>
                  <span style={{ fontWeight: 600, color: T.ink }}>{t.toPartyName ?? "—"}</span>{" "}
                  <span style={{ color: T.muted }}>
                    {t.basis === "fixed" ? <>fixed {money(Number(t.value))}</> : `${t.value}% — ${BASIS_LABELS[t.basis ?? ""] ?? t.basis}`}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {t.appliesTo.startsWith("source:") ? "channel-scoped" : "standing dividend"} · from {formatDate(t.effectiveFrom)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function AddProfitShareTerm({ onAdded }: { onAdded: () => void }) {
  const [toPartyId, setToPartyId] = useState<string | null>(null);
  const [basis, setBasis] = useState("pct_after_writer");
  const [value, setValue] = useState("");
  const [sourcePartyId, setSourcePartyId] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const isNetBasis = basis === "pct_of_net" || basis === "pct_after_writer";
  const showOpacityHint = isNetBasis && !sourcePartyId;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!toPartyId || !value) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend("channels/profit-shares", "POST", {
        toPartyId,
        basis,
        value: Number(value),
        sourcePartyId: sourcePartyId ?? undefined,
        effectiveFrom,
      });
      setToPartyId(null);
      setValue("");
      setSourcePartyId(null);
      setResetSeq((n) => n + 1);
      onAdded();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not save share") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead>Add a profit share</CardHead>
      <form onSubmit={add} style={{ padding: 14, ...formGrid }}>
        <Field label="Beneficiary" error={fieldErrs.toPartyId}>
          <EntityPicker key={`b${resetSeq}`} placeholder="Search owner/investor…" search={searchParties} onPick={(i) => setToPartyId(i?.id ?? null)} />
        </Field>
        <Field label="Basis (the formula)" error={fieldErrs.basis}>
          <select value={basis} onChange={(e) => setBasis(e.target.value)} style={dcInput}>
            <option value="pct_after_writer">% after writer pay</option>
            <option value="pct_of_net">% of net profit</option>
            <option value="pct_of_channel">% of channel earnings</option>
            <option value="fixed">fixed amount</option>
          </select>
        </Field>
        <Field label={basis === "fixed" ? "Amount (৳)" : "Percent (%)"} error={fieldErrs.value}>
          {basis === "fixed"
            ? <MoneyField value={value} onChange={(v) => setValue(v)} />
            : <PctField value={value} onChange={(v) => setValue(v)} />}
        </Field>
        <Field label="Scope to a channel (blank = standing dividend)" error={fieldErrs.sourcePartyId}>
          <EntityPicker key={`s${resetSeq}`} placeholder="All jobs (default)…" search={searchChannels} onPick={(i) => setSourcePartyId(i?.id ?? null)} />
        </Field>
        <Field label="Effective from" error={fieldErrs.effectiveFrom}>
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} style={dcInput} />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          {showOpacityHint && (
            <div style={{ marginBottom: 10 }}>
              <Note tone="amber">
                A standing net-profit dividend is allowed only for a non-partner silent investor — for an active partner it
                could reveal the other partner’s private margin (§4.4). For a partner, scope it to a channel or use a fixed
                amount. The server will reject a disallowed combination.
              </Note>
            </div>
          )}
          {err && <div style={{ marginBottom: 10 }}><Note>{err}</Note></div>}
          <GhostButton type="submit" disabled={busy || !toPartyId || !value}>
            {busy ? "Saving…" : "Save share"}
          </GhostButton>
        </div>
      </form>
    </Card>
  );
}

// ─── Per-job pool view (money — admins) ────────────────────────────────────────
function JobPoolViewer() {
  const { data: works } = useApi<WorkListRow[]>("work");
  const [workItemId, setWorkItemId] = useState("");
  const [result, setResult] = useState<JobProfitShares | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load(id: string) {
    setWorkItemId(id);
    setResult(null);
    setErr("");
    if (!id) return;
    setBusy(true);
    try {
      setResult(await apiGet<JobProfitShares>(`channels/jobs/${id}/profit-shares`));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not load");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={sectionH}>How a job’s profit divides</h2>
      <Card style={{ padding: 14 }}>
        <Field label="Job">
          <select value={workItemId} onChange={(e) => load(e.target.value)} style={dcInput}>
            <option value="">Select a job…</option>
            {(works ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.title}</option>
            ))}
          </select>
        </Field>
        {busy && <Loading />}
        {err && <div style={{ marginTop: 12 }}><Note>{err}</Note></div>}
        {result && (
          <div style={{ marginTop: 14, fontSize: 12.5 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: T.muted }}>profit pool (after writer pay)</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(result.pool)}</span>
            </div>
            {result.overAllocated && (
              <div style={{ marginBottom: 8 }}>
                <Note>Shares exceed the pool — review the configured rates.</Note>
              </div>
            )}
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {result.cuts.map((c, i) => (
                <li key={c.toPartyId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderTop: i ? `1px solid ${T.hair}` : undefined }}>
                  <span>
                    {c.toPartyName ?? c.toPartyId}{" "}
                    <span style={{ fontSize: 11, color: T.muted }}>
                      ({c.basis === "fixed" ? "fixed" : `${c.rate}% of ${c.base}`})
                    </span>
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(c.amount)}</span>
                </li>
              ))}
              <li style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderTop: `1px solid ${T.hair}`, color: T.ink2 }}>
                <span>residual → {result.residualOwner?.name ?? "the business"}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(result.residual)}</span>
              </li>
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}
