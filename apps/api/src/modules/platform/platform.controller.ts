import { Controller, Get } from "@nestjs/common";
import { schema, sql } from "@business-os/db";
import type { RlsContext } from "@business-os/shared";
import { eq } from "drizzle-orm";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";

@Controller()
export class PlatformController {
  constructor(private readonly db: DbService) {}

  /** Liveness probe — no DB. */
  @Get("health")
  health() {
    return { status: "ok", service: "business-os-api" };
  }

  /**
   * Proves the per-request RLS plumbing: the controller's security context is
   * pushed into Postgres session GUCs, and the DB reads back the SAME identity
   * (current_setting) plus the party visible under that context. If the GUCs and
   * the DB ever disagree, this endpoint reveals it.
   */
  @Get("platform/whoami")
  async whoami(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, async (tx) => {
      const gucs = await tx.execute(
        sql`select app_current_org()::text as org_id,
                   app_current_party()::text as party_id,
                   app_is_superadmin() as is_superadmin`,
      );
      const party = ctx.partyId
        ? await tx
            .select({ id: schema.party.id, displayName: schema.party.displayName })
            .from(schema.party)
            .where(eq(schema.party.id, ctx.partyId))
        : [];
      return {
        context: ctx,
        dbSeesContext: gucs.rows[0],
        party: party[0] ?? null,
      };
    });
  }
}
