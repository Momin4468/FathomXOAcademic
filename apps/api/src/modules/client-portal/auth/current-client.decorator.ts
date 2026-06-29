import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { ClientPrincipal } from "@business-os/shared";
import type { Request } from "express";

/** The authenticated client identity attached by ClientAuthGuard (signed token). */
export const CurrentClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientPrincipal => {
    const req = ctx.switchToHttp().getRequest<Request & { client?: ClientPrincipal }>();
    if (!req.client) throw new Error("No client principal on request (ClientAuthGuard missing?)");
    return req.client;
  },
);
