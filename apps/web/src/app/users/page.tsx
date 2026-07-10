"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { bannerMessage, fieldErrorMap } from "@/lib/field-errors";
import { can, type AdminUserRow, type PartyRow, type RoleRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";

/**
 * User management (login accounts) — DISTINCT from the People directory. A *person*
 * (party) is a business entity; a *user* is a login that can act in the system.
 * They are linked, never merged (spec §10). Here an admin creates logins, assigns/
 * revokes roles (roles-as-data), and enables/disables access. Passwords are never
 * shown or set here — users change their own on /profile; a locked-out user uses
 * the emailed reset flow. Gated to the `platform` module (SuperAdmin-only by seed).
 */
const searchParty = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: (r.partyType ?? []).join(", ") }));
};

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

  return (
    <AppShell>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Users &amp; access</h1>
        {canCreate && !creating && <Button onClick={() => setCreating(true)}>+ New login</Button>}
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Logins that can act in the system. A login links to a <Link href="/people" className="text-gold-600 hover:underline dark:text-gold-400">person</Link> but is never merged with it. Passwords are self-service.
      </p>

      {!canView ? (
        <EmptyState title="Not authorized" hint="You need the platform module to manage users." />
      ) : (
        <>
          {creating && canCreate && (
            <CreateLogin roles={roles ?? []} onDone={() => { setCreating(false); void mutate(); }} onCancel={() => setCreating(false)} />
          )}

          {isLoading && <Spinner />}
          {error && <ErrorNote message={error.message} />}
          {users && users.length === 0 && <EmptyState title="No users yet" />}

          {users && users.length > 0 && (
            <Card className="p-0">
              <ul className="divide-y divide-ink-800">
                {users.map((u) => {
                  const disabled = u.status !== "active";
                  const held = new Set(u.roleNames);
                  const assignable = (roles ?? []).filter((r) => !held.has(r.name));
                  const isOpen = openId === u.id;
                  return (
                    <li key={u.id}>
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {u.partyId ? (
                                <Link href={`/people/${u.partyId}`} className="hover:underline">{u.displayName ?? u.email}</Link>
                              ) : (
                                u.displayName ?? u.email
                              )}
                            </span>
                            {disabled ? <Badge tone="red">disabled</Badge> : <Badge tone="green">active</Badge>}
                            {u.id === me?.principal.userId && <Badge tone="gray">you</Badge>}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-400">
                            <span>{u.email}</span>
                            {u.roleNames.map((r) => <Badge key={r} tone="blue">{r}</Badge>)}
                            {u.roleNames.length === 0 && <span className="text-slate-500">no roles</span>}
                          </div>
                        </div>
                        {canApprove && (
                          <Button variant="secondary" className="min-h-0 px-2.5 py-1 text-xs" onClick={() => setOpenId(isOpen ? null : u.id)}>
                            {isOpen ? "Close" : "Manage"}
                          </Button>
                        )}
                      </div>

                      {isOpen && canApprove && (
                        <ManageUser
                          user={u}
                          assignable={assignable}
                          roleByName={roleByName}
                          isSelf={u.id === me?.principal.userId}
                          onChanged={mutate}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}

/** The expanded per-user admin controls: roles + enable/disable. */
function ManageUser({
  user, assignable, roleByName, isSelf, onChanged,
}: {
  user: AdminUserRow;
  assignable: RoleRow[];
  roleByName: Map<string, string>;
  isSelf: boolean;
  onChanged: () => void;
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
    <div className="border-t border-ink-800 bg-ink-850/40 px-4 py-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Roles</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {user.roleNames.length === 0 && <span className="text-xs text-slate-500">None</span>}
            {user.roleNames.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full border border-ink-700 py-0.5 pl-2 pr-1 text-xs">
                {r}
                <button type="button" disabled={busy} title="Revoke"
                  onClick={() => { const id = roleByName.get(r); if (id) void run(() => apiSend(`platform/users/${user.id}/roles/${id}`, "DELETE"), "Role revoked"); }}
                  className="rounded-full px-1 text-slate-400 hover:bg-red-500/15 hover:text-red-500">×</button>
              </span>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Field label="Assign a role">
              <select value={addRoleId} onChange={(e) => setAddRoleId(e.target.value)}
                className="min-h-[40px] w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-slate-100 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400">
                <option value="">Select…</option>
                {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Button className="min-h-0 px-3 py-2 text-xs" disabled={busy || !addRoleId}
              onClick={() => run(() => apiSend(`platform/users/${user.id}/roles`, "POST", { roleId: addRoleId }), "Role assigned").then(() => setAddRoleId(""))}>
              Add
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Access</p>
          {user.status === "active" ? (
            <Button variant="danger" className="min-h-0 px-3 py-1.5 text-xs" disabled={busy || isSelf}
              onClick={() => run(() => apiSend(`platform/users/${user.id}/status`, "PATCH", { status: "disabled" }), "User disabled")}>
              Disable login
            </Button>
          ) : (
            <Button className="min-h-0 px-3 py-1.5 text-xs" disabled={busy}
              onClick={() => run(() => apiSend(`platform/users/${user.id}/status`, "PATCH", { status: "active" }), "User re-enabled")}>
              Re-enable login
            </Button>
          )}
          {isSelf && <p className="mt-1.5 text-[11px] text-slate-500">You can&apos;t disable your own account.</p>}
          <p className="mt-2 text-[11px] text-slate-500">A disabled login can&apos;t sign in and its sessions are revoked. Passwords are reset by the user via the sign-in page.</p>
        </div>
      </div>
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
    </div>
  );
}

/** Create a new login, optionally linked to an existing person. */
function CreateLogin({ roles, onDone, onCancel }: { roles: RoleRow[]; onDone: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || password.length < 8) return;
    setBusy(true); setErr(""); setFieldErrs({});
    try {
      const user = await apiSend<{ id: string }>("platform/users", "POST", {
        email: email.trim(),
        password,
        partyId: partyId ?? undefined,
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
    <Card className="mb-4">
      <h2 className="mb-3 text-sm font-semibold">New login</h2>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Sign-in email" required error={fieldErrs.email}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required />
          </Field>
          <Field label="Temporary password" hint="At least 8 chars — the user changes it" required error={fieldErrs.password}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Link to a person" hint="Optional — link a login to its business identity (never merged).">
          <EntityPicker placeholder="Search people…" search={searchParty} onPick={(i) => setPartyId(i?.id ?? null)} />
        </Field>
        <Field label="Initial role" hint="Optional — assign one now (add more after).">
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-slate-100 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400">
            <option value="">No role yet</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        {err && <ErrorNote message={err} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !email.trim() || password.length < 8}>{busy ? "Creating…" : "Create login"}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
