"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { WorkBoard } from "@/components/WorkBoard";
import { Button } from "@/components/ui";

/**
 * Jobs board (/work) — the Airtable-style operational core. Rows = assignments;
 * group by course/client/writer with running subtotals; grid + kanban views;
 * inline edit of the spec + rates (money-gated, opacity-safe). Reminders live
 * under Tasks; the money the row earns is derived from the legs (read-only here —
 * posted amounts change via reprice on the job detail).
 */
export default function JobsPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Jobs</h1>
          <p className="text-xs text-slate-400">
            Assignments &amp; tutorials, grouped like your sheet. Reminders live under <Link href="/tasks" className="text-gold-600 hover:underline dark:text-gold-400">Tasks</Link>.
          </p>
        </div>
        {can(me?.permissions, "work:create") && <Link href="/work/new"><Button>+ New job</Button></Link>}
      </div>
      <WorkBoard />
    </AppShell>
  );
}
