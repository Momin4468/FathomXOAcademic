"use client";
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { bannerMessage, fieldErrorMap } from "@/lib/field-errors";
import { can, type AdminUserRow, type PartyRow, type RoleRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { useToast } from "@/components/toast";
import { Badge, Card, CardHead, DGrid, GhostButton, GoldButton, Page, T, dcInput } from "@/components/dc";

/**
 * User management (login accounts) — DISTINCT from the People directory. A *person*
 * (party) is a business entity; a *user* is a login that can act in the system.
 * They are linked, never merged (spec §10). Here an admin creates logins, assigns/
 * revokes roles (roles-as-data), and enables/disables access. Passwords are never
 * shown or set here — users change their own on /profile; a locked-out user uses
 * the emailed reset flow. Gated to the `platform` module (SuperAdmin-only by seed).
 * Recreated to the `Business OS v5` design handoff (generic grid + manage panel).
 */
const searchParty = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: (r.partyType ?? []).join(", ") }));
};

const sectionLabel: CSSProperties = {
  display: "block", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: T.muted, marginBottom: 6,
};
const btnGold = (disabled?: boolean): CSSProperties => ({
  fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, fontFamily: "inherit",
  background: T.gold, color: T.goldInk, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.55 : 1, display: "inline-block", textAlign: "center",
});
const btnDanger = (disabled?: boolean): CSSProperties => ({
  fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, fontFamily: "inherit",
  background: T.redBg, color: T.red, border: "1px solid #F3C9C3", cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.55 : 1, display: "inline-block",
});

function Note({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: T.redBg, color: T.red, border: "1px solid #F3C9C3", borderRadius: 8, padding: "8px 11px", fontSize: 12, fontWeight: 500 }}>
      {children}
    </div>
  );
}
function Fld({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: T.ink2, marginBottom: 5 }}>
        {label}{required && <span style={{ color: T.red }}> *</span>}
      </span>
      {children}
      {hint && <div style={{ fontSize: 11, color: T.muted2, marginTop: 4 }}>{hint}</div>}
      {error && <div style={{ fontSize: 11, color: T.red, marginTop: 4, fontWeight: 500 }}>{error}</div>}
    </div>
  );
}

