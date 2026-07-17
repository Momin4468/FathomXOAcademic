"use client";
import { useMemo, useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/AppShell";
import { useConfirm } from "@/components/confirm";
import {
  Badge,
  cell,
  DGrid,
  dcInput,
  GhostButton,
  Loading,
  Note,
  Page,
  StatCards,
} from "@/components/dc";

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

  const stats = useMemo(() => {
    const rows = data ?? [];
    const by = (s: string) => rows.filter((r) => r.status === s).length;
    return [
      { label: "Draft", value: by("draft"), tone: "amber" as const, note: "awaiting review" },
      { label: "Converted", value: by("converted"), tone: "green" as const },
      { label: "Rejected", value: by("rejected"), tone: "red" as const },
    ];
  }, [data]);

  return (
    <AppShell>
      <Page title="Work logs" sub="convert a log onto a job (it becomes a producer line you price there) or reject it">
        {data && data.length > 0 && <StatCards items={stats} min={150} />}

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <DGrid<LogRow>
            rows={data}
            keyOf={(l) => l.id}
            minWidth={640}
            empty="No work logs — employee-logged work will appear here."
            cols={[
              { label: "Title", render: (l) => cell(l.title, { sub: l.description ?? undefined }) },
              { label: "Employee", render: (l) => cell(l.employeeName ?? l.employeePartyId) },
              { label: "Qty", align: "right", render: (l) => cell(l.quantity ?? "—", { nums: true }) },
              { label: "Date", render: (l) => cell(formatDate(l.loggedOn)) },
              {
                label: "Status",
                align: "center",
                render: (l) =>
                  l.status === "draft"
                    ? <Badge tone="amber">draft</Badge>
                    : <Badge tone={l.status === "converted" ? "green" : "red"}>{l.status}</Badge>,
              },
              {
                label: "",
                align: "right",
                render: (l) => (l.status === "draft" ? <LogActions log={l} onChange={mutate} /> : null),
              },
            ]}
          />
        )}
      </Page>
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
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input value={workItemId} onChange={(e) => setWorkItemId(e.target.value)} placeholder="Job ID" style={{ ...dcInput, width: 150, fontSize: 11.5 }} />
        <GhostButton type="button" disabled={busy} onClick={() => act("convert")}>Convert</GhostButton>
        <GhostButton type="button" danger disabled={busy} onClick={() => act("reject")}>Reject</GhostButton>
      </span>
      {err && <Note>{err}</Note>}
    </span>
  );
}
