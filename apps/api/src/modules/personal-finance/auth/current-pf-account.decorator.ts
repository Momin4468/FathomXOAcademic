import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import type { Request } from "express";

/** The authenticated PF identity attached by PfAuthGuard (from the signed PF token). */
export const CurrentPfAccount = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PfPrincipal => {
    const req = ctx.switchToHttp().getRequest<Request & { pfAccount?: PfPrincipal }>();
    if (!req.pfAccount) throw new Error("No PF principal on request (PfAuthGuard missing?)");
    return req.pfAccount;
  },
);
