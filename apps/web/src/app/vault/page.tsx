"use client";
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
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";

const TYPES = ["portal", "google", "github", "aws", "tool", "other"];
const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};

export default function VaultPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canCreate = can(me?.permissions, "credential_vault:create");
  const canManage = can(me?.permissions, "credential_vault:approve");
  const { data: items, error, isLoading, mutate } = useApi<VaultItem[]>("vault/items");

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Credential vault</h1>
      <p className="mb-4 text-xs text-slate-400">Metadata only — secrets are revealed one at a time behind a 2FA step-up.</p>

      {canCreate && <CreateItem onDone={mutate} />}

      <h2 className="mb-2 text-sm font-semibold text-slate-200">My credentials</h2>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {items && items.length === 0 && <EmptyState title="No credentials you can access" />}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <ItemRow key={it.id} item={it} />
          ))}
        </ul>
      )}

      {canManage && <ManagerPanel />}
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
    <li>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium">{item.name}</span>
            <span className="ml-2"><Badge tone="blue">{item.type}</Badge></span>
            <div className="mt-0.5 text-xs text-slate-400">
              {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">{item.url}</a> : "no url"}
              {item.clientPartyId && <> · <PartyName id={item.clientPartyId} /></>}
            </div>
          </div>
          {!secret && (
            <Button variant="secondary" className="px-2 text-xs" onClick={() => setShowTotp((s) => !s)}>
              {showTotp ? "Cancel" : "Reveal"}
            </Button>
          )}
        </div>

        {showTotp && !secret && (
          <form onSubmit={reveal} className="mt-3 flex items-end gap-2">
            <Field label="6-digit 2FA code" error={fieldErrs.totp}>
              <Input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
            </Field>
            <Button type="submit" disabled={busy || !/^\d{6}$/.test(totp)}>{busy ? "…" : "Reveal"}</Button>
          </form>
        )}
        {err && <div className="mt-2"><ErrorNote message={err} /></div>}

        {secret && (
          <div className="mt-3 space-y-2 rounded-lg bg-ink-800 p-3">
            <SecretRow label="Username" value={secret.secret.username} />
            <SecretRow label="Password" value={secret.secret.password} />
            <SecretRow label="2FA recovery" value={secret.secret.totpRecovery} />
            <SecretRow label="Notes" value={secret.secret.notes} />
            <Button variant="ghost" className="px-2 text-xs" onClick={() => setSecret(null)}>Hide</Button>
          </div>
        )}
      </Card>
    </li>
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
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0">
        <div className="text-xs text-slate-400">{label}</div>
        <div className="truncate font-mono">{value}</div>
      </div>
      <button type="button" aria-label="Copy to clipboard" className="text-xs text-slate-400 hover:underline" onClick={copy}>
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
    <Card className="mb-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-200">Add a credential</p>
        <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Open"}</Button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" error={fieldErrs.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="AcademyCX" /></Field>
            <Field label="Type" error={fieldErrs.type}><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
            <Field label="URL" error={fieldErrs.url}><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
            <Field label="Client (optional)" error={fieldErrs.clientPartyId}><EntityPicker key={resetSeq} placeholder="Link a client…" search={searchParties} onPick={(i) => setClient(i?.id ?? null)} /></Field>
            <Field label="Username" error={fieldErrs.username}><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="Password" error={fieldErrs.password}><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          </div>
          <Field label="2FA recovery" error={fieldErrs.totpRecovery}><Input value={form.totpRecovery} onChange={(e) => setForm({ ...form, totpRecovery: e.target.value })} /></Field>
          <Field label="Notes" error={fieldErrs.notes}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {err && <ErrorNote message={err} />}
          <Button type="submit" disabled={busy || !form.name.trim()}>{busy ? "Saving…" : "Create credential"}</Button>
        </form>
      )}
    </Card>
  );
}

function ManagerPanel() {
  const { data: items, mutate } = useApi<VaultManageItem[]>("vault/manage/items");
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Manage sharing (admin)</h2>
      {items && items.length === 0 && <EmptyState title="No credentials in the org" />}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <ManageRow key={it.id} item={it} onChanged={mutate} />
          ))}
        </ul>
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
    <li>
      <Card>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">{item.name} <Badge tone="gray">{item.shareCount} holder{item.shareCount === 1 ? "" : "s"}</Badge></span>
          <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Shares"}</Button>
        </div>
        {open && (
          <div className="mt-3 space-y-3">
            {shares && shares.length > 0 ? (
              <ul className="divide-y divide-ink-800">
                {shares.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                    <PartyName id={s.partyId} />
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => revoke(s.id)}>revoke</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No active shares.</p>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1"><Field label="Grant to" error={fieldErrs.partyId}><EntityPicker key={resetSeq} placeholder="Search party…" search={searchParties} onPick={(i) => setGrantee(i?.id ?? null)} /></Field></div>
              <Button variant="secondary" disabled={!grantee} onClick={grant}>Grant</Button>
            </div>
            {err && <ErrorNote message={err} />}
          </div>
        )}
      </Card>
    </li>
  );
}
