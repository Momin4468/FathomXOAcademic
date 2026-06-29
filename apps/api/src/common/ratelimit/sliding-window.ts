/**
 * A tiny dependency-free sliding-window rate limiter (CLAUDE.md §4 "rate-limit").
 * In-memory + per-process — best-effort abuse protection for a public endpoint
 * (a stronger distributed limiter / captcha is the documented upgrade). Keyed by
 * an arbitrary string (e.g. a client IP). `allow()` records a hit and returns
 * false once `max` hits fall inside `windowMs`.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Opportunistic cleanup so the map can't grow unbounded under attack.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }
}
