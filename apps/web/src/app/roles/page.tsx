"use client";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { can, type RoleRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, CardHead, DGrid, GhostButton, GoldButton, Page, T, dcInput } from "@/components/dc";

/**
 * Roles (roles-as-data) — recreated to the `Business OS v5` design handoff. Each
 * role is a bag of module × action permissions; opening a role drills into its
 * matrix (/roles/[id]). Managing roles is SuperAdmin-only (platform module).
 */
const btnGold = (disabled?: boolean): CSSProperties => ({
  fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, fontFamily: "inherit",
  background: T.gold, color: T.goldInk, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.55 : 1, display: "inline-block", textAlign: "center",
});

function Note({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: T.redBg, color: T.red, border: "1px solid #F3C9C3", borderRadius: 8, padding: "8px 11px", fontSize: 12, fontWeight: 500 }}>
      {children}
    </div>
  );
}
function Fld({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: T.ink2, marginBottom: 5 }}>
        {label}{required && <span style={{ color: T.red }}> *</span>}
      </span>
      {children}
      {error && <div style={{ fontSize: 11, color: T.red, marginTop: 4, fontWeight: 500 }}>{error}</div>}
    </div>
  );
}

export default function RolesPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canView = can(me?.permissions, "platform:view");
  const canCreate = can(me?.permissions, "platform:create");
  const { data: roles, error, isLoading, mutate } = useApi<RoleRow[]>(canView ? "platform/roles" : null);
  const [creating, setCreating] = useState(false);

  return (
    <AppShell>
      <Page
        title="Roles"
        sub="roles are data — permission = module × action · SuperAdmin-only"
        action={canView && canCreate ? <GoldButton onClick={() => setCreating((o) => !o)}>{creating ? "Close" : "+ New role"}</GoldButton> : undefined}
      >
        {!canView ? (
          <Card style={{ padding: "26px 16px", textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Not authorized</div>
            <div style={{ fontSize: 12, color: T.muted2, marginTop: 4 }}>You need the platform module to manage roles.</div>
          </Card>
        ) : (
          <>
            {creating && canCreate && (
              <CreateRole onDone={() => { void mutate(); setCreating(false); }} onCancel={() => setCreating(false)} />
            )}

            {isLoading && <div style={{ padding: "20px 4px", fontSize: 12.5, color: T.muted2 }}>Loading…</div>}
            {error && <Note>{error.message}</Note>}
            {roles && (
              <DGrid<RoleRow>
                rows={roles}
                keyOf={(r) => r.id}
                empty="No roles yet"
                cols={[
                  {
                    label: "Role",
                    render: (r) => <Link href={`/roles/${r.id}`} style={{ color: T.ink, fontWeight: 600, textDecoration: "none" }}>{r.name}</Link>,
                  },
                  {
                    label: "Description",
                    render: (r) => <span style={{ color: T.ink2 }}>{r.description ?? "—"}</span>,
                  },
                  {
                    label: "Kind",
                    align: "center",
                    render: (r) => (r.isSystem ? <Badge tone="blue">built-in</Badge> : <Badge tone="gray">custom</Badge>),
                  },
                  { label: "Perms", align: "right", render: (r) => r.permissionCount },
                  { label: "Users", align: "right", render: (r) => r.assignmentCount },
                ]}
                actions={[{ label: "open", onClick: () => {}, href: (r) => `/roles/${r.id}`, color: T.muted }]}
              />
            )}
          </>
        )}
      </Page>
    </AppShell>
  );
}

function CreateRole({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", description: "" });
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
      await apiSend("platform/roles", "POST", { name: form.name.trim(), description: form.description.trim() || undefined });
      setForm({ name: "", description: "" });
      onDone();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not create role") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead>Create a role</CardHead>
      <form onSubmit={submit} style={{ padding: "14px 16px", display: "grid", gap: 12 }}>
        <Fld label="Name" required error={fieldErrs.name}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Finance Reviewer" style={dcInput} />
        </Fld>
        <Fld label="Description" error={fieldErrs.description}>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this role is for…" rows={3} style={{ ...dcInput, resize: "vertical" }} />
        </Fld>
        {err && <Note>{err}</Note>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy || !form.name.trim()} style={{ ...btnGold(busy || !form.name.trim()), border: "none" }}>
            {busy ? "Creating…" : "Create role"}
          </button>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </form>
    </Card>
  );
}
