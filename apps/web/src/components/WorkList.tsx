"use client";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/api";
import type { WorkListRow } from "@/lib/types";
import { DataTable } from "./DataTable";
import { ErrorNote, Spinner } from "./ui";

/** A titled list of work items (used by the role-aware landing). */
export function WorkList({ title, path, emptyHint }: { title: string; path: string; emptyHint?: string }) {
  const router = useRouter();
  const { data, error, isLoading } = useApi<WorkListRow[]>(path);
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-300">
        {title}
        {data ? <span className="ml-2 text-xs font-normal text-slate-500">{data.length}</span> : null}
      </h2>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <DataTable<WorkListRow>
          tableId={`work-${path}`}
          exportName="work"
          rows={data}
          getRowId={(w) => w.id}
          onRowClick={(w) => router.push(`/work/${w.id}`)}
          emptyTitle="Nothing here"
          emptyHint={emptyHint}
          columns={[
            { key: "title", header: "Title", sortable: true, value: (w) => w.title },
            { key: "workState", header: "Work", align: "center", sortable: true, format: "badge", value: (w) => w.workState },
            { key: "moneyState", header: "Money", align: "center", sortable: true, format: "badge", value: (w) => w.moneyState },
          ]}
        />
      )}
    </section>
  );
}
