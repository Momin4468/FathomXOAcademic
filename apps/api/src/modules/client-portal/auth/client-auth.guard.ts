import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { ClientPrincipal } from "@business-os/shared";
import { IS_PUBLIC_KEY } from "../../../common/auth/public.decorator.js";
import { ClientTokenService } from "./client-token.service.js";

/**
 * Authentication for the CLIENT portal plane (Module 18). Applied at the
 * controller level (the global business AuthGuard yields for @ClientRoute).
 * Verifies the client Bearer token and attaches the client principal. @Public()
 * routes (login/refresh) skip it.
 */
@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: ClientTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { client?: ClientPrincipal }>();
    const token = this.bearer(req);
    if (!token) throw new UnauthorizedException("Missing bearer token");
    const claims = this.tokens.verifyAccess(token); // throws 401 if invalid/expired/wrong type
    req.client = { clientAccountId: claims.sub, orgId: claims.orgId, partyId: claims.partyId };
    return true;
  }

  private bearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(" ");
    return scheme?.toLowerCase() === "bearer" && value ? value : null;
  }
}
