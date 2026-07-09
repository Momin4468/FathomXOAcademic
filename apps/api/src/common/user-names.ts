import { schema, sql, type Db } from "@business-os/db";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Resolve actor `user_account` ids → a display name (UI_AUDIT R5 audit-trail). The
 * name is the linked party's display_name, falling back to the account email. ALWAYS
 * scoped to the given org (defence-in-depth on top of tenant RLS) so a name can never
 * resolve across tenants. Batched (one query) — no N+1. Ids that don't resolve are
 * simply absent from the map (the UI shows "—").
 */
export async function resolveUserNames(
  tx: Db,
  orgId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await tx
    .select({
      id: schema.userAccount.id,
      name: sql<string>`coalesce(${schema.party.displayName}, ${schema.userAccount.email}::text)`,
    })
    .from(schema.userAccount)
    .leftJoin(schema.party, eq(schema.party.id, schema.userAccount.partyId))
    .where(and(eq(schema.userAccount.orgId, orgId), inArray(schema.userAccount.id, unique)));
  for (const r of rows) map.set(r.id, r.name);
  return map;
}
