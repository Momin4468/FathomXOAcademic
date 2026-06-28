import { createHash, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL_DAYS, type PfPrincipal } from "@business-os/shared";

interface PfAccessClaims {
  sub: string; // pf_account id
  typ: "pf_access";
}
interface PfRefreshClaims {
  sub: string;
  jti: string;
  typ: "pf_refresh";
}

/**
 * PF tokens (§11). Distinct `typ` from the business tokens so a business token
 * can NEVER authenticate a PF request and vice versa — even though they're signed
 * with the same JWT secret. Same rotation/hash discipline as the business side.
 */
@Injectable()
export class PfTokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(p: PfPrincipal): string {
    const claims: PfAccessClaims = { sub: p.pfAccountId, typ: "pf_access" };
    return this.jwt.sign(claims, { expiresIn: ACCESS_TOKEN_TTL });
  }

  signRefresh(p: PfPrincipal): { token: string; jti: string } {
    const jti = randomUUID();
    const claims: PfRefreshClaims = { sub: p.pfAccountId, jti, typ: "pf_refresh" };
    const token = this.jwt.sign(claims, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });
    return { token, jti };
  }

  verifyAccess(token: string): PfAccessClaims {
    const claims = this.verify<PfAccessClaims>(token);
    if (claims.typ !== "pf_access") throw new UnauthorizedException("Wrong token type");
    return claims;
  }

  verifyRefresh(token: string): PfRefreshClaims {
    const claims = this.verify<PfRefreshClaims>(token);
    if (claims.typ !== "pf_refresh") throw new UnauthorizedException("Wrong token type");
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
