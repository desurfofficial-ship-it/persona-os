/**
 * Persistent fixed-window rate limiter for AI and auth-sensitive routes.
 *
 * Round-3: buckets used to live in a per-process Map, which meant (a) every
 * dev-server restart reset every budget to full, and (b) any second server
 * instance got a fresh set of budgets. Buckets now persist in SQLite via
 * Prisma and are shared by every process pointing at the same database file.
 *
 * Atomicity: a single SQLite UPSERT ... RETURNING does read-increment-write
 * in one statement, so concurrent requests cannot race past the limit.
 *
 * Availability: if the database is unreachable, the limiter fails over to
 * per-process memory buckets (round-2 behavior) and logs once — an outage of
 * the counter store must not take the app's request path down with it.
 */

import { db } from "@/lib/db";

interface Bucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Round-2 fallback path — per-process only, used while the DB is down. */
function memoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let b = memoryBuckets.get(key);

  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    memoryBuckets.set(key, b);
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

let loggedDbDown = false;
let lastSweep = 0;

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();

  try {
    const resetAt = now + windowMs;

    // Atomic fixed-window increment. The window is anchored at the FIRST
    // hit: while the stored resetAt is still in the future every hit just
    // increments; once it has passed the counter restarts with a fresh
    // window. (Comparing the new resetAt against the stored one instead —
    // as a first version of this UPSERT did — is always true and silently
    // disables the limit entirely. The battery caught exactly that.)
    const rows = await db.$queryRaw<Array<{ count: number; resetAt: bigint }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt}
          ELSE "RateLimitBucket"."resetAt"
        END
      RETURNING "count", "resetAt"`;

    loggedDbDown = false; // DB answered — re-arm the outage warning
    const row = rows[0];
    const count = row?.count ?? 1;
    const bucketResetAt = row ? Number(row.resetAt) : resetAt;

    // Occasional fire-and-forget sweep of long-expired buckets.
    if (now - lastSweep > 300_000) {
      lastSweep = now;
      db.rateLimitBucket
        .deleteMany({ where: { resetAt: { lt: BigInt(now - 3_600_000) } } })
        .catch(() => {});
    }

    if (count > limit) {
      return {
        ok: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((bucketResetAt - now) / 1000)),
      };
    }

    return {
      ok: true,
      remaining: Math.max(0, limit - count),
      retryAfterSec: 0,
    };
  } catch (err) {
    if (!loggedDbDown) {
      loggedDbDown = true;
      console.error(
        "[rateLimit] counter store unavailable — failing over to in-memory buckets:",
        err instanceof Error ? err.message : err
      );
    }
    return memoryLimit(key, limit, windowMs);
  }
}

/** Client IP best-effort (behind proxies this may be shared). */
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return `ip:${xf.split(",")[0].trim()}`;
  return "ip:unknown";
}

// Memory-fallback cleanup so the map does not grow forever in long-lived
// processes while the DB is down.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of memoryBuckets) {
    if (now >= b.resetAt) memoryBuckets.delete(k);
  }
}, 60_000).unref?.();
