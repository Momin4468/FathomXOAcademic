import type { Request } from "express";

/**
 * Best-effort client IP for rate-limiting. The web BFF forwards X-Forwarded-For;
 * we take the first hop, falling back to the socket IP. Used only to key the
 * (best-effort, in-process) rate limiters — never for authorization. A spoofed XFF
 * can shift the per-IP bucket, but the per-identifier limit still bounds abuse.
 */
export function clientIpOf(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const xff = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return xff || req.ip || "unknown";
}
