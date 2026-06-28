"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import type { PfCategory } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";

export default function PfCategoriesPage() {
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
    await pfApiSend(`categories/${id}/archive`, "POST");
    await mutate();
  }

  const income = (data ?? []).filter((c) => c.kind === "income");
  const expense = (data ?? []).filter((c) => c.kind === "expense");

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
      {data && data.length === 0 && <EmptyState title="No categories yet" />}
      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <CategoryList title="Income" tone="green" items={income} onArchive={archive} />
          <CategoryList title="Expense" tone="gray" items={expense} onArchive={archive} />
        </div>
      )}
    </PfShell>
  );
}

function CategoryList({ title, tone, items, onArchive }: { title: string; tone: string; items: PfCategory[]; onArchive: (id: string) => void }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title} <Badge tone={tone}>{items.length}</Badge></h2>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">None yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{c.name}</span>
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onArchive(c.id)}>archive</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
