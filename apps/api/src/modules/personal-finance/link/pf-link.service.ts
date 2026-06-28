import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { sql } from "@business-os/db";
import type { PfPrincipal } from "@business-os/shared";
import { DbService } from "../../../common/db/db.service.js";
import { PfAuditService } from "../pf-audit.service.js";

/**
 * PF side of the income link (§11). Consumes a code minted business-side: sets
 * this account's linked party and backfills past payouts as income (idempotent).
 * Runs entirely through the pf_consume_link_token definer — the PF caller never
 * sees any business data, only a backfilled count.
 */
@Injectable()
export class PfLinkService {
  constructor(
    private readonly db: DbService,
    private readonly audit: PfAuditService,
  ) {}

  async consume(principal: PfPrincipal, code: string): Promise<{ linked: true; backfilled: number }> {
    const hash = createHash("sha256").update(code).digest("hex");
    return this.db.withPfAccount({ pfAccountId: principal.pfAccountId }, async (tx) => {
      let backfilled = 0;
      try {
        const res = await tx.execute(sql`select backfilled from pf_consume_link_token(${hash})`);
        backfilled = Number((res.rows[0] as { backfilled: number } | undefined)?.backfilled ?? 0);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err.code === "23505") {
          throw new ConflictException("This income stream is already linked to another personal account.");
        }
        throw new BadRequestException("Invalid or expired link code.");
      }
      await this.audit.record(tx, principal.pfAccountId, {
        action: "pf.income_linked",
        entity: "pf_account",
        entityId: principal.pfAccountId,
        detail: { backfilled },
      });
      return { linked: true, backfilled };
    });
  }
}