export default function UsersPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canView = can(me?.permissions, "platform:view");
  const canCreate = can(me?.permissions, "platform:create");
  const canApprove = can(me?.permissions, "platform:approve");

  const { data: users, error, isLoading, mutate } = useApi<AdminUserRow[]>(canView ? "platform/users" : null);
  const { data: roles } = useApi<RoleRow[]>(canView ? "platform/roles" : null);
  const roleByName = useMemo(() => new Map((roles ?? []).map((r) => [r.name, r.id])), [roles]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const openUser = (users ?? []).find((u) => u.id === openId) ?? null;

  return (
    <AppShell>
      <Page
        title="Users & access"
        sub="logins that can act in the system"
        action={canCreate && !creating ? <GoldButton onClick={() => setCreating(true)}>+ New login</GoldButton> : undefined}
      >
        <div style={{ fontSize: 12, color: T.muted, marginTop: -4, marginBottom: 14 }}>
          A login links to a <Link href="/people" style={{ color: T.goldDeep, fontWeight: 600, textDecoration: "none" }}>person</Link> but is never merged with it. Passwords are self-service.
        </div>

        {!canView ? (
          <Card style={{ padding: "26px 16px", textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Not authorized</div>
            <div style={{ fontSize: 12, color: T.muted2, marginTop: 4 }}>You need the platform module to manage users.</div>
          </Card>
        ) : (
          <>
            {creating && canCreate && (
              <CreateLogin roles={roles ?? []} onDone={() => { setCreating(false); void mutate(); }} onCancel={() => setCreating(false)} />
            )}

            {isLoading && <div style={{ padding: "20px 4px", fontSize: 12.5, color: T.muted2 }}>Loading…</div>}
            {error && <Note>{error.message}</Note>}
            {users && users.length === 0 && (
              <Card style={{ padding: "26px 16px", textAlign: "center", color: T.muted2, fontSize: 13 }}>No users yet</Card>
            )}

            {users && users.length > 0 && (
              <DGrid<AdminUserRow>
                rows={users}
                keyOf={(u) => u.id}
                search
                exportName="users"
                cols={[
                  {
                    label: "Person",
                    text: (u) => [u.displayName, u.email].filter(Boolean).join(" — "),
                    render: (u) => (
                      <span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {u.partyId ? (
                            <Link href={`/people/${u.partyId}`} style={{ color: T.ink, fontWeight: 600, textDecoration: "none" }}>{u.displayName ?? u.email}</Link>
                          ) : (
                            <span style={{ fontWeight: 600 }}>{u.displayName ?? u.email}</span>
                          )}
                          {u.id === me?.principal.userId && <Badge tone="gray">you</Badge>}
                        </span>
                        <span style={{ display: "block", fontSize: 10.5, color: T.muted2, marginTop: 2 }}>{u.email}</span>
                      </span>
                    ),
                  },
                  {
                    label: "Roles",
                    text: (u) => u.roleNames.join(", "),
                    render: (u) => (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {u.roleNames.length === 0
                          ? <span style={{ fontSize: 11, color: T.muted2 }}>no roles</span>
                          : u.roleNames.map((r) => <Badge key={r} tone="blue">{r}</Badge>)}
                      </span>
                    ),
                  },
                  {
                    label: "Status",
                    align: "center",
                    text: (u) => u.status,
                    render: (u) => (u.status === "active" ? <Badge tone="green">active</Badge> : <Badge tone="red">disabled</Badge>),
                  },
                ]}
                actions={canApprove ? [{ label: "Manage", onClick: (u) => setOpenId(openId === u.id ? null : u.id), color: T.goldDeep }] : undefined}
              />
            )}

            {openUser && canApprove && (
              <div style={{ marginTop: 14 }}>
                <ManageUser
                  user={openUser}
                  assignable={(roles ?? []).filter((r) => !new Set(openUser.roleNames).has(r.name))}
                  roleByName={roleByName}
                  isSelf={openUser.id === me?.principal.userId}
                  onChanged={mutate}
                  onClose={() => setOpenId(null)}
                />
              </div>
            )}
          </>
        )}
      </Page>
    </AppShell>
  );
}

/** The expanded per-user admin controls: roles + enable/disable. */
function ManageUser({
  user, assignable, roleByName, isSelf, onChanged, onClose,
}: {
  user: AdminUserRow;
  assignable: RoleRow[];
  roleByName: Map<string, string>;
  isSelf: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [addRoleId, setAddRoleId] = useState("");
  const [err, setErr] = useState("");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setErr("");
    try { await fn(); toast({ title: ok, variant: "success" }); onChanged(); }
    catch (e) { setErr(bannerMessage(e, "Action failed") ?? "Action failed"); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHead>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Manage · {user.displayName ?? user.email}
          <span style={{ flex: 1 }} />
          <span onClick={onClose} style={{ fontSize: 11, fontWeight: 600, color: T.muted, cursor: "pointer" }}>Close</span>
        </span>
      </CardHead>
      <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <span style={sectionLabel}>Roles</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {user.roleNames.length === 0 && <span style={{ fontSize: 12, color: T.muted2 }}>None</span>}
            {user.roleNames.map((r) => (
              <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${T.border}`, borderRadius: 999, padding: "2px 4px 2px 10px", fontSize: 11.5 }}>
                {r}
                <span
                  title="Revoke"
                  onClick={() => { if (busy) return; const id = roleByName.get(r); if (id) void run(() => apiSend(`platform/users/${user.id}/roles/${id}`, "DELETE"), "Role revoked"); }}
                  style={{ cursor: busy ? "default" : "pointer", color: T.muted, padding: "0 5px", fontWeight: 700 }}
                >×</span>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={sectionLabel}>Assign a role</span>
              <select value={addRoleId} onChange={(e) => setAddRoleId(e.target.value)} style={dcInput}>
                <option value="">Select…</option>
                {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <span
              onClick={() => { if (busy || !addRoleId) return; void run(() => apiSend(`platform/users/${user.id}/roles`, "POST", { roleId: addRoleId }), "Role assigned").then(() => setAddRoleId("")); }}
              style={{ ...btnGold(busy || !addRoleId), whiteSpace: "nowrap" }}
            >Add</span>
          </div>
        </div>

        <div>
          <span style={sectionLabel}>Access</span>
          {user.status === "active" ? (
            <span
              onClick={() => { if (busy || isSelf) return; void run(() => apiSend(`platform/users/${user.id}/status`, "PATCH", { status: "disabled" }), "User disabled"); }}
              style={btnDanger(busy || isSelf)}
            >Disable login</span>
          ) : (
            <span
              onClick={() => { if (busy) return; void run(() => apiSend(`platform/users/${user.id}/status`, "PATCH", { status: "active" }), "User re-enabled"); }}
              style={btnGold(busy)}
            >Re-enable login</span>
          )}
          {isSelf && <div style={{ marginTop: 6, fontSize: 11, color: T.muted2 }}>You can&apos;t disable your own account.</div>}
          <div style={{ marginTop: 8, fontSize: 11, color: T.muted2 }}>A disabled login can&apos;t sign in and its sessions are revoked. Passwords are reset by the user via the sign-in page.</div>
        </div>
      </div>
      {err && <div style={{ padding: "0 16px 14px" }}><Note>{err}</Note></div>}
    </Card>
  );
}

/** Create a new login, optionally linked to an existing person. */
function CreateLogin({ roles, onDone, onCancel }: { roles: RoleRow[]; onDone: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState(true); // default: email a set-password link
  const [password, setPassword] = useState("");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const canSubmit = !!email.trim() && (invite || password.length >= 8);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr(""); setFieldErrs({});
    try {
      const user = await apiSend<{ id: string }>("platform/users", "POST", {
        email: email.trim(),
        partyId: partyId ?? undefined,
        ...(invite ? { sendInvite: true } : { password }),
      });
      if (roleId) await apiSend(`platform/users/${user.id}/roles`, "POST", { roleId });
      onDone();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not create login") ?? "Could not create login");
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead>New login</CardHead>
      <form onSubmit={submit} style={{ padding: "14px 16px", display: "grid", gap: 12 }}>
        <Fld label="Sign-in email" required error={fieldErrs.email}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required style={dcInput} />
        </Fld>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: T.ink2 }}>
          <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Email an invite link
            <span style={{ display: "block", fontSize: 11, color: T.muted2, marginTop: 2 }}>The user sets their own password via a one-time link — no password is shared. Uncheck to set a temporary password yourself.</span>
          </span>
        </label>
        {!invite && (
          <Fld label="Temporary password" hint="At least 8 chars — the user changes it on first sign-in" required error={fieldErrs.password}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" style={dcInput} />
          </Fld>
        )}
        <Fld label="Link to a person" hint="Optional — link a login to its business identity (never merged).">
          <EntityPicker placeholder="Search people…" search={searchParty} onPick={(i) => setPartyId(i?.id ?? null)} />
        </Fld>
        <Fld label="Initial role" hint="Optional — assign one now (add more after).">
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} style={dcInput}>
            <option value="">No role yet</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Fld>
        {err && <Note>{err}</Note>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy || !canSubmit} style={{ ...btnGold(busy || !canSubmit), border: "none" }}>
            {busy ? "Saving…" : invite ? "Create & send invite" : "Create login"}
          </button>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </form>
    </Card>
  );
}
