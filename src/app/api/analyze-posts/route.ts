import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

/** Extract a JSON object from a model response that may be fenced or wrapped. */
function parseJsonLoose(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const candidates: string[] = [];

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) candidates.push(fenceMatch[1]);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(trimmed);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { posts } = await req.json();

    if (!posts || !posts.trim()) {
      return NextResponse.json({ error: "No posts provided" }, { status: 400 });
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

Be specific. Infer rules and forbidden topics from what they never talk about and how they write. Do not invent things that contradict the posts. Respond with the JSON object only — no markdown fences, no commentary.`;

    const userPrompt = `Here are the posts:\n\n${posts}`;

    const openrouterKey = process.env.OPENROUTER_API_KEY;

    if (openrouterKey) {
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
            { role: "user", content: userPrompt },
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
      const parsed = parseJsonLoose(content);

      return NextResponse.json(
        parsed ?? {
          name: "Extracted Persona",
          backstory: content.slice(0, 500),
          tone_of_voice: "Authentic and consistent",
          lifestyle_pillars: [],
          content_rules: [],
          forbidden_topics: [],
        }
      );
    }

    // Preview fallback: use the built-in LLM SDK when no OpenRouter key is set.
    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "assistant", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        thinking: { type: "disabled" },
      });
      const content = completion.choices[0]?.message?.content;
      if (content && content.trim()) {
        const parsed = parseJsonLoose(content);
        if (parsed) {
          return NextResponse.json({
            name: parsed.name || "Extracted Persona",
            backstory: parsed.backstory || "",
            tone_of_voice: parsed.tone_of_voice || "",
            lifestyle_pillars: Array.isArray(parsed.lifestyle_pillars) ? parsed.lifestyle_pillars : [],
            content_rules: Array.isArray(parsed.content_rules) ? parsed.content_rules : [],
            forbidden_topics: Array.isArray(parsed.forbidden_topics) ? parsed.forbidden_topics : [],
          });
        }
      }
    } catch (sdkErr) {
      console.error("Built-in LLM fallback failed:", sdkErr);
    }

    return NextResponse.json(
      { error: "AI analysis is currently unavailable. Add OPENROUTER_API_KEY to enable it." },
      { status: 503 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
