"use client";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import type { WorkDetail } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { JobForm } from "@/components/JobForm";
import { Loading, Note, Page } from "@/components/dc";

export default function EditJobPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useApi<WorkDetail>(`work/${id}`);
  return (
    <AppShell>
      <Page title="Edit job" sub="every field is editable — open a section to reach the rest">
        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && <JobForm initial={data.item} />}
      </Page>
    </AppShell>
  );
}
