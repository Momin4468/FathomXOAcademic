"use client";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import type { WorkDetail } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { JobForm } from "@/components/JobForm";
import { ErrorNote, Spinner } from "@/components/ui";

export default function EditJobPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useApi<WorkDetail>(`work/${id}`);
  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Edit job</h1>
      <p className="mb-5 text-xs text-slate-400">Every field is editable; open a section to reach the rest.</p>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && <JobForm initial={data.item} />}
    </AppShell>
  );
}
