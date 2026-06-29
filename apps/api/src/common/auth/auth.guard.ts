import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { SessionPrincipal } from "@business-os/shared";
import { IS_CLIENT_KEY } from "./client-route.decorator.js";
import { IS_PF_KEY } from "./pf-route.decorator.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { TokenService } from "./token.service.js";

/**
 * Authentication. Verifies the Bearer access token and attaches the trusted
 * principal to the request. Routes marked @Public() skip it. This is the only
 * place the request identity is established — downstream code reads req.principal,
 * never client headers.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Personal-finance routes are authenticated by their own PfAuthGuard with a
    // PF token — the business guard yields so a business token can't reach them.
    const isPf = this.reflector.getAllAndOverride<boolean>(IS_PF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPf) return true;

    // Client-portal routes are authenticated by their own ClientAuthGuard with a
    // client token — the business guard yields so a business token can't reach them.
    const isClient = this.reflector.getAllAndOverride<boolean>(IS_CLIENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isClient) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { principal?: SessionPrincipal }>();
    const token = this.bearer(req);
    if (!token) throw new UnauthorizedException("Missing bearer token");

    const claims = this.tokens.verifyAccess(token); // throws 401 if invalid/expired
    req.principal = {
      userId: claims.sub,
      orgId: claims.orgId,
      partyId: claims.partyId,
      isSystemSuperadmin: claims.sysadmin,
    };
    return true;
  }

  private bearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(" ");
    return scheme?.toLowerCase() === "bearer" && value ? value : null;
  }
}
