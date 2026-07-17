"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate } from "@/lib/format";
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
  Button,
  Card,
  DateInput,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Money,
  MoneyInput,
  PercentInput,
  Select,
  Spinner,
} from "@/components/ui";

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

export default function ChannelsPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canApprove = can(me?.permissions, "channels:approve");

  if (me && !canApprove) {
    return (
      <AppShell>
        <h1 className="mb-3 text-lg font-semibold tracking-tight">Channels</h1>
        <EmptyState title="No access to channel management" hint="See your own profit share under “My share”." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Channels &amp; profit-share</h1>
      <ChannelsManager />
      <ProfitShareTerms />
      <JobPoolViewer />
    </AppShell>
  );
}

// ─── Channels: list + create + archive ────────────────────────────────────────
function ChannelsManager() {
  const { data: channels, error, isLoading, mutate } = useApi<Channel[]>("channels");
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Sources</h2>
      <p className="mb-3 text-xs text-slate-400">
        A channel is an admin-defined source (Web, Facebook, …). Set who controls it — the business, or a person who
        takes its residual margin. Add or tune one anytime; no code change needed.
      </p>
      <AddChannel onAdded={mutate} />
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {channels && channels.length === 0 && <EmptyState title="No channels yet" hint="Add one above." />}
      {channels && channels.length > 0 && (
        <div className="mt-3 space-y-2">
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
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add a channel</h2>
      <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Name" error={fieldErrs.name}>
          <Input placeholder="e.g. Web" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Medium" error={fieldErrs.medium}>
          <Input placeholder="e.g. web / facebook" value={medium} onChange={(e) => setMedium(e.target.value)} />
        </Field>
        <Field label="Controller (blank = the business)" error={fieldErrs.controllerPartyId}>
          <EntityPicker key={resetSeq} placeholder="Business (default)…" search={searchParties} onPick={(i) => setControllerPartyId(i?.id ?? null)} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={busy || !name.trim() || !medium.trim()}>
            {busy ? "Adding…" : "Add channel"}
          </Button>
        </div>
        {err && <div className="sm:col-span-2"><ErrorNote message={err} /></div>}
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
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{channel.name}</span>
          <Badge tone="gray">{channel.medium}</Badge>
          {!channel.isActive && <Badge tone="amber">inactive</Badge>}
          <span className="text-xs text-slate-500">
            controller: {channel.controllerName ?? "the business"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="px-2 text-xs" disabled={busy} onClick={() => patch({ isActive: !channel.isActive })}>
            {channel.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="ghost" className="px-2 text-xs text-red-600" disabled={busy} onClick={archive}>
            Archive
          </Button>
        </div>
      </div>
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
    </Card>
  );
}

// ─── Profit-share terms (N-way owner/investor shares + dividends) ──────────────
function ProfitShareTerms() {
  const { data: terms, error, isLoading, mutate } = useApi<ProfitShareTerm[]>("channels/profit-shares");
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Profit-share &amp; dividends</h2>
      <p className="mb-3 text-xs text-slate-400">
        Give any owner/investor/partner a date-versioned share of the profit pool. The formula (basis) and rate are both
        configurable; old jobs keep their old terms. A standing (default) share is an owner dividend — it applies to
        every job automatically.
      </p>
      <AddProfitShareTerm onAdded={mutate} />
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {terms && terms.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-800 rounded-lg border border-ink-800 bg-ink-850 text-sm">
          {terms.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-3 py-2">
              <span>
                <span className="font-medium">{t.toPartyName ?? "—"}</span>{" "}
                <span className="text-slate-400">
                  {t.basis === "fixed" ? <>fixed <Money value={Number(t.value)} /></> : `${t.value}% — ${BASIS_LABELS[t.basis ?? ""] ?? t.basis}`}
                </span>
              </span>
              <span className="text-xs text-slate-500">
                {t.appliesTo.startsWith("source:") ? "channel-scoped" : "standing dividend"} · from {formatDate(t.effectiveFrom)}
              </span>
            </li>
          ))}
        </ul>
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
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add a profit share</h2>
      <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Beneficiary" error={fieldErrs.toPartyId}>
          <EntityPicker key={`b${resetSeq}`} placeholder="Search owner/investor…" search={searchParties} onPick={(i) => setToPartyId(i?.id ?? null)} />
        </Field>
        <Field label="Basis (the formula)" error={fieldErrs.basis}>
          <Select value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="pct_after_writer">% after writer pay</option>
            <option value="pct_of_net">% of net profit</option>
            <option value="pct_of_channel">% of channel earnings</option>
            <option value="fixed">fixed amount</option>
          </Select>
        </Field>
        <Field label={basis === "fixed" ? "Amount (৳)" : "Percent (%)"} error={fieldErrs.value}>
          {basis === "fixed"
            ? <MoneyInput value={value} onChange={(v) => setValue(v)} />
            : <PercentInput value={value} onChange={(v) => setValue(v)} />}
        </Field>
        <Field label="Scope to a channel (blank = standing dividend)" error={fieldErrs.sourcePartyId}>
          <EntityPicker key={`s${resetSeq}`} placeholder="All jobs (default)…" search={searchChannels} onPick={(i) => setSourcePartyId(i?.id ?? null)} />
        </Field>
        <Field label="Effective from" error={fieldErrs.effectiveFrom}>
          <DateInput value={effectiveFrom} onChange={setEffectiveFrom} />
        </Field>
        <div className="sm:col-span-2">
          {showOpacityHint && (
            <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              A standing net-profit dividend is allowed only for a non-partner silent investor — for an active partner it
              could reveal the other partner’s private margin (§4.4). For a partner, scope it to a channel or use a fixed
              amount. The server will reject a disallowed combination.
            </p>
          )}
          {err && <div className="mb-2"><ErrorNote message={err} /></div>}
          <Button type="submit" variant="secondary" disabled={busy || !toPartyId || !value}>
            {busy ? "Saving…" : "Save share"}
          </Button>
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
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">How a job’s profit divides</h2>
      <Card>
        <Field label="Job">
          <Select value={workItemId} onChange={(e) => load(e.target.value)}>
            <option value="">Select a job…</option>
            {(works ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.title}</option>
            ))}
          </Select>
        </Field>
        {busy && <div className="mt-3"><Spinner /></div>}
        {err && <div className="mt-3"><ErrorNote message={err} /></div>}
        {result && (
          <div className="mt-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">profit pool (after writer pay)</span>
              <span className="font-medium"><Money value={result.pool} /></span>
            </div>
            {result.overAllocated && (
              <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                Shares exceed the pool — review the configured rates.
              </p>
            )}
            <ul className="divide-y divide-ink-800">
              {result.cuts.map((c) => (
                <li key={c.toPartyId} className="flex items-center justify-between py-1.5">
                  <span>
                    {c.toPartyName ?? c.toPartyId}{" "}
                    <span className="text-xs text-slate-500">
                      ({c.basis === "fixed" ? "fixed" : `${c.rate}% of ${c.base}`})
                    </span>
                  </span>
                  <Money value={c.amount} />
                </li>
              ))}
              <li className="flex items-center justify-between py-1.5 text-slate-300">
                <span>residual → {result.residualOwner?.name ?? "the business"}</span>
                <Money value={result.residual} />
              </li>
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}
