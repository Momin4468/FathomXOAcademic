"use client";
import { AppShell } from "@/components/AppShell";
import { JobForm } from "@/components/JobForm";

export default function NewJobPage() {
  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Log a job</h1>
      <p className="mb-5 text-xs text-slate-400">
        Common fields are shown; open a section to add academic detail, dates, group info, a fee, or notes. Only the title is required.
      </p>
      <JobForm />
    </AppShell>
  );
}
