"use client";
import { useApi } from "@/lib/api";
import type { RefEntity } from "@/lib/types";

/** Resolve a reference entity's canonical name from its id (e.g. a university). */
export function RefName({ id }: { id: string | null | undefined }) {
  const { data } = useApi<RefEntity>(id ? `reference/${id}` : null, { shouldRetryOnError: false });
  if (!id) return null;
  return <>{data?.canonical ?? "…"}</>;
}
