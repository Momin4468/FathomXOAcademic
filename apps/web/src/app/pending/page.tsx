"use client";
import { AppShell } from "@/components/AppShell";
import { WorkBoard } from "@/components/WorkBoard";

/**
 * Pending (handoff §2) — the quick "what's due" view: every task not yet
 * delivered, so nothing slips. Same board as Tasks, scoped to open work.
 */
export default function PendingPage() {
  return (
    <AppShell>
      <div className="mb-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Pending</h1>
        <p className="mt-0.5 text-xs text-slate-400">Everything still open — draft, pending or confirmed, not yet delivered.</p>
      </div>
      <WorkBoard scope="active" />
    </AppShell>
  );
}
