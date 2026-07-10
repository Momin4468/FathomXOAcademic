"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { WorkList } from "@/components/WorkList";
import { Button } from "@/components/ui";

/**
 * Jobs index (/work) — the billable work items. This route was missing, so the
 * "Jobs" nav item had nowhere to go; only /work/new existed. The subtitle draws
 * the Jobs-vs-Tasks line explicitly (jobs = billable work + money; tasks =
 * reminders), and each job's detail links its related tasks (Phase 4B).
 */
export default function JobsPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const isApprover = can(me?.permissions, "work:approve");
  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Jobs</h1>
          <p className="text-xs text-slate-400">
            Billable work items — the money engine. Reminders live under <Link href="/tasks" className="text-gold-600 hover:underline dark:text-gold-400">Tasks</Link>.
          </p>
        </div>
        {can(me?.permissions, "work:create") && (
          <Link href="/work/new"><Button>+ Log new</Button></Link>
        )}
      </div>

      <div className="space-y-6">
        {isApprover && <WorkList title="Confirmation queue" path="work?workState=pending" emptyHint="No jobs awaiting confirmation." />}
        {isApprover && <WorkList title="In progress" path="work?workState=confirmed" emptyHint="No active jobs." />}
        <WorkList title="All jobs" path="work" emptyHint="No jobs yet — log one to get started." />
      </div>
    </AppShell>
  );
}
