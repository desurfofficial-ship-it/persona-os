import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/local-session";

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

async function fetchWithTimeout(url: string, ms: number): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: NextRequest) {
  // Agent-family routes are never public: AI quota belongs to signed-in users.
  const authUserId = userFromRequest(req);
  if (!authUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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
