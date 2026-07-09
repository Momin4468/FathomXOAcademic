"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate } from "@/lib/format";
import {
  can,
  type PartyRow,
  type Referrer,
  type ReferrerTerm,
  type ReferralSuggestion,
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
const searchReferrers = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=referrer`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.externalRef ?? undefined }));
};

export default function ReferrersPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canApprove = can(me?.permissions, "referrers:approve");

  const { data: referrers, error, isLoading, mutate } = useApi<Referrer[]>("referrers");

  if (me && !canApprove) {
    return (
      <AppShell>
        <h1 className="mb-3 text-lg font-semibold tracking-tight">Referrers</h1>
        <EmptyState title="No access to referrer management" hint="See your own referral income under “My referrals”." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Referrers</h1>

      <AttachReferral />

      <SetClientReferrer />

      <h2 className="mb-2 mt-8 text-sm font-semibold text-gray-700">Referrers &amp; agreements</h2>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      <AddReferrer onAdded={mutate} />
      {referrers && referrers.length === 0 && <EmptyState title="No referrers yet" hint="Add one above." />}
      {referrers && referrers.length > 0 && (
        <div className="mt-3 space-y-3">
          {referrers.map((r) => (
            <ReferrerCard key={r.id} referrer={r} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

// ─── Add a referrer (a party tagged 'referrer') ───────────────────────────────
function AddReferrer({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("parties", "POST", { displayName: name.trim(), partyType: ["referrer"] });
      setName("");
      onAdded();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add referrer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Add a referrer</h2>
      <form onSubmit={add} className="flex gap-2">
        <Input placeholder="Referrer name (e.g. Mujib)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>Add</Button>
      </form>
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
    </Card>
  );
}

// ─── One referrer: their agreements + an add-term form ────────────────────────
function ReferrerCard({ referrer }: { referrer: Referrer }) {
  const { data: terms, mutate } = useApi<ReferrerTerm[]>(`referrers/${referrer.id}/terms`);
  const [form, setForm] = useState({ basis: "revenue", value: "", effectiveFrom: today(), clientPartyId: null as string | null });
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function addTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.value) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend(`referrers/${referrer.id}/terms`, "POST", {
        basis: form.basis,
        value: Number(form.value),
        effectiveFrom: form.effectiveFrom,
        clientPartyId: form.clientPartyId ?? undefined,
      });
      setForm({ ...form, value: "", clientPartyId: null });
      setResetSeq((n) => n + 1);
      await mutate();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not save agreement") ?? "");
    } finally {
      setBusy(false);
    }
  }

  const fmtTerm = (t: ReferrerTerm) =>
    t.basis === "fixed" ? <>fixed <Money value={t.value} /></> : <>{t.value}% of {t.basis ?? "—"}</>;

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{referrer.displayName}</span>
        {referrer.externalRef && <Badge tone="gray">{referrer.externalRef}</Badge>}
      </div>

      {terms && terms.length > 0 ? (
        <ul className="mb-3 divide-y divide-gray-100 text-sm">
          {terms.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-1.5">
              <span>{fmtTerm(t)}</span>
              <span className="text-xs text-gray-400">
                {t.appliesTo.startsWith("client:") ? "per-client" : "default"} · from {formatDate(t.effectiveFrom)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-gray-400">No agreement yet — add one (the suggested payout uses it).</p>
      )}

      <form onSubmit={addTerm} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Basis" error={fieldErrs.basis}>
          <Select value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}>
            <option value="revenue">% of revenue</option>
            <option value="margin">% of margin (post-writer)</option>
            <option value="fixed">fixed amount</option>
          </Select>
        </Field>
        <Field label={form.basis === "fixed" ? "Amount (৳)" : "Percent (%)"} error={fieldErrs.value}>
          {form.basis === "fixed"
            ? <MoneyInput value={form.value} onChange={(v) => setForm({ ...form, value: v })} />
            : <PercentInput value={form.value} onChange={(v) => setForm({ ...form, value: v })} />}
        </Field>
        <Field label="Effective from" error={fieldErrs.effectiveFrom}>
          <DateInput value={form.effectiveFrom} onChange={(v) => setForm({ ...form, effectiveFrom: v })} />
        </Field>
        <Field label="Per-client override (optional)" error={fieldErrs.clientPartyId}>
          <EntityPicker key={resetSeq} placeholder="All clients (default)…" search={searchParties} onPick={(i) => setForm({ ...form, clientPartyId: i?.id ?? null })} />
        </Field>
        <div className="sm:col-span-2">
          {err && <div className="mb-2"><ErrorNote message={err} /></div>}
          <Button type="submit" variant="secondary" disabled={busy || !form.value}>{busy ? "Saving…" : "Save agreement"}</Button>
        </div>
      </form>
    </Card>
  );
}

// ─── Set a client's default (one-hop) referrer ────────────────────────────────
function SetClientReferrer() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [referrerId, setReferrerId] = useState<string | null>(null);
  const [resetSeq, setResetSeq] = useState(0);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setBusy(true);
    setErr("");
    setMsg("");
    setFieldErrs({});
    try {
      await apiSend(`referrers/clients/${clientId}`, "PUT", { referrerId: referrerId ?? null });
      setMsg("Default referrer saved.");
      setClientId(null);
      setReferrerId(null);
      setResetSeq((n) => n + 1);
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not save") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Client’s default referrer</h2>
      <p className="mb-3 text-xs text-gray-500">Each new job for this client suggests this referrer (one hop — never cascades).</p>
      <form onSubmit={save} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Client">
          <EntityPicker key={`c${resetSeq}`} placeholder="Search client…" search={searchParties} onPick={(i) => setClientId(i?.id ?? null)} />
        </Field>
        <Field label="Referrer" error={fieldErrs.referrerId}>
          <EntityPicker key={`r${resetSeq}`} placeholder="Search referrer…" search={searchReferrers} onPick={(i) => setReferrerId(i?.id ?? null)} />
        </Field>
        <div className="sm:col-span-2">
          {err && <div className="mb-2"><ErrorNote message={err} /></div>}
          {msg && <p className="mb-2 text-xs text-green-700">{msg}</p>}
          <Button type="submit" variant="secondary" disabled={busy || !clientId}>{busy ? "Saving…" : "Save default"}</Button>
        </div>
      </form>
    </Card>
  );
}

// ─── Attach a referral to a job (suggestion + override) ────────────────────────
function AttachReferral() {
  const { data: works } = useApi<WorkListRow[]>("work");
  const [workItemId, setWorkItemId] = useState("");
  const [referrerId, setReferrerId] = useState<string | null>(null);
  const [resetSeq, setResetSeq] = useState(0);
  const [suggestion, setSuggestion] = useState<ReferralSuggestion | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function preview() {
    if (!workItemId) return;
    setBusy(true);
    setErr("");
    setMsg("");
    setSuggestion(null);
    try {
      const s = await apiSend<ReferralSuggestion>("referrers/suggest", "POST", {
        workItemId,
        referrerId: referrerId ?? undefined,
      });
      setSuggestion(s);
      setAmount(s.suggestedAmount != null ? String(s.suggestedAmount) : "");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not get a suggestion");
    } finally {
      setBusy(false);
    }
  }

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    if (!workItemId) return;
    setBusy(true);
    setErr("");
    setMsg("");
    setFieldErrs({});
    try {
      await apiSend("referrers/attach", "POST", {
        workItemId,
        referrerId: referrerId ?? undefined,
        amount: amount ? Number(amount) : undefined,
      });
      setMsg("Referral attached.");
      setWorkItemId("");
      setReferrerId(null);
      setSuggestion(null);
      setAmount("");
      setResetSeq((n) => n + 1);
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not attach referral") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <p className="mb-2 text-sm font-semibold text-gray-700">Attach a referral to a job</p>
      <form onSubmit={attach} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Job" error={fieldErrs.workItemId}>
            <Select value={workItemId} onChange={(e) => { setWorkItemId(e.target.value); setSuggestion(null); }} required>
              <option value="">Select job…</option>
              {(works ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="Referrer (blank = the client’s default)" error={fieldErrs.referrerId}>
            <EntityPicker key={resetSeq} placeholder="Search referrer…" search={searchReferrers} onPick={(i) => setReferrerId(i?.id ?? null)} />
          </Field>
        </div>

        <Button type="button" variant="ghost" className="px-2 text-xs" disabled={busy || !workItemId} onClick={preview}>
          {busy ? "…" : "Preview suggestion"}
        </Button>

        {suggestion && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
            {suggestion.source === "no_referrer" ? (
              <span className="text-amber-700">No referrer set for this job — pick one above.</span>
            ) : (
              <div className="space-y-0.5">
                <div className="text-xs text-gray-500">
                  referrer: <span className="text-gray-800">{suggestion.referrerName ?? "—"}</span>
                  {" · "}revenue <Money value={suggestion.revenue} />{" · "}margin <Money value={suggestion.margin} />
                </div>
                <div>
                  {suggestion.source === "derived" && suggestion.term ? (
                    <span>
                      suggested <span className="font-medium"><Money value={suggestion.suggestedAmount} /></span>{" "}
                      <span className="text-xs text-gray-400">
                        ({suggestion.term.basis === "fixed" ? "fixed" : `${suggestion.term.value}% of ${suggestion.term.basis}`})
                      </span>
                    </span>
                  ) : (
                    <span className="text-amber-700 text-xs">No agreement — enter an amount to attach.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <Field label="Amount (৳) — override or enter manually" error={fieldErrs.amount}>
          <MoneyInput value={amount} onChange={(v) => setAmount(v)} />
        </Field>

        {err && <ErrorNote message={err} />}
        {msg && <p className="text-xs text-green-700">{msg}</p>}
        <Button type="submit" disabled={busy || !workItemId}>{busy ? "Attaching…" : "Attach referral"}</Button>
      </form>
    </Card>
  );
}
