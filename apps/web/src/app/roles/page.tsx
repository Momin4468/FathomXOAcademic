"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { can, type RoleRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Spinner, Textarea } from "@/components/ui";

export default function RolesPage() {
  const router = useRouter();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canView = can(me?.permissions, "platform:view");
  const canCreate = can(me?.permissions, "platform:create");
  const { data: roles, error, isLoading, mutate } = useApi<RoleRow[]>(canView ? "platform/roles" : null);

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Roles</h1>
      <p className="mb-4 text-xs text-gray-500">
        Roles are data — permission = module × action. Managing roles is SuperAdmin-only.
      </p>

      {!canView ? (
        <EmptyState title="Not authorized" hint="You need the platform module to manage roles." />
      ) : (
        <>
          {canCreate && <CreateRole onDone={mutate} />}

          {isLoading && <Spinner />}
          {error && <ErrorNote message={error.message} />}
          {roles && (
            <DataTable<RoleRow>
              tableId="admin-roles"
              exportName="roles"
              rows={roles}
              getRowId={(r) => r.id}
              onRowClick={(r) => router.push(`/roles/${r.id}`)}
              emptyTitle="No roles yet"
              columns={[
                { key: "name", header: "Role", sortable: true, value: (r) => r.name },
                { key: "description", header: "Description", filter: "text", value: (r) => r.description ?? "" },
                {
                  key: "isSystem",
                  header: "Kind",
                  align: "center",
                  render: (r) => (r.isSystem ? <Badge tone="blue">built-in</Badge> : <Badge tone="gray">custom</Badge>),
                  value: (r) => (r.isSystem ? "built-in" : "custom"),
                },
                { key: "permissionCount", header: "Perms", align: "right", sortable: true, value: (r) => r.permissionCount },
                { key: "assignmentCount", header: "Users", align: "right", sortable: true, value: (r) => r.assignmentCount },
              ]}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

function CreateRole({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      onDone();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not create role") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Create a role</h2>
        <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "New role"}</Button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <Field label="Name" required error={fieldErrs.name}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Finance Reviewer" />
          </Field>
          <Field label="Description" error={fieldErrs.description}>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this role is for…" />
          </Field>
          {err && <ErrorNote message={err} />}
          <Button type="submit" disabled={busy || !form.name.trim()}>{busy ? "Creating…" : "Create role"}</Button>
        </form>
      )}
    </Card>
  );
}
