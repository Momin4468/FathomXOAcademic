"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Task } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Button,
  Card,
  DateTimeTzInput,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Spinner,
  tzLabel,
} from "@/components/ui";

const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

function humanizeMs(ms: number): string {
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
function timeLeft(t: Task): string {
  if (t.urgency.msLeft === null) return "no due date";
  return t.urgency.overdue ? `${humanizeMs(t.urgency.msLeft)} overdue` : `in ${humanizeMs(t.urgency.msLeft)}`;
}

const BUCKET_LABEL: Record<string, string> = { overdue: "Overdue", soon: "Due soon", later: "Later", none: "No deadline" };
const BUCKET_TONE: Record<string, string> = { overdue: "red", soon: "amber", later: "gray", none: "gray" };

function TaskCard({ t, onComplete }: { t: Task; onComplete: (id: string) => void }) {
  return (
    <Card className="flex items-center justify-between gap-3 py-3">
      <div className="text-sm">
        <span className="font-medium">{t.title}</span>
        {t.dueAt && (
          <div className="mt-0.5 text-xs text-gray-500">
            {/* The due moment in the VIEWER's zone; show the original zone only if it differs. */}
            {formatDateTime(t.dueAt, browserTz)} your time
            {t.dueTz && t.dueTz !== browserTz ? ` · set for ${tzLabel(t.dueTz)}` : ""} · {timeLeft(t)}
          </div>
        )}
      </div>
      {t.state !== "done" && (
        <Button variant="secondary" className="px-3 text-xs" onClick={() => onComplete(t.id)}>
          Done
        </Button>
      )}
    </Card>
  );
}

export default function TasksPage() {
  const { data, error, isLoading, mutate } = useApi<Task[]>("tasks");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState({ date: "", time: "", tz: browserTz });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function complete(id: string) {
    await apiSend(`tasks/${id}/complete`, "POST");
    await mutate();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await apiSend("tasks", "POST", {
        title: title.trim(),
        ...(due.date && due.time ? { dueDate: due.date, dueTime: due.time, dueTz: due.tz } : {}),
      });
      setTitle("");
      setDue({ date: "", time: "", tz: browserTz });
      setOpen(false);
      await mutate();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create task");
    } finally {
      setBusy(false);
    }
  }

  const tasks = data ?? [];
  const openTasks = tasks.filter((t) => t.state === "open");
  const done = tasks.filter((t) => t.state === "done");
  const buckets = (["overdue", "soon", "later", "none"] as const).map((b) => ({
    bucket: b,
    items: openTasks.filter((t) => t.urgency.bucket === b),
  }));

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
          <p className="text-xs text-gray-500">Due tracking in your timezone — nudges, never blocks.</p>
        </div>
        <Button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Task"}</Button>
      </div>

      {open && (
        <Card className="mb-5">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Submit ICT701 A3" required />
            </Field>
            <Field label="Deadline" hint="Date + time + the timezone it's due in (optional).">
              <DateTimeTzInput value={due} onChange={setDue} />
            </Field>
            {formError && <ErrorNote message={formError} />}
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? "Saving…" : "Add task"}
            </Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && tasks.length === 0 && <EmptyState title="No tasks" hint="Add one to start your queue." />}

      <div className="space-y-6">
        {buckets.map(
          ({ bucket, items }) =>
            items.length > 0 && (
              <section key={bucket} className="space-y-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Badge tone={BUCKET_TONE[bucket]}>{BUCKET_LABEL[bucket]}</Badge>
                  <span className="text-xs font-normal text-gray-400">{items.length}</span>
                </h2>
                {items.map((t) => (
                  <TaskCard key={t.id} t={t} onComplete={complete} />
                ))}
              </section>
            ),
        )}
        {done.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-400">Done</h2>
            {done.map((t) => (
              <TaskCard key={t.id} t={t} onComplete={complete} />
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
