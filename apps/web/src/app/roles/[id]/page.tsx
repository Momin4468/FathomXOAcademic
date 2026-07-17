"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import {
  can,
  type AdminUserRow,
  type PermAction,
  type PermissionCatalog,
  type RoleDetail,
  type WhoAmI,
} from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { PermissionGrid } from "@/components/PermissionGrid";
import { useConfirm } from "@/components/confirm";
import { Badge, Card, CardHead, EmptyBox, Field, GhostButton, Loading, Note, T, dcInput } from "@/components/dc";

const SYSTEM_SUPERADMIN = "System SuperAdmin";
const permKey = (module: string, action: string) => `${module}:${action}`;

export default function RoleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canView = can(me?.permissions, "platform:view");
  const canEdit = can(me?.permissions, "platform:approve");

  const { data: role, error, isLoading, mutate } = useApi<RoleDetail>(canView ? `platform/roles/${id}` : null);
  const { data: catalog } = useApi<PermissionCatalog>(canView ? "platform/permission-catalog" : null);
  const { data: users, mutate: mutateUsers } = useApi<AdminUserRow[]>(canView ? "platform/users" : null);

  const locked = role?.name === SYSTEM_SUPERADMIN;
  const [banner, setBanner] = useState("");

  // Local optimistic mirror of the grants so toggles feel instant.
  const [granted, setGranted] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (role) setGranted(new Set(role.permissions.map((p) => permKey(p.module, p.action))));
  }, [role]);

  async function toggle(module: string, action: PermAction, next: boolean) {
    const key = permKey(module, action);
    setBanner("");
    setGranted((prev) => {
      const s = new Set(prev);
      if (next) s.add(key);
      else s.delete(key);
      return s;
    });
    try {
      await apiSend(`platform/roles/${id}/permissions`, "PUT", { module, action, granted: next });
    } catch (e) {
      setBanner(bannerMessage(e, "Could not update permission") ?? "");
      void mutate(); // reconcile with the server (revert the optimistic change)
    }
  }

  if (!canView) {
    return (
      <AppShell>
        <EmptyBox title="Not authorized" hint="You need the platform module to manage roles." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link href="/roles" style={{ fontSize: 12, fontWeight: 600, color: T.goldDeep, textDecoration: "none", display: "inline-block", marginBottom: 8 }}>
        ← All roles
      </Link>
      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}
      {role && catalog && (
        <div style={{ fontFamily: "Inter, sans-serif", color: T.ink }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
            <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 24, fontWeight: 600, margin: 0 }}>{role.name}</h1>
            {role.isSystem && <Badge tone="blue">built-in</Badge>}
            {locked && <Badge tone="amber">locked</Badge>}
          </div>
          <p style={{ fontSize: 12, color: T.muted, margin: "0 0 16px" }}>
            {locked
              ? "The System SuperAdmin role is the break-glass path — it can't be changed."
              : role.isSystem
                ? "Built-in role: the name can't change, but its permissions can."
                : "Custom role."}
          </p>

          {banner && <div style={{ marginBottom: 12 }}><Note>{banner}</Note></div>}

          <div style={{ display: "grid", gap: 16 }}>
            <RoleDetails role={role} canEdit={canEdit && !locked} onSaved={mutate} />

            <Card>
              <CardHead>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>Permissions</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: T.muted }}>{granted.size} granted</span>
                </span>
              </CardHead>
              <div style={{ padding: "12px 14px" }}>
                <PermissionGrid
                  catalog={catalog}
                  granted={granted}
                  canEdit={canEdit}
                  locked={locked}
                  onToggle={toggle}
                />
              </div>
            </Card>

            <Assignments
              role={role}
              users={users ?? []}
              canEdit={canEdit && !locked}
              onChanged={() => {
                void mutate();
                void mutateUsers();
              }}
            />

            {canEdit && !role.isSystem && (
              <Card style={{ borderColor: "#F3C9C3" }}>
                <CardHead tone="red">Danger zone</CardHead>
                <div style={{ padding: "12px 14px" }}>
                  <p style={{ margin: "0 0 12px", fontSize: 11.5, color: T.muted }}>Deleting a role is permanent. Unassign it from all users first.</p>
                  <GhostButton
                    danger
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete "${role.name}"?`, body: "This can't be undone.", danger: true, confirmLabel: "Delete role" }))) return;
                      try {
                        await apiSend(`platform/roles/${id}`, "DELETE");
                        router.push("/roles");
                      } catch (e) {
                        setBanner(bannerMessage(e, "Could not delete role") ?? "");
                      }
                    }}
                  >
                    Delete role
                  </GhostButton>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function RoleDetails({ role, canEdit, onSaved }: { role: RoleDetail; canEdit: boolean; onSaved: () => void }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const dirty = name !== role.name || (description ?? "") !== (role.description ?? "");

  async function save() {
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend(`platform/roles/${role.id}`, "PATCH", {
        name: role.isSystem ? undefined : name.trim(),
        description: description.trim(),
      });
      onSaved();
    } catch (e) {
      setFieldErrs(fieldErrorMap(e));
      setErr(bannerMessage(e, "Could not save role") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Field label="Name" error={fieldErrs.name}>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit || role.isSystem} style={{ ...dcInput, opacity: !canEdit || role.isSystem ? 0.6 : 1 }} />
          </Field>
          <Field label="Description" error={fieldErrs.description}>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} rows={2} style={{ ...dcInput, resize: "vertical", opacity: !canEdit ? 0.6 : 1 }} />
          </Field>
        </div>
        {err && <div style={{ marginTop: 8 }}><Note>{err}</Note></div>}
        {canEdit && (
          <div style={{ marginTop: 12 }}>
            <GhostButton type="button" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save details"}</GhostButton>
          </div>
        )}
      </div>
    </Card>
  );
}

function Assignments({
  role,
  users,
  canEdit,
  onChanged,
}: {
  role: RoleDetail;
  users: AdminUserRow[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const assignedIds = useMemo(() => new Set(role.assignments.map((a) => a.userId)), [role.assignments]);
  const available = users.filter((u) => !assignedIds.has(u.id));

  async function assign() {
    if (!pick) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend(`platform/users/${pick}/roles`, "POST", { roleId: role.id });
      setPick("");
      onChanged();
    } catch (e) {
      setErr(bannerMessage(e, "Could not assign") ?? "");
    } finally {
      setBusy(false);
    }
  }

  async function unassign(userId: string) {
    setErr("");
    try {
      await apiSend(`platform/users/${userId}/roles/${role.id}`, "DELETE");
      onChanged();
    } catch (e) {
      setErr(bannerMessage(e, "Could not unassign") ?? "");
    }
  }

  return (
    <Card>
      <CardHead>Assigned users ({role.assignments.length})</CardHead>
      <div style={{ padding: "12px 14px" }}>
        {role.assignments.length === 0 ? (
          <EmptyBox title="No one holds this role yet" />
        ) : (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            {role.assignments.map((a, i) => (
              <div key={a.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>
                <span>
                  <span style={{ fontWeight: 600 }}>{a.displayName ?? a.email}</span>
                  {a.displayName && <span style={{ marginLeft: 8, fontSize: 11, color: T.muted }}>{a.email}</span>}
                </span>
                {canEdit && (
                  <button type="button" onClick={() => unassign(a.userId)} style={{ background: "none", border: "none", fontSize: 11, fontWeight: 600, color: T.red, cursor: "pointer" }}>
                    Unassign
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label="Assign a user">
                <select value={pick} onChange={(e) => setPick(e.target.value)} style={dcInput}>
                  <option value="">{available.length === 0 ? "No more users to assign" : "Pick a user…"}</option>
                  {available.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName ? `${u.displayName} · ${u.email}` : u.email}</option>
                  ))}
                </select>
              </Field>
            </div>
            <GhostButton type="button" disabled={busy || !pick} onClick={assign}>{busy ? "Assigning…" : "Assign"}</GhostButton>
          </div>
        )}
        {err && <div style={{ marginTop: 8 }}><Note>{err}</Note></div>}
      </div>
    </Card>
  );
}
