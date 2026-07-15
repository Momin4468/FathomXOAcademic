"use client";
import { AppShell } from "@/components/AppShell";
import { WorkBoard } from "@/components/WorkBoard";

/**
 * Completed (handoff §4) — delivered work, split from Tasks so the active list
 * stays short as volume grows into the hundreds.
 */
export default function CompletedPage() {
  return (
    <AppShell>
      <div className="mb-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Completed</h1>
        <p className="mt-0.5 text-xs text-slate-400">Delivered work — kept out of the active board so it doesn&apos;t clutter the daily view.</p>
      </div>
      <WorkBoard scope="done" />
    </AppShell>
  );
}
