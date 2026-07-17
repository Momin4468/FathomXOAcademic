"use client";
import type { CSSProperties } from "react";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import {
  can,
  type PartyRow,
  type VaultItem,
  type VaultManageItem,
  type VaultReveal,
  type VaultShare,
  type WhoAmI,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
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
  Note,
  Page,
  StatCards,
  T,
} from "@/components/dc";

const TYPES = ["portal", "google", "github", "aws", "tool", "other"];
const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};

const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "22px 0 10px" };

export default function VaultPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canCreate = can(me?.permissions, "credential_vault:create");
  const canManage = can(me?.permissions, "credential_vault:approve");
  const { data: items, error, isLoading, mutate } = useApi<VaultItem[]>("vault/items");

  return (
    <AppShell>
      <Page title="Credential vault" sub="metadata only — secrets are revealed one at a time behind a 2FA step-up">
        <StatCards items={[{ label: "Credentials", value: items?.length ?? 0, tone: "blue", note: "you can access" }]} />

        {canCreate && <CreateItem onDone={mutate} />}

        <h2 style={sectionH}>My credentials</h2>
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {items && items.length === 0 && <EmptyBox title="No credentials you can access" />}
        {items && items.length > 0 && (
          <div style={{ display: "grid", gap: 10 }}>
            {items.map((it) => (
              <ItemRow key={it.id} item={it} />
            ))}
          </div>
        )}

        {canManage && <ManagerPanel />}
      </Page>
    </AppShell>
  );
}

function ItemRow({ item }: { item: VaultItem }) {
  const [showTotp, setShowTotp] = useState(false);
  const [totp, setTotp] = useState("");
  const [secret, setSecret] = useState<VaultReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function reveal(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(totp)) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      const r = await apiSend<VaultReveal>(`vault/items/${item.id}/reveal`, "POST", { totp });
      setSecret(r);
      setShowTotp(false);
      setTotp("");
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not reveal") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 12.5 }}>
          <span style={{ fontWeight: 600, color: T.ink }}>{item.name}</span>
          <span style={{ marginLeft: 8 }}><Badge tone="blue">{item.type}</Badge></span>
          <div style={{ marginTop: 2, fontSize: 11, color: T.muted }}>
            {item.url ? <a href={item.url} target="_blank" rel="noreferrer" style={{ color: T.muted, textDecoration: "none" }}>{item.url}</a> : "no url"}
            {item.clientPartyId && <> · <PartyName id={item.clientPartyId} /></>}
          </div>
        </div>
        {!secret && (
          <GhostButton type="button" onClick={() => setShowTotp((s) => !s)}>
            {showTotp ? "Cancel" : "Reveal"}
          </GhostButton>
        )}
      </div>

      {showTotp && !secret && (
        <form onSubmit={reveal} style={{ marginTop: 12, display: "flex", alignItems: "flex-end", gap: 10 }}>
          <div style={{ maxWidth: 160 }}>
            <Field label="6-digit 2FA code" error={fieldErrs.totp}>
              <input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} placeholder="123456" style={{ ...dcInput, fontFamily: T.mono, letterSpacing: 2 }} />
            </Field>
          </div>
          <GoldButton type="submit" disabled={busy || !/^\d{6}$/.test(totp)}>{busy ? "…" : "Reveal"}</GoldButton>
        </form>
      )}
      {err && <div style={{ marginTop: 10 }}><Note>{err}</Note></div>}

      {secret && (
        <div style={{ marginTop: 12, display: "grid", gap: 8, background: T.parch, border: `1px solid ${T.parchBorder}`, borderRadius: 10, padding: 12 }}>
          <SecretRow label="Username" value={secret.secret.username} />
          <SecretRow label="Password" value={secret.secret.password} />
          <SecretRow label="2FA recovery" value={secret.secret.totpRecovery} />
          <SecretRow label="Notes" value={secret.secret.notes} />
          <div><GhostButton type="button" onClick={() => setSecret(null)}>Hide</GhostButton></div>
        </div>
      )}
    </Card>
  );
}

