import { createHash, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
  type SessionPrincipal,
} from "@business-os/shared";

interface AccessClaims {
  sub: string;
  orgId: string;
  partyId: string | null;
  sysadmin: boolean;
  typ: "access";
}
interface RefreshClaims {
  sub: string;
  orgId: string;
  partyId: string | null;
  jti: string;
  typ: "refresh";
}

/** Signs/verifies access + refresh JWTs and hashes refresh tokens for storage. */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(p: SessionPrincipal): string {
    const claims: AccessClaims = {
      sub: p.userId,
      orgId: p.orgId,
      partyId: p.partyId,
      sysadmin: p.isSystemSuperadmin,
      typ: "access",
    };
    return this.jwt.sign(claims, { expiresIn: ACCESS_TOKEN_TTL });
  }

  /** Returns the opaque refresh JWT and its jti. Store hashToken(token) server-side. */
  signRefresh(p: Pick<SessionPrincipal, "userId" | "orgId" | "partyId">): {
    token: string;
    jti: string;
  } {
    const jti = randomUUID();
    const claims: RefreshClaims = {
      sub: p.userId,
      orgId: p.orgId,
      partyId: p.partyId,
      jti,
      typ: "refresh",
    };
    const token = this.jwt.sign(claims, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });
    return { token, jti };
  }

  verifyAccess(token: string): AccessClaims {
    const claims = this.verify<AccessClaims>(token);
    if (claims.typ !== "access") throw new UnauthorizedException("Wrong token type");
    return claims;
  }

  verifyRefresh(token: string): RefreshClaims {
    const claims = this.verify<RefreshClaims>(token);
    if (claims.typ !== "refresh") throw new UnauthorizedException("Wrong token type");
    return claims;
  }

  /** Deterministic hash stored in auth_refresh_token.token_hash (never the token). */
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
