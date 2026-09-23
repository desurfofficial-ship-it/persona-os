import { NextRequest, NextResponse } from "next/server";
import { llmComplete } from "@/lib/generation";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";

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

  const rl = rateLimit(`strengthen-persona:${clientKey(req, authUserId)}`, 20, 60_000);
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

    /**
     * One unified provider chain (OpenRouter → OpenAI → Anthropic → built-in,
     * with retries + JSON mode — see src/lib/generation.ts). Replaces the old
     * two-branch code that hardcoded the region-blocked openai/gpt-4o-mini.
     */
    try {
      const llm = await llmComplete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        0.5,
        { json: true }
      );
      const parsed = parseJsonLoose(llm.content);
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
    } catch (llmErr) {
      console.error("strengthen-persona LLM chain failed:", llmErr);
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
