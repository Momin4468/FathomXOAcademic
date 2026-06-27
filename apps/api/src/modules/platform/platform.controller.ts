import { Controller, Get } from "@nestjs/common";
import { schema, sql } from "@business-os/db";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { eq } from "drizzle-orm";
import { PermissionService } from "../../common/authz/permission.service.js";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { Public } from "../../common/auth/public.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";

@Controller()
export class PlatformController {
  constructor(
    private readonly db: DbService,
    private readonly permissions: PermissionService,
  ) {}

  /** Liveness probe — public, no DB, no auth. */
  @Public()
  @Get("health")
  health() {
    return { status: "ok", service: "business-os-api" };
  }

  /**
   * Proves identity is server-trusted: the RLS context is derived from the SIGNED
   * token (principal), pushed into Postgres GUCs, and read back via current_setting
   * — they must match. Also surfaces the caller's roles + effective permissions.
   * A forged x-party-id / x-superadmin header has no effect (the stub is gone).
   */
  @Get("platform/whoami")
  async whoami(
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentRls() ctx: RlsContext,
  ) {
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
      const eff = await this.permissions.loadEffective(tx, principal.userId);
      return {
        principal,
        dbSeesContext: gucs.rows[0],
        party: party[0] ?? null,
        roleNames: eff.roleNames,
        permissions: [...eff.perms].sort(),
      };
    });
  }
}
