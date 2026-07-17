"use client";
import type { CSSProperties } from "react";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate, sanitizeAmount } from "@/lib/format";
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
  Card,
  CardHead,
  dcInput,
  EmptyBox,
  Field,
  GhostButton,
  GoldButton,
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
const searchReferrers = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=referrer`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.externalRef ?? undefined }));
};

const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "22px 0 10px" };
const formGrid = (min = 200): CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 });

// ৳-adorned money input recreated with the design tokens (sanitizes to a clean numeric string).
function MoneyField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 9, top: 0, bottom: 0, display: "flex", alignItems: "center", fontSize: 12.5, color: T.muted2, pointerEvents: "none" }}>৳</span>
      <input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(sanitizeAmount(e.target.value))} style={{ ...dcInput, paddingLeft: 20, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
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

export default function ReferrersPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canApprove = can(me?.permissions, "referrers:approve");

  const { data: referrers, error, isLoading, mutate } = useApi<Referrer[]>("referrers");

  if (me && !canApprove) {
    return (
      <AppShell>
        <Page title="Referrers">
          <EmptyBox title="No access to referrer management" hint="See your own referral income under “My referrals”." />
        </Page>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Page title="Referrers" sub="referral agreements & per-job attachments">
        <StatCards items={[{ label: "Referrers", value: referrers?.length ?? 0, tone: "gold", note: "with agreements below" }]} />

        <AttachReferral />

        <SetClientReferrer />

        <h2 style={sectionH}>Referrers &amp; agreements</h2>
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        <AddReferrer onAdded={mutate} />
        {referrers && referrers.length === 0 && <div style={{ marginTop: 12 }}><EmptyBox title="No referrers yet" hint="Add one above." /></div>}
        {referrers && referrers.length > 0 && (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {referrers.map((r) => (
              <ReferrerCard key={r.id} referrer={r} />
            ))}
          </div>
        )}
      </Page>
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
      <CardHead>Add a referrer</CardHead>
      <form onSubmit={add} style={{ display: "flex", gap: 10, padding: 14 }}>
        <input placeholder="Referrer name (e.g. Mujib)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...dcInput, flex: 1 }} />
        <GhostButton type="submit" disabled={busy || !name.trim()}>Add</GhostButton>
      </form>
      {err && <div style={{ padding: "0 14px 14px" }}><Note>{err}</Note></div>}
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
    t.basis === "fixed" ? <>fixed {money(t.value)}</> : <>{t.value}% of {t.basis ?? "—"}</>;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.eyebrow}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{referrer.displayName}</span>
        {referrer.externalRef && <Badge tone="gray">{referrer.externalRef}</Badge>}
      </div>

      <div style={{ padding: 14 }}>
        {terms && terms.length > 0 ? (
          <ul style={{ margin: "0 0 12px", padding: 0, listStyle: "none" }}>
            {terms.map((t, i) => (
              <li key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>
                <span>{fmtTerm(t)}</span>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {t.appliesTo.startsWith("client:") ? "per-client" : "default"} · from {formatDate(t.effectiveFrom)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: "0 0 12px", fontSize: 11.5, color: T.muted }}>No agreement yet — add one (the suggested payout uses it).</p>
        )}

        <form onSubmit={addTerm} style={formGrid()}>
          <Field label="Basis" error={fieldErrs.basis}>
            <select value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })} style={dcInput}>
              <option value="revenue">% of revenue</option>
              <option value="margin">% of margin (post-writer)</option>
              <option value="fixed">fixed amount</option>
            </select>
          </Field>
          <Field label={form.basis === "fixed" ? "Amount (৳)" : "Percent (%)"} error={fieldErrs.value}>
            {form.basis === "fixed"
              ? <MoneyField value={form.value} onChange={(v) => setForm({ ...form, value: v })} />
              : <PctField value={form.value} onChange={(v) => setForm({ ...form, value: v })} />}
          </Field>
          <Field label="Effective from" error={fieldErrs.effectiveFrom}>
            <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} style={dcInput} />
          </Field>
          <Field label="Per-client override (optional)" error={fieldErrs.clientPartyId}>
            <EntityPicker key={resetSeq} placeholder="All clients (default)…" search={searchParties} onPick={(i) => setForm({ ...form, clientPartyId: i?.id ?? null })} />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            {err && <div style={{ marginBottom: 10 }}><Note>{err}</Note></div>}
            <GhostButton type="submit" disabled={busy || !form.value}>{busy ? "Saving…" : "Save agreement"}</GhostButton>
          </div>
        </form>
      </div>
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
    <Card style={{ marginTop: 14 }}>
      <CardHead>Client’s default referrer</CardHead>
      <div style={{ padding: 14 }}>
        <p style={{ margin: "0 0 12px", fontSize: 11.5, color: T.muted }}>Each new job for this client suggests this referrer (one hop — never cascades).</p>
        <form onSubmit={save} style={formGrid()}>
          <Field label="Client">
            <EntityPicker key={`c${resetSeq}`} placeholder="Search client…" search={searchParties} onPick={(i) => setClientId(i?.id ?? null)} />
          </Field>
          <Field label="Referrer" error={fieldErrs.referrerId}>
            <EntityPicker key={`r${resetSeq}`} placeholder="Search referrer…" search={searchReferrers} onPick={(i) => setReferrerId(i?.id ?? null)} />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            {err && <div style={{ marginBottom: 10 }}><Note>{err}</Note></div>}
            {msg && <p style={{ margin: "0 0 10px", fontSize: 11.5, fontWeight: 600, color: T.green }}>{msg}</p>}
            <GhostButton type="submit" disabled={busy || !clientId}>{busy ? "Saving…" : "Save default"}</GhostButton>
          </div>
        </form>
      </div>
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
    <Card style={{ marginBottom: 14 }}>
      <CardHead>Attach a referral to a job</CardHead>
      <form onSubmit={attach} style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={formGrid()}>
          <Field label="Job" error={fieldErrs.workItemId}>
            <select value={workItemId} onChange={(e) => { setWorkItemId(e.target.value); setSuggestion(null); }} required style={dcInput}>
              <option value="">Select job…</option>
              {(works ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Referrer (blank = the client’s default)" error={fieldErrs.referrerId}>
            <EntityPicker key={resetSeq} placeholder="Search referrer…" search={searchReferrers} onPick={(i) => setReferrerId(i?.id ?? null)} />
          </Field>
        </div>

        <div>
          <GhostButton type="button" disabled={busy || !workItemId} onClick={preview}>
            {busy ? "…" : "Preview suggestion"}
          </GhostButton>
        </div>

        {suggestion && (
          <div style={{ background: T.hair, borderRadius: 8, padding: "9px 12px", fontSize: 12.5 }}>
            {suggestion.source === "no_referrer" ? (
              <span style={{ color: T.amber }}>No referrer set for this job — pick one above.</span>
            ) : (
              <div style={{ display: "grid", gap: 3 }}>
                <div style={{ fontSize: 11, color: T.muted }}>
                  referrer: <span style={{ color: T.ink, fontWeight: 600 }}>{suggestion.referrerName ?? "—"}</span>
                  {" · "}revenue {money(suggestion.revenue)}{" · "}margin {money(suggestion.margin)}
                </div>
                <div>
                  {suggestion.source === "derived" && suggestion.term ? (
                    <span>
                      suggested <span style={{ fontWeight: 700 }}>{money(suggestion.suggestedAmount)}</span>{" "}
                      <span style={{ fontSize: 11, color: T.muted }}>
                        ({suggestion.term.basis === "fixed" ? "fixed" : `${suggestion.term.value}% of ${suggestion.term.basis}`})
                      </span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: T.amber }}>No agreement — enter an amount to attach.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <Field label="Amount (৳) — override or enter manually" error={fieldErrs.amount}>
          <MoneyField value={amount} onChange={(v) => setAmount(v)} />
        </Field>

        {err && <Note>{err}</Note>}
        {msg && <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: T.green }}>{msg}</p>}
        <div><GoldButton type="submit" disabled={busy || !workItemId}>{busy ? "Attaching…" : "Attach referral"}</GoldButton></div>
      </form>
    </Card>
  );
}
