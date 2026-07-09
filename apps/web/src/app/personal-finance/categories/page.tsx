"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import type { PfCategory } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { DataTable } from "@/components/DataTable";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";

export default function PfCategoriesPage() {
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = usePfApi<PfCategory[]>("categories");
  const [form, setForm] = useState({ kind: "expense", name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await pfApiSend("categories", "POST", { kind: form.kind, name: form.name.trim() });
      setForm({ ...form, name: "" });
      await mutate();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    if (!(await confirm({ title: "Archive this category?", danger: true, confirmLabel: "Archive" }))) return;
    await pfApiSend(`categories/${id}/archive`, "POST");
    await mutate();
  }

  return (
    <PfShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Categories</h1>
      <p className="mb-4 text-xs text-gray-500">Your own income & expense categories — add, rename, or archive freely.</p>

      <Card className="mb-5">
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-40"><Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="income">income</option><option value="expense">expense</option></Select></Field></div>
          <div className="flex-1"><Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Groceries" /></Field></div>
          <Button type="submit" disabled={busy || !form.name.trim()}>{busy ? "Adding…" : "Add"}</Button>
        </form>
        {err && <div className="mt-2"><ErrorNote message={err} /></div>}
      </Card>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <DataTable<PfCategory>
          tableId="pf-categories"
          exportName="categories"
          rows={data}
          getRowId={(c) => c.id}
          emptyTitle="No categories yet"
          columns={[
            { key: "name", header: "Name", sortable: true, value: (c) => c.name },
            {
              key: "kind",
              header: "Type",
              align: "center",
              sortable: true,
              filter: "select",
              filterOptions: ["income", "expense"],
              render: (c) => <Badge tone={c.kind === "income" ? "green" : "gray"}>{c.kind}</Badge>,
              value: (c) => c.kind,
            },
            {
              key: "action",
              header: "",
              align: "right",
              render: (c) => (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    archive(c.id);
                  }}
                >
                  archive
                </button>
              ),
            },
          ]}
        />
      )}
    </PfShell>
  );
}
