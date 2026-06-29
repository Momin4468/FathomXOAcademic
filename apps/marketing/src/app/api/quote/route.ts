import { NextResponse, type NextRequest } from "next/server";

/**
 * Public quote BFF. The marketing form posts here (same-origin); we forward the
 * multipart to the PRIVATE API's @Public /public/quote endpoint server-to-server
 * (no browser→API CORS, API_URL never reaches the client). Best-effort honeypot
 * + per-IP rate limit here; the API enforces the authoritative limits + file rule
 * + the lead/draft creation. We never return internal data — only {ok} / a message.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";

// Per-instance sliding-window limiter (best-effort; the API is authoritative).
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = Number(process.env.QUOTE_RATE_MAX ?? 6);
const hits = new Map<string, number[]>();
function allow(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_IP) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return true;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ message: "Invalid submission." }, { status: 400 });
  }

  // Rate-limit FIRST (before the honeypot short-circuit) so a bot can't hammer for free.
  const ip = clientIp(req);
  if (!allow(ip)) {
    return NextResponse.json({ message: "Too many requests — please try again in a little while." }, { status: 429 });
  }

  // Honeypot — a filled hidden field is a bot. Pretend success, forward nothing.
  const honeypot = form.get("website");
  if (typeof honeypot === "string" && honeypot.trim()) {
    return NextResponse.json({ ok: true });
  }

  try {
    const proxySecret = process.env.PUBLIC_INTAKE_PROXY_SECRET;
    const res = await fetch(`${API_URL}/public/quote`, {
      method: "POST",
      body: form, // multipart (incl. the brief) re-forwarded; fetch sets the boundary
      headers: {
        "x-forwarded-for": ip,
        // Lets the API trust the forwarded IP (only this BFF knows the secret).
        ...(proxySecret ? { "x-intake-proxy": proxySecret } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        (Array.isArray(body?.message) ? body.message.join(", ") : body?.message) ??
        "We couldn't submit your request. Please try WhatsApp.";
      return NextResponse.json({ message }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { message: "We couldn't reach our system right now. Please message us on WhatsApp." },
      { status: 502 },
    );
  }
}
