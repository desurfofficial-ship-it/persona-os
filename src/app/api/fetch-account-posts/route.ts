import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/server/agentAuth";
import { clientKey, rateLimit } from "@/lib/rateLimit";

function cleanHandle(raw: string) {
  return raw
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 40);
}

async function fetchXPosts(handle: string): Promise<string[]> {
  const h = cleanHandle(handle);
  if (!h || h.length < 1) throw new Error("Invalid X handle");

  const urls = [
    `https://r.jina.ai/http://x.com/${h}`,
    `https://r.jina.ai/http://twitter.com/${h}`,
  ];

  let text = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/plain" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        text = await res.text();
        if (text.length > 200) break;
      }
    } catch {
      /* try next */
    }
  }

  if (!text || text.length < 100) {
    throw new Error(
      "Could not pull posts from that X account (private, rate-limited, or blocked). Paste posts manually or use a public blog URL."
    );
  }

  // Cap raw text
  text = text.slice(0, 30000);

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 40 && !l.startsWith("http") && !/^\d+$/.test(l));

  const posts: string[] = [];
  let buf = "";
  for (const line of lines) {
    if (line.length > 280 && posts.length < 12) {
      posts.push(line.slice(0, 500));
    } else {
      buf += (buf ? " " : "") + line;
      if (buf.length > 120) {
        posts.push(buf.slice(0, 500));
        buf = "";
      }
    }
    if (posts.length >= 10) break;
  }
  if (buf.length > 40 && posts.length < 10) posts.push(buf.slice(0, 500));

  if (posts.length < 2) {
    const chunks = text.match(/[^.!?]{80,400}[.!?]/g) || [];
    return chunks.slice(0, 8).map((c) => c.trim());
  }

  return posts.slice(0, 10);
}

export async function POST(req: NextRequest) {
  // Outbound fetches + jina quota belong to signed-in users only.
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Each call burns a real outbound jina fetch — cap it per user.
  const rl = rateLimit(`fetch-account-posts:${clientKey(req, userId)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s.` },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      }
    );
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const platform = body.platform;
    const handle = typeof body.handle === "string" ? body.handle : "";

    if (!platform || !handle) {
      return NextResponse.json({ error: "platform and handle required" }, { status: 400 });
    }

    if (platform === "x") {
      const posts = await fetchXPosts(handle);
      return NextResponse.json({
        posts,
        combined: posts.join("\n\n").slice(0, 15000),
        handle: cleanHandle(handle),
        platform: "x",
      });
    }

    if (platform === "linkedin") {
      return NextResponse.json(
        {
          error:
            "LinkedIn does not allow public post scraping. Paste your best posts or use your public profile URL on Build from Posts.",
          suggest: "from-posts",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  } catch (err: any) {
    console.error("[fetch-account-posts]", err);
    return NextResponse.json(
      { error: String(err.message || "Fetch failed").slice(0, 300) },
      { status: 500 }
    );
  }
}
