import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import type { Request } from "express";

/**
 * Build the per-request RLS context from the AUTHENTICATED PRINCIPAL (set by
 * AuthGuard from the signed access token) — never from client-supplied headers.
 * This is the whole point of Module 0 depth: identity is server-trusted.
 *
 * isSuperadmin (the leg-visibility bypass GUC) is true ONLY for System
 * SuperAdmin (spec §4.4); it comes from the signed token, computed at login.
 */
export function extractRlsContext(req: Request): RlsContext {
  const principal = (req as Request & { principal?: SessionPrincipal }).principal;
  if (!principal) {
    throw new Error("No authenticated principal on request (AuthGuard missing or route public?)");
  }
  return {
    orgId: principal.orgId,
    partyId: principal.partyId,
    isSuperadmin: principal.isSystemSuperadmin,
  };
}

/** Inject the request's RlsContext (derived from the signed token). */
export const CurrentRls = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RlsContext =>
    extractRlsContext(ctx.switchToHttp().getRequest<Request>()),
);