function SecretRow({ label, value }: { label: string; value?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (non-secure context) — the value is still shown to select */
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: T.parchText, fontWeight: 600 }}>{label}</div>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: T.mono, color: T.ink }}>{value}</div>
      </div>
      <button type="button" aria-label="Copy to clipboard" onClick={copy} style={{ fontSize: 11, fontWeight: 600, color: T.parchText, background: "transparent", border: "none", cursor: "pointer" }}>
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function CreateItem({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "portal", url: "", username: "", password: "", totpRecovery: "", notes: "" });
  const [client, setClient] = useState<string | null>(null);
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend("vault/items", "POST", {
        name: form.name.trim(),
        type: form.type,
        url: form.url || undefined,
        clientPartyId: client ?? undefined,
        username: form.username || undefined,
        password: form.password || undefined,
        totpRecovery: form.totpRecovery || undefined,
        notes: form.notes || undefined,
      });
      setForm({ name: "", type: "portal", url: "", username: "", password: "", totpRecovery: "", notes: "" });
      setClient(null);
      setResetSeq((n) => n + 1);
      setOpen(false);
      onDone();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not create") ?? "");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: open ? `1px solid ${T.eyebrow}` : undefined }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>Add a credential</span>
        <GhostButton type="button" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Open"}</GhostButton>
      </div>
      {open && (
        <form onSubmit={submit} style={{ padding: 14, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label="Name" error={fieldErrs.name}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="AcademyCX" style={dcInput} /></Field>
            <Field label="Type" error={fieldErrs.type}><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={dcInput}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label="URL" error={fieldErrs.url}><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={dcInput} /></Field>
            <Field label="Client (optional)" error={fieldErrs.clientPartyId}><EntityPicker key={resetSeq} placeholder="Link a client…" search={searchParties} onPick={(i) => setClient(i?.id ?? null)} /></Field>
            <Field label="Username" error={fieldErrs.username}><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} style={dcInput} /></Field>
            <Field label="Password" error={fieldErrs.password}><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={dcInput} /></Field>
          </div>
          <Field label="2FA recovery" error={fieldErrs.totpRecovery}><input value={form.totpRecovery} onChange={(e) => setForm({ ...form, totpRecovery: e.target.value })} style={dcInput} /></Field>
          <Field label="Notes" error={fieldErrs.notes}><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={dcInput} /></Field>
          {err && <Note>{err}</Note>}
          <div><GoldButton type="submit" disabled={busy || !form.name.trim()}>{busy ? "Saving…" : "Create credential"}</GoldButton></div>
        </form>
      )}
    </Card>
  );
}

function ManagerPanel() {
  const { data: items, mutate } = useApi<VaultManageItem[]>("vault/manage/items");
  return (
    <section style={{ marginTop: 8 }}>
      <h2 style={sectionH}>Manage sharing (admin)</h2>
      {items && items.length === 0 && <EmptyBox title="No credentials in the org" />}
      {items && items.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((it) => (
            <ManageRow key={it.id} item={it} onChanged={mutate} />
          ))}
        </div>
      )}
    </section>
  );
}

function ManageRow({ item, onChanged }: { item: VaultManageItem; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: shares, mutate } = useApi<VaultShare[]>(open ? `vault/items/${item.id}/shares` : null);
  const [grantee, setGrantee] = useState<string | null>(null);
  const [resetSeq, setResetSeq] = useState(0);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  async function grant() {
    if (!grantee) return;
    setErr("");
    setFieldErrs({});
    try {
      await apiSend(`vault/items/${item.id}/shares`, "POST", { partyId: grantee });
      setGrantee(null);
      setResetSeq((n) => n + 1);
      await mutate();
      onChanged();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not grant") ?? "");
    }
  }
  async function revoke(shareId: string) {
    await apiSend(`vault/shares/${shareId}/revoke`, "POST");
    await mutate();
    onChanged();
  }
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
        <span style={{ fontWeight: 600, color: T.ink }}>{item.name} <Badge tone="gray">{item.shareCount} holder{item.shareCount === 1 ? "" : "s"}</Badge></span>
        <GhostButton type="button" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Shares"}</GhostButton>
      </div>
      {open && (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          {shares && shares.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {shares.map((s, i) => (
                <li key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>
                  <PartyName id={s.partyId} />
                  <button type="button" onClick={() => revoke(s.id)} style={{ fontSize: 11, fontWeight: 600, color: T.red, background: "transparent", border: "none", cursor: "pointer" }}>revoke</button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: 11.5, color: T.muted }}>No active shares.</p>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <div style={{ flex: 1 }}><Field label="Grant to" error={fieldErrs.partyId}><EntityPicker key={resetSeq} placeholder="Search party…" search={searchParties} onPick={(i) => setGrantee(i?.id ?? null)} /></Field></div>
            <GhostButton type="button" disabled={!grantee} onClick={grant}>Grant</GhostButton>
          </div>
          {err && <Note>{err}</Note>}
        </div>
      )}
    </Card>
  );
}
