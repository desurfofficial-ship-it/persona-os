import { NextRequest, NextResponse } from "next/server";

async function fetchUrlText(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http(s) URLs allowed");
  }

  const res = await fetch(parsed.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PersonaOS/1.0; +https://persona-os.app)",
      Accept: "text/html,application/xhtml+xml,text/plain",
    },
    signal: AbortSignal.timeout(12000),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Could not fetch URL (${res.status}). Paste the page text instead.`);
  }

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 80) {
    throw new Error(
      "Could not extract enough text from that URL (page may be blocked or empty). Paste posts manually."
    );
  }

  return text.slice(0, 15000);
}

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    let posts = typeof body.posts === "string" ? body.posts : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (url) {
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return NextResponse.json({ error: "URL must start with http:// or https://" }, { status: 400 });
      }
      try {
        const fetched = await fetchUrlText(url);
        posts = posts ? `${posts}\n\n${fetched}` : fetched;
      } catch (e: any) {
        return NextResponse.json({ error: e.message || "URL fetch failed" }, { status: 400 });
      }
    }

    posts = posts.trim().slice(0, 20000);
    if (!posts) {
      return NextResponse.json(
        { error: "Provide posts text or a public profile/blog URL" },
        { status: 400 }
      );
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;

    if (!openrouterKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY is required for this feature" },
        { status: 500 }
      );
    }

    const systemPrompt = `You are an expert at reverse-engineering personal brands and writing voices from real posts or profile content.

Analyze the provided text and extract a clean persona definition.

Return ONLY valid JSON with these exact fields:
{
  "name": "short suggested name for this persona",
  "backstory": "2-4 sentence backstory that captures who this person is and what they stand for",
  "tone_of_voice": "clear description of how they sound (e.g. direct, irreverent, calm, high-agency)",
  "lifestyle_pillars": ["pillar1", "pillar2", "pillar3"],
  "content_rules": ["rule1", "rule2", "rule3"],
  "forbidden_topics": ["topic1", "topic2"],
  "example_posts": ["short excerpt or reconstructed sample post 1", "sample 2", "sample 3"]
}

For example_posts: extract or lightly clean 3-5 of the strongest real post-like excerpts from the input (keep them short). If input is mostly bio text, invent 3 sample posts that match the voice.

Be specific. Infer rules and forbidden topics from what they never talk about and how they write. Do not invent things that contradict the source.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openrouterKey}`,
          "HTTP-Referer": "https://persona-os.app",
          "X-Title": "Persona OS",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Here is the source material:\n\n${posts.slice(0, 12000)}` },
          ],
          temperature: 0.4,
          response_format: { type: "json_object" },
          max_tokens: 1500,
        }),
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "OpenRouter error");
      }

      const content = data.choices?.[0]?.message?.content || "{}";
      let parsed;

      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = {
          name: "Extracted Persona",
          backstory: content.slice(0, 500),
          tone_of_voice: "Authentic and consistent",
          lifestyle_pillars: [],
          content_rules: [],
          forbidden_topics: [],
          example_posts: [],
        };
      }

      // Normalize arrays
      const asArr = (v: unknown) =>
        Array.isArray(v) ? v.map((x) => String(x).slice(0, 500)).filter(Boolean).slice(0, 12) : [];

      return NextResponse.json({
        name: String(parsed.name || "My Persona").slice(0, 120),
        backstory: String(parsed.backstory || "").slice(0, 4000),
        tone_of_voice: String(parsed.tone_of_voice || "").slice(0, 500),
        lifestyle_pillars: asArr(parsed.lifestyle_pillars),
        content_rules: asArr(parsed.content_rules),
        forbidden_topics: asArr(parsed.forbidden_topics),
        example_posts: asArr(parsed.example_posts).slice(0, 8),
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return NextResponse.json({ error: "Analysis timed out. Try fewer posts." }, { status: 504 });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    console.error("[analyze-posts]", err);
    return NextResponse.json(
      { error: String(err.message || "Server error").slice(0, 300) },
      { status: 500 }
    );
  }
}
