"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, ErrorNote, Input, Spinner } from "@/components/ui";

/**
 * Admin review queue for employee work logs (audit item 12). Convert a draft log
 * into a priced producer work_line on a job (you price it there), or reject it.
 */
interface LogRow {
  id: string;
  employeePartyId: string;
  employeeName: string | null;
  workItemId: string | null;
  title: string;
  description: string | null;
  quantity: string | null;
  loggedOn: string;
  status: string;
}

export default function HrmPage() {
  const { data, error, isLoading, mutate } = useApi<LogRow[]>("worklog");

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Work logs</h1>
      <p className="mb-5 text-xs text-gray-500">
        Convert a log onto a job (it becomes a producer line you price there) or reject it.
      </p>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <DataTable<LogRow>
          tableId="hrm-worklog"
          exportName="worklog"
          rows={data}
          getRowId={(l) => l.id}
          emptyTitle="No work logs"
          emptyHint="Employee-logged work will appear here."
          columns={[
            { key: "title", header: "Title", sortable: true, value: (l) => l.title },
            { key: "employee", header: "Employee", sortable: true, value: (l) => l.employeeName ?? l.employeePartyId },
            { key: "quantity", header: "Qty", align: "right", sortable: true, value: (l) => l.quantity ?? "" },
            { key: "loggedOn", header: "Date", sortable: true, format: "date", value: (l) => l.loggedOn },
            {
              key: "status",
              header: "Status",
              align: "center",
              sortable: true,
              filter: "select",
              filterOptions: ["draft", "converted", "rejected"],
              render: (l) => (l.status === "draft" ? <Badge tone="amber">draft</Badge> : <Badge tone={l.status === "converted" ? "green" : "red"}>{l.status}</Badge>),
              value: (l) => l.status,
            },
            {
              key: "action",
              header: "",
              align: "right",
              render: (l) => (l.status === "draft" ? <LogActions log={l} onChange={mutate} /> : null),
            },
          ]}
        />
      )}
    </AppShell>
  );
}

function LogActions({ log, onChange }: { log: LogRow; onChange: () => void }) {
  const confirm = useConfirm();
  const [workItemId, setWorkItemId] = useState(log.workItemId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function act(kind: "convert" | "reject") {
    if (!(await confirm({ title: kind === "convert" ? "Convert this log onto a job?" : "Reject this log?", danger: kind === "reject", confirmLabel: kind === "convert" ? "Convert" : "Reject" }))) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend(`worklog/${log.id}/${kind}`, "POST", kind === "convert" ? { workItemId: workItemId.trim() || undefined } : undefined);
      onChange();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="flex items-center gap-2">
        <Input value={workItemId} onChange={(e) => setWorkItemId(e.target.value)} placeholder="Job ID" className="w-40 text-xs" />
        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={busy} onClick={() => act("convert")}>
          Convert
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => act("reject")}>
          Reject
        </Button>
      </span>
      {err && <ErrorNote message={err} />}
    </span>
  );
}
