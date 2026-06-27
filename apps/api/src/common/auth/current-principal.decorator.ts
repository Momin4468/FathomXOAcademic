import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { SessionPrincipal } from "@business-os/shared";
import type { Request } from "express";

/** The authenticated principal attached by AuthGuard (from the signed token). */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionPrincipal => {
    const req = ctx.switchToHttp().getRequest<Request & { principal?: SessionPrincipal }>();
    if (!req.principal) throw new Error("No principal on request (AuthGuard missing?)");
    return req.principal;
  },
);
