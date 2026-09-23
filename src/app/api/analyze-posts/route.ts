import { NextRequest, NextResponse } from "next/server";
import { llmComplete } from "@/lib/generation";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";

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
      // try next
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authUserId = userFromRequest(req);
  if (!authUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`analyze:${clientKey(req, authUserId)}`, 20, 60_000);
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
    const { posts } = await req.json();

    if (!posts || typeof posts !== "string" || !posts.trim()) {
      return NextResponse.json({ error: "No posts provided" }, { status: 400 });
    }

    const clipped = posts.trim().slice(0, 20000);

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

    const userPrompt = `Here are the posts:\n\n${clipped}`;

    try {
      const llm = await llmComplete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        0.4,
        { json: true }
      );
      const parsed = parseJsonLoose(llm.content);
      if (parsed) {
        return NextResponse.json({
          name: parsed.name || "Extracted Persona",
          backstory: parsed.backstory || llm.content.slice(0, 500),
          tone_of_voice: parsed.tone_of_voice || "Authentic and consistent",
          lifestyle_pillars: Array.isArray(parsed.lifestyle_pillars) ? parsed.lifestyle_pillars : [],
          content_rules: Array.isArray(parsed.content_rules) ? parsed.content_rules : [],
          forbidden_topics: Array.isArray(parsed.forbidden_topics) ? parsed.forbidden_topics : [],
        });
      }
    } catch (llmErr) {
      console.error("analyze-posts LLM chain failed:", llmErr);
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
