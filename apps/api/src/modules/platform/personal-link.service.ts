import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { AuditService } from "../../common/audit/audit.service.js";

/** Link tokens are short-lived — connect your income stream promptly. */
const LINK_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Business side of the personal-finance LINK seam (§11). An authenticated
 * business user mints a single-use, expiring code for THEIR OWN party; they then
 * enter it inside their (separate) PF account to connect their income stream.
 * One-way: we write a hashed token via the pf_mint_link_token definer and never
 * read the PF plane.
 */
@Injectable()
export class PersonalLinkService {
  constructor(private readonly audit: AuditService) {}

  async mintLinkToken(tx: Db, principal: SessionPrincipal): Promise<{ code: string; expiresAt: string }> {
    if (!principal.partyId) {
      throw new BadRequestException("Your account isn't linked to a party, so there's no income stream to connect.");
    }
    const code = randomBytes(24).toString("base64url");
    const hash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);
    await tx.execute(sql`
      select pf_mint_link_token(${principal.partyId}::uuid, ${hash}, ${expiresAt.toISOString()}::timestamptz)
    `);
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "personal_finance.link_token_minted",
      entity: "party",
      entityId: principal.partyId,
    });
    // Return the plaintext code ONCE (only the hash is stored).
    return { code, expiresAt: expiresAt.toISOString() };
  }
}
