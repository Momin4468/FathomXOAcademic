"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, Spinner, Textarea } from "@/components/ui";

/**
 * Employee work-logging (audit item 12). Log what you did — hours/units, no money
 * anywhere. An admin reviews and converts a log into the job's records.
 */
interface WorkLog {
  id: string;
  title: string;
  description: string | null;
  quantity: string | null;
  loggedOn: string;
  status: string;
}

export default function EmployeeLogPage() {
  const { data, error, isLoading, mutate } = useApi<WorkLog[]>("worklog/mine");

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">My work log</h1>
      <LogForm onSaved={mutate} />

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No work logged yet" hint="Log what you did above." />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {data.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <span className="font-medium">{l.title}</span>
                {l.quantity && <span className="ml-2 text-xs text-gray-500">{l.quantity} hrs/units</span>}
                <div className="mt-0.5 text-xs text-gray-400">{formatDate(l.loggedOn)}</div>
              </div>
              <Badge tone={l.status === "converted" ? "green" : l.status === "rejected" ? "red" : "amber"}>{l.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function LogForm({ onSaved }: { onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loggedOn, setLoggedOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("worklog", "POST", {
        title: title.trim(),
        description: description.trim() || undefined,
        quantity: quantity ? Number(quantity) : undefined,
        loggedOn,
      });
      setTitle("");
      setDescription("");
      setQuantity("");
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not log work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Log work</h2>
      <form onSubmit={save} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="What did you do?">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wrote chapter 2" />
        </Field>
        <Field label="Hours / units (optional)">
          <Input type="number" min="0" step="0.25" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Date">
          <DateInput value={loggedOn} onChange={setLoggedOn} />
        </Field>
        <Field label="Notes (optional)">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={busy || !title.trim()}>
            {busy ? "Saving…" : "Log work"}
          </Button>
        </div>
        {err && <div className="sm:col-span-2"><ErrorNote message={err} /></div>}
      </form>
    </Card>
  );
}
