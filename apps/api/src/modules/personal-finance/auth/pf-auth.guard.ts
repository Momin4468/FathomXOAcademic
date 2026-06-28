import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { PfPrincipal } from "@business-os/shared";
import { IS_PUBLIC_KEY } from "../../../common/auth/public.decorator.js";
import { PfTokenService } from "./pf-token.service.js";

/**
 * Authentication for the PERSONAL-FINANCE plane (§11). Applied at the controller
 * level (the global business AuthGuard yields for @PfRoute). Verifies the PF
 * Bearer token and attaches the PF principal. @Public() routes (login/register/
 * refresh) skip it.
 */
@Injectable()
export class PfAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: PfTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { pfAccount?: PfPrincipal }>();
    const token = this.bearer(req);
    if (!token) throw new UnauthorizedException("Missing bearer token");
    const claims = this.tokens.verifyAccess(token); // throws 401 if invalid/expired/wrong type
    req.pfAccount = { pfAccountId: claims.sub };
    return true;
  }

  private bearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(" ");
    return scheme?.toLowerCase() === "bearer" && value ? value : null;
  }
}
