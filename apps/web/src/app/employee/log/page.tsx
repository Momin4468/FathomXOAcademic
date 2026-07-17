"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, CardHead, cell, DGrid, dcInput, Field, fmtDay, GhostButton, Loading, Note, Page, T } from "@/components/dc";

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
      <Page title="My work log" sub="log what you did — no money here; an admin reviews and converts it into the job">
        <LogForm onSaved={mutate} />

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <DGrid<WorkLog>
            minWidth={420}
            rows={data}
            keyOf={(l) => l.id}
            cols={[
              { label: "What you did", render: (l) => cell(l.title, { weight: 500, sub: l.quantity ? `${l.quantity} hrs/units` : undefined }) },
              { label: "Date", render: (l) => <span style={{ color: T.muted2 }}>{fmtDay(l.loggedOn)}</span> },
              { label: "Status", align: "center", render: (l) => <Badge tone={l.status === "converted" ? "green" : l.status === "rejected" ? "red" : "amber"}>{l.status}</Badge> },
            ]}
            empty="No work logged yet — log what you did above."
          />
        )}
      </Page>
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
    <Card style={{ marginBottom: 16 }}>
      <CardHead>Log work</CardHead>
      <form onSubmit={save} style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label="What did you do?">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wrote chapter 2" style={dcInput} />
        </Field>
        <Field label="Hours / units (optional)">
          <input type="number" min="0" step="0.25" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ ...dcInput, textAlign: "right" }} />
        </Field>
        <Field label="Date">
          <input type="date" value={loggedOn} onChange={(e) => setLoggedOn(e.target.value)} style={dcInput} />
        </Field>
        <Field label="Notes (optional)">
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...dcInput, resize: "vertical" }} />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <GhostButton type="submit" disabled={busy || !title.trim()}>{busy ? "Saving…" : "Log work"}</GhostButton>
        </div>
        {err && <div style={{ gridColumn: "1 / -1" }}><Note>{err}</Note></div>}
      </form>
    </Card>
  );
}
