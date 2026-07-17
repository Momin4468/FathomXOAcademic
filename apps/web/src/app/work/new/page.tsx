"use client";
import { AppShell } from "@/components/AppShell";
import { JobForm } from "@/components/JobForm";
import { Page } from "@/components/dc";

export default function NewJobPage() {
  return (
    <AppShell>
      <Page
        title="Log a job"
        sub="only the title is required — open a section for academic detail, dates, group info, a fee, or notes"
      >
        <JobForm />
      </Page>
    </AppShell>
  );
}
