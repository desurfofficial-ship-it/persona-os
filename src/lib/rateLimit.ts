/**
 * Simple in-memory rate limiter for AI and auth-sensitive routes.
 * Per-process only (fine for single-node preview). Production should use
 * Redis / edge rate limits.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);

  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }

  b.count += 1;

  if (b.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - b.count),
    retryAfterSec: 0,
  };
}

/** Client IP best-effort (behind proxies this may be shared). */
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return `ip:${xf.split(",")[0].trim()}`;
  return "ip:unknown";
}

// Occasional cleanup so the map does not grow forever in long-lived processes
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}, 60_000).unref?.();
