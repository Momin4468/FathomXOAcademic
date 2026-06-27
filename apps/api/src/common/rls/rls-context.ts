import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RlsContext } from "@business-os/shared";
import type { Request } from "express";

/** The seed org/party, used as defaults so the demo works without real auth. */
export const DEMO_ORG_ID = "00000000-0000-0000-0000-000000000001";
export const DEMO_PARTY_MOMIN = "00000000-0000-0000-0000-0000000000c1";

/**
 * STUB auth (replaced by the real auth module later). Today the security context
 * is taken from request headers so the RLS plumbing can be exercised end-to-end:
 *   x-org-id, x-party-id, x-superadmin: true|false
 * Defaults to the seed org + Momin so `GET /platform/whoami` works out of the box.
 */
export function extractRlsContext(req: Request): RlsContext {
  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    orgId: header("x-org-id") ?? DEMO_ORG_ID,
    partyId: header("x-party-id") ?? DEMO_PARTY_MOMIN,
    isSuperadmin: (header("x-superadmin") ?? "false").toLowerCase() === "true",
  };
}

/** Inject the request's RlsContext into a controller handler. */
export const CurrentRls = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RlsContext =>
    extractRlsContext(ctx.switchToHttp().getRequest<Request>()),
);
