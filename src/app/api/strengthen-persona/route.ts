import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { userFromRequest } from "@/lib/local-session";

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
  // Agent-family routes are never public: AI quota belongs to signed-in users.
  const authUserId = userFromRequest(req);
  if (!authUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { persona } = await req.json();

    if (!persona) {
      return NextResponse.json({ error: "Missing persona" }, { status: 400 });
    }

    const systemPrompt = `You are an expert at sharpening personal brands and content personas.

Take the existing persona and make it significantly stronger, clearer, and more usable for consistent content generation.

Return ONLY valid JSON with these fields:
{
  "name": "improved or same name",
  "backstory": "stronger, more specific 2-4 sentence backstory",
  "tone_of_voice": "sharper, more distinctive tone description",
  "lifestyle_pillars": ["3-5 clear pillars"],
  "content_rules": ["4-6 concrete rules that improve consistency"],
  "forbidden_topics": ["topics to avoid"]
}

Make the persona more specific and higher-signal. Remove vagueness. Respond with the JSON object only — no markdown fences, no commentary.`;

    const userPrompt = `Current persona:\n${JSON.stringify(persona, null, 2)}`;

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
            {
              role: "user",
              content: userPrompt,
            },
          ],
          temperature: 0.5,
          response_format: { type: "json_object" },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "OpenRouter error");

      const content = data.choices?.[0]?.message?.content || "{}";
      const parsed = parseJsonLoose(content);

      return NextResponse.json(parsed ?? persona);
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
            name: parsed.name || persona.name,
            backstory: parsed.backstory || persona.backstory,
            tone_of_voice: parsed.tone_of_voice || persona.tone_of_voice,
            lifestyle_pillars: Array.isArray(parsed.lifestyle_pillars)
              ? parsed.lifestyle_pillars
              : persona.lifestyle_pillars || [],
            content_rules: Array.isArray(parsed.content_rules)
              ? parsed.content_rules
              : persona.content_rules || [],
            forbidden_topics: Array.isArray(parsed.forbidden_topics)
              ? parsed.forbidden_topics
              : persona.forbidden_topics || [],
          });
        }
      }
    } catch (sdkErr) {
      console.error("Built-in LLM fallback failed:", sdkErr);
    }

    return NextResponse.json(
      { error: "AI strengthening is currently unavailable. Add OPENROUTER_API_KEY to enable it." },
      { status: 503 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
