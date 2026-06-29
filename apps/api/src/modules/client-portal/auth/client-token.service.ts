import { createHash, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL_DAYS, type ClientPrincipal } from "@business-os/shared";

interface ClientAccessClaims {
  sub: string; // client_account id
  orgId: string;
  partyId: string;
  typ: "client_access";
}
interface ClientRefreshClaims {
  sub: string;
  orgId: string;
  partyId: string;
  jti: string;
  typ: "client_refresh";
}

/**
 * Client-portal tokens (Module 18). Distinct `typ` from the business and PF
 * tokens so no plane's token can authenticate another — even though they share
 * one JWT secret. The token carries orgId+partyId so the plane rebuilds the
 * business RLS context (scoped to the client party) without a DB round-trip.
 */
@Injectable()
export class ClientTokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(p: ClientPrincipal): string {
    const claims: ClientAccessClaims = {
      sub: p.clientAccountId,
      orgId: p.orgId,
      partyId: p.partyId,
      typ: "client_access",
    };
    return this.jwt.sign(claims, { expiresIn: ACCESS_TOKEN_TTL });
  }

  signRefresh(p: ClientPrincipal): { token: string; jti: string } {
    const jti = randomUUID();
    const claims: ClientRefreshClaims = {
      sub: p.clientAccountId,
      orgId: p.orgId,
      partyId: p.partyId,
      jti,
      typ: "client_refresh",
    };
    const token = this.jwt.sign(claims, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });
    return { token, jti };
  }

  verifyAccess(token: string): ClientAccessClaims {
    const claims = this.verify<ClientAccessClaims>(token);
    if (claims.typ !== "client_access") throw new UnauthorizedException("Wrong token type");
    return claims;
  }

  verifyRefresh(token: string): ClientRefreshClaims {
    const claims = this.verify<ClientRefreshClaims>(token);
    if (claims.typ !== "client_refresh") throw new UnauthorizedException("Wrong token type");
    return claims;
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private verify<T extends object>(token: string): T {
    try {
      return this.jwt.verify<T>(token, { algorithms: ["HS256"] });
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
