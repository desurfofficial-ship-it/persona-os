import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { assertPublicHttpUrl } from "@/lib/safeUrl";

/**
 * Read-only post import: best-effort fetch of a public profile's recent posts
 * (X / Twitter / LinkedIn public pages). Returns candidate post strings the
 * user can tick before feeding the persona builder.
 *
 * Honest constraints: X and LinkedIn heavily gate public content, and many
 * sandboxes have no outbound network. When fetching fails we say so and the
 * UI falls back to the guided manual paste — nothing pretends to work.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Round-3: cap how much of a page we buffer — huge pages are a memory-DoS. */
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

function normalizeUrl(raw: string): { url: URL; platform: "x" | "linkedin" | "other" } | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "x.com" || host === "twitter.com") return { url, platform: "x" };
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return { url, platform: "linkedin" };
  return { url, platform: "other" };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Pull plausible post-length text blocks out of a page. */
function extractCandidates(html: string): string[] {
  const text = stripHtml(html);
  const blocks = text
    .split(/\n{2,}|\r\n\r\n/)
    .map((b) => b.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];

  for (const b of blocks) {
    // Plausible "post" shape: long enough to be content, short enough to be one.
    if (b.length < 60 || b.length > 800) continue;
    // Skip obvious UI chrome.
    if (/^(log in|sign up|sign in|home|notifications|explore|jobs|privacy|terms|cookie)/i.test(b)) continue;
    if (/http[s]?:\/\//.test(b) && b.length < 120) continue;
    const key = b.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Round-3 hardened page fetch:
 *  - every hop (entry + each redirect) re-runs the SSRF guard with a fresh
 *    DNS resolution — `redirect: "follow"` would happily hop into the
 *    private network after passing the entry check;
 *  - response body is streamed and capped (huge pages are a memory-DoS);
 *  - only text/* pages are parsed.
 */
async function fetchWithTimeout(
  rawUrl: string,
  ms: number
): Promise<string | null> {
  let current = new URL(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const guard = await assertPublicHttpUrl(current.toString(), "profile URL");
    if (!guard.ok) {
      console.warn(`[import-posts] SSRF guard blocked: ${guard.reason}`);
      return null;
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(current, {
        signal: ctrl.signal,
        headers: { "User-Agent": UA, Accept: "text/html" },
        redirect: "manual",
      });

      // Follow redirects manually so every hop is re-validated.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        const next = new URL(loc, current);
        if (!/^https?:$/.test(next.protocol)) return null;
        current = next;
        continue;
      }

      if (!res.ok) return null;
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      if (ctype && !ctype.startsWith("text/")) return null;
      const declared = Number(res.headers.get("content-length") || 0);
      if (declared > MAX_PAGE_BYTES) return null;

      const reader = res.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PAGE_BYTES) {
          await reader.cancel().catch(() => {});
          return null;
        }
        if (value) chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  return null; // too many redirects
}

export async function POST(req: NextRequest) {
  // Agent-family routes are never public: AI quota belongs to signed-in users.
  const authUserId = userFromRequest(req);
  if (!authUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Round-3: outbound-fetch route — 20/min/user, before any parsing/fetch.
  const rl = await rateLimit(`import-posts:${clientKey(req, authUserId)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let rawUrl = "";
  try {
    ({ url: rawUrl } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizeUrl(rawUrl || "");
  if (!normalized) {
    return NextResponse.json(
      { error: "Enter a profile URL like x.com/yourhandle or linkedin.com/in/you" },
      { status: 400 }
    );
  }

  const { url, platform } = normalized;

  // Round-3 SSRF entry guard: the profile URL is fetched directly by the
  // server, so it must resolve to a globally routable address — no
  // loopback / private-network / cloud-metadata targets. (fetchWithTimeout
  // re-applies the guard to every redirect hop as well.)
  const entryGuard = await assertPublicHttpUrl(url.toString(), "profile URL");
  if (!entryGuard.ok) {
    return NextResponse.json({ error: entryGuard.reason }, { status: 400 });
  }

  // Try the page itself, then reader proxies that often expose text server-side.
  const attempts: string[] = [url.toString()];
  if (platform === "x") {
    attempts.push(`https://r.jina.ai/${url.toString()}`);
  }

  for (const attempt of attempts) {
    const html = await fetchWithTimeout(attempt, 8000);
    if (!html) continue;
    const posts = extractCandidates(html);
    if (posts.length > 0) {
      return NextResponse.json({
        platform,
        source: attempt === attempts[0] ? "page" : "reader",
        posts,
      });
    }
  }

  return NextResponse.json(
    {
      error:
        "Could not read posts from that link automatically. This is common — X and LinkedIn gate public pages hard. Use the paste box below: copy a few posts from your profile and drop them in (separate with blank lines).",
      fallback: true,
    },
    { status: 422 }
  );
}
