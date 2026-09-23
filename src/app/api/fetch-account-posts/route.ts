import { NextRequest, NextResponse } from "next/server";

function cleanHandle(raw: string) {
  return raw.replace(/^@/, "").replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "").split(/[/?]/)[0].trim();
}

/** Try public X syndication / nitter-style text extraction. Best-effort; may fail. */
async function fetchXPosts(handle: string): Promise<string[]> {
  const h = cleanHandle(handle);
  if (!h) throw new Error("Invalid X handle");

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

  // Split into rough post-sized chunks from the reader text
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
    // Fallback: use large chunks of the page text
    const chunks = text.match(/[^.!?]{80,400}[.!?]/g) || [];
    return chunks.slice(0, 8).map((c) => c.trim());
  }

  return posts.slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const { platform, handle } = await req.json();

    if (!platform || !handle) {
      return NextResponse.json({ error: "platform and handle required" }, { status: 400 });
    }

    if (platform === "x") {
      const posts = await fetchXPosts(handle);
      return NextResponse.json({
        posts,
        combined: posts.join("\n\n"),
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
    console.error(err);
    return NextResponse.json({ error: err.message || "Fetch failed" }, { status: 500 });
  }
}
