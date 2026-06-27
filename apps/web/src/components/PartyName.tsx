"use client";
import { useApi } from "@/lib/api";
import type { PartyRow } from "@/lib/types";

/**
 * Resolve a party's display name from its id (lists/headers show names, not
 * UUIDs). SWR caches by path, so repeated ids on a screen hit the cache.
 */
export function PartyName({ id, fallback = "—" }: { id: string | null | undefined; fallback?: string }) {
  const { data } = useApi<PartyRow>(id ? `parties/${id}` : null);
  if (!id) return <>{fallback}</>;
  return <>{data?.displayName ?? "…"}</>;
}
