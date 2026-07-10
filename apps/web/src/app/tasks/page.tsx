"use client";
import Link from "next/link";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatDateTime } from "@/lib/format";
import type { Task } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import {
  Badge,
  Button,
  Card,
  DateTimeTzInput,
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

const BUCKET_TONE: Record<string, string> = { overdue: "red", soon: "amber", later: "gray", none: "gray" };

export default function TasksPage() {
  const { data, error, isLoading, mutate } = useApi<Task[]>("tasks");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState({ date: "", time: "", tz: browserTz });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const dirty = !!title || !!(due.date || due.time);
  const { confirmClose } = useUnsavedGuard(dirty);

  async function complete(id: string) {
    await apiSend(`tasks/${id}/complete`, "POST");
    await mutate();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    setFieldErrs({});
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
      setFieldErrs(fieldErrorMap(err));
      setFormError(bannerMessage(err, "Could not create task") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
          <p className="text-xs text-gray-500">Reminders &amp; due-tracking in your timezone — nudges, never blocks. Billable work lives under <Link href="/work" className="text-gold-600 hover:underline dark:text-gold-400">Jobs</Link>.</p>
        </div>
        <Button onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Task"}</Button>
      </div>

      {open && (
        <Card className="mb-5">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Title" error={fieldErrs.title}>
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
      {data && (
        <DataTable<Task>
          tableId="tasks"
          exportName="tasks"
          rows={data}
          getRowId={(t) => t.id}
          emptyTitle="No tasks"
          emptyHint="Add one to start your queue."
          columns={[
            { key: "title", header: "Title", sortable: true, value: (t) => t.title },
            {
              key: "dueAt",
              header: "Due",
              sortable: true,
              render: (t) =>
                t.dueAt ? (
                  <span className="text-xs text-gray-500">
                    {/* The due moment in the VIEWER's zone; show the original zone only if it differs. */}
                    {formatDateTime(t.dueAt, browserTz)}
                    {t.dueTz && t.dueTz !== browserTz ? ` · ${tzLabel(t.dueTz)}` : ""} · {timeLeft(t)}
                  </span>
                ) : (
                  <span className="text-gray-400">no due date</span>
                ),
              value: (t) => t.dueAt ?? "",
            },
            {
              key: "urgency",
              header: "Urgency",
              align: "center",
              sortable: true,
              filter: "select",
              filterOptions: ["overdue", "soon", "later", "none"],
              render: (t) => <Badge tone={BUCKET_TONE[t.urgency.bucket]}>{t.urgency.bucket}</Badge>,
              value: (t) => t.urgency.bucket,
            },
            {
              key: "workItemId",
              header: "Job",
              align: "center",
              render: (t) =>
                t.workItemId ? (
                  <Link href={`/work/${t.workItemId}`} onClick={(e) => e.stopPropagation()} className="text-xs text-gold-600 hover:underline dark:text-gold-400">
                    View job
                  </Link>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                ),
              value: (t) => (t.workItemId ? "linked" : ""),
            },
            {
              key: "state",
              header: "Status",
              align: "center",
              sortable: true,
              filter: "select",
              filterOptions: ["open", "done"],
              format: "badge",
              value: (t) => t.state,
            },
            {
              key: "action",
              header: "",
              align: "right",
              render: (t) =>
                t.state !== "done" ? (
                  <Button
                    variant="secondary"
                    className="px-3 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      complete(t.id);
                    }}
                  >
                    Done
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
    </AppShell>
  );
}
