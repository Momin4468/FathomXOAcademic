"use client";
import { useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Spinner } from "@/components/ui";

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
      {data && data.length === 0 && <EmptyState title="No work logs" hint="Employee-logged work will appear here." />}
      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((l) => (
            <LogCard key={l.id} log={l} onChange={mutate} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function LogCard({ log, onChange }: { log: LogRow; onChange: () => void }) {
  const [workItemId, setWorkItemId] = useState(log.workItemId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function act(kind: "convert" | "reject") {
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
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-sm font-medium">{log.title}</span>
          <span className="ml-2 text-xs text-gray-500">{log.employeeName ?? log.employeePartyId}</span>
          {log.quantity && <span className="ml-2 text-xs text-gray-400">{log.quantity} hrs/units</span>}
          <div className="mt-0.5 text-xs text-gray-400">{formatDate(log.loggedOn)}</div>
        </div>
        {log.status === "draft" ? (
          <div className="flex items-center gap-2">
            <Input value={workItemId} onChange={(e) => setWorkItemId(e.target.value)} placeholder="Job ID" className="w-56 text-xs" />
            <Button variant="secondary" className="px-2 py-1 text-xs" disabled={busy} onClick={() => act("convert")}>
              Convert
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => act("reject")}>
              Reject
            </Button>
          </div>
        ) : (
          <Badge tone={log.status === "converted" ? "green" : "red"}>{log.status}</Badge>
        )}
      </div>
      {err && <div className="mt-2"><ErrorNote message={err} /></div>}
    </Card>
  );
}
