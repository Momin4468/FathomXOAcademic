"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import type { WorkListRow } from "@/lib/types";
import { EmptyState, ErrorNote, Spinner, StateBadge } from "./ui";

/** A titled list of work items (used by the role-aware landing). */
export function WorkList({ title, path, emptyHint }: { title: string; path: string; emptyHint?: string }) {
  const { data, error, isLoading } = useApi<WorkListRow[]>(path);
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">
        {title}
        {data ? <span className="ml-2 text-xs font-normal text-gray-400">{data.length}</span> : null}
      </h2>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="Nothing here" hint={emptyHint} />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {data.map((w) => (
            <li key={w.id}>
              <Link href={`/work/${w.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                <span className="truncate text-sm font-medium text-gray-800">{w.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <StateBadge state={w.workState} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
