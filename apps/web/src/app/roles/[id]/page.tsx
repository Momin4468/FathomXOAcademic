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
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Select, Spinner, Textarea } from "@/components/ui";

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
        <EmptyState title="Not authorized" hint="You need the platform module to manage roles." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-4">
        <Link href="/roles" className="text-xs text-gray-500 hover:underline">← All roles</Link>
      </div>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {role && catalog && (
        <>
          <div className="mb-1 flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{role.name}</h1>
            {role.isSystem && <Badge tone="blue">built-in</Badge>}
            {locked && <Badge tone="amber">locked</Badge>}
          </div>
          <p className="mb-4 text-xs text-gray-500">
            {locked
              ? "The System SuperAdmin role is the break-glass path — it can't be changed."
              : role.isSystem
                ? "Built-in role: the name can't change, but its permissions can."
                : "Custom role."}
          </p>

          {banner && <div className="mb-3"><ErrorNote message={banner} /></div>}

          <RoleDetails role={role} canEdit={canEdit && !locked} onSaved={mutate} />

          <Card className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Permissions</h2>
              <span className="text-xs text-gray-500">{granted.size} granted</span>
            </div>
            <PermissionGrid
              catalog={catalog}
              granted={granted}
              canEdit={canEdit}
              locked={locked}
              onToggle={toggle}
            />
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
            <Card className="mb-4 border-red-200">
              <h2 className="mb-2 text-sm font-semibold text-red-700">Danger zone</h2>
              <p className="mb-3 text-xs text-gray-500">Deleting a role is permanent. Unassign it from all users first.</p>
              <Button
                variant="danger"
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
              </Button>
            </Card>
          )}
        </>
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
    <Card className="mb-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" error={fieldErrs.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit || role.isSystem} />
        </Field>
        <Field label="Description" error={fieldErrs.description}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
        </Field>
      </div>
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
      {canEdit && (
        <div className="mt-3">
          <Button variant="secondary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save details"}</Button>
        </div>
      )}
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
    <Card className="mb-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Assigned users ({role.assignments.length})</h2>
      {role.assignments.length === 0 ? (
        <EmptyState title="No one holds this role yet" />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {role.assignments.map((a) => (
            <li key={a.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{a.displayName ?? a.email}</span>
                {a.displayName && <span className="ml-2 text-xs text-gray-500">{a.email}</span>}
              </span>
              {canEdit && (
                <button type="button" className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => unassign(a.userId)}>
                  Unassign
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Field label="Assign a user">
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{available.length === 0 ? "No more users to assign" : "Pick a user…"}</option>
                {available.map((u) => (
                  <option key={u.id} value={u.id}>{u.displayName ? `${u.displayName} · ${u.email}` : u.email}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Button variant="secondary" disabled={busy || !pick} onClick={assign}>{busy ? "Assigning…" : "Assign"}</Button>
        </div>
      )}
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
    </Card>
  );
}
