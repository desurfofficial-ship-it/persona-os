import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { posts } = await req.json();

    if (!posts || !posts.trim()) {
      return NextResponse.json({ error: "No posts provided" }, { status: 400 });
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;

    if (!openrouterKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY is required for this feature" },
        { status: 500 }
      );
    }

    const systemPrompt = `You are an expert at reverse-engineering personal brands and writing voices from real posts.

Analyze the provided posts and extract a clean persona definition.

Return ONLY valid JSON with these exact fields:
{
  "name": "short suggested name for this persona",
  "backstory": "2-4 sentence backstory that captures who this person is and what they stand for",
  "tone_of_voice": "clear description of how they sound (e.g. direct, irreverent, calm, high-agency)",
  "lifestyle_pillars": ["pillar1", "pillar2", "pillar3"],
  "content_rules": ["rule1", "rule2", "rule3"],
  "forbidden_topics": ["topic1", "topic2"]
}

Be specific. Infer rules and forbidden topics from what they never talk about and how they write. Do not invent things that contradict the posts.`;

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
          { role: "user", content: `Here are the posts:\n\n${posts}` },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
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
      // fallback if not pure JSON
      parsed = {
        name: "Extracted Persona",
        backstory: content.slice(0, 500),
        tone_of_voice: "Authentic and consistent",
        lifestyle_pillars: [],
        content_rules: [],
        forbidden_topics: [],
      };
    }

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 });
  }
}
