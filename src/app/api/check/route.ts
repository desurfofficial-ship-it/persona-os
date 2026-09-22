import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { userFromRequest } from "@/lib/local-session";
import { scrubCliches, detectAiTells, detectForbidden } from "@/lib/quality";
import { voiceMatchScore, extractVoiceFingerprint } from "@/lib/voice";

interface CheckAnalysis {
  score: number;
  verdict: "Safe to post" | "Needs changes" | "Major rewrite needed";
  matches: string[];
  breaks: { quote: string; why: string; fix: string }[];
  rewrites: { original: string; rewrite: string }[];
}

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
      // try next
    }
  }
  return null;
}

function normalize(parsed: Record<string, unknown> | null): CheckAnalysis | null {
  if (!parsed) return null;
  const num = Number(parsed.score);
  const rawVerdict = String(parsed.verdict || "").toLowerCase();
  const verdict: CheckAnalysis["verdict"] = rawVerdict.includes("major")
    ? "Major rewrite needed"
    : rawVerdict.includes("change")
      ? "Needs changes"
      : "Safe to post";
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    score: Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 50,
    verdict,
    matches: arr(parsed.matches).map(String).slice(0, 5),
    breaks: arr(parsed.breaks)
      .map((b) => {
        const o = (b ?? {}) as Record<string, unknown>;
        return {
          quote: String(o.quote || "").slice(0, 200),
          why: String(o.why || "").slice(0, 300),
          fix: String(o.fix || "").slice(0, 300),
        };
      })
      .filter((b) => b.quote)
      .slice(0, 6),
    rewrites: arr(parsed.rewrites)
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return { original: String(o.original || "").slice(0, 300), rewrite: String(o.rewrite || "").slice(0, 500) };
      })
      .filter((r) => r.original && r.rewrite)
      .slice(0, 4),
  };
}

export async function POST(req: NextRequest) {
  // Agent-family routes are never public: AI quota belongs to signed-in users.
  const authUserId = userFromRequest(req);
  if (!authUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { persona, text, voiceSamples } = await req.json();

    if (!persona || !text) {
      return NextResponse.json({ error: "Missing persona or text" }, { status: 400 });
    }

    // Deterministic pre-passes — instant, free, and merged into the verdict.
    const clicheScan = scrubCliches(String(text));
    const aiTells = detectAiTells(String(text));
    const forbidden = detectForbidden(String(text), persona.forbidden_topics || []);
    const fp = extractVoiceFingerprint(
      [...(Array.isArray(voiceSamples) ? voiceSamples : [])].filter((s: string) => s?.length > 20)
    );
    const voiceScore = voiceMatchScore(String(text), fp);

    const systemPrompt = `You are an expert brand consistency analyst for personal content.

Analyze the text against this persona and return ONLY valid JSON:
{
  "score": 0-100 overall consistency with the persona,
  "verdict": "Safe to post" | "Needs changes" | "Major rewrite needed",
  "matches": ["specific things that sound exactly like them (quote fragments)"],
  "breaks": [{"quote": "exact fragment that breaks character", "why": "why it breaks (voice, backstory, rules, or tone)", "fix": "concrete replacement suggestion"}],
  "rewrites": [{"original": "weakest passage", "rewrite": "a better version in their voice"}]
}

PERSONA:
Name: ${persona.name}
Backstory: ${persona.backstory}
Tone of Voice: ${persona.tone_of_voice || "not specified"}
Lifestyle Pillars: ${(persona.lifestyle_pillars || []).join(", ") || "none"}
Content Rules: ${(persona.content_rules || []).join("; ") || "none"}
Forbidden Topics: ${(persona.forbidden_topics || []).join(", ") || "none"}

RULES:
- "breaks" quotes must be EXACT fragments from the text (short, under 12 words each).
- Be strict about voice: would a follower notice if this was ghostwritten?
- 2-5 breaks max; if the text is clean, return an empty array and a high score.
- JSON only — no markdown fences, no commentary.`;

    const userPrompt = `Analyze this text:\n\n${text}`;

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    let analysis: CheckAnalysis | null = null;

    const askOnce = async (): Promise<CheckAnalysis | null> => {
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
            temperature: 0.3,
            response_format: { type: "json_object" },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "OpenRouter error");
        return normalize(parseJsonLoose(data.choices?.[0]?.message?.content || ""));
      }
      // Preview fallback: built-in SDK.
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        thinking: { type: "disabled" },
      });
      const content = completion.choices[0]?.message?.content;
      return content ? normalize(parseJsonLoose(content)) : null;
    };

    try {
      analysis = await askOnce();
    } catch (e) {
      console.error("check LLM failed:", e);
    }

    // Merge deterministic findings — the LLM never overrides hard evidence.
    const breaks = [...(analysis?.breaks || [])];
    for (const topic of forbidden) {
      breaks.unshift({
        quote: topic,
        why: "This is on the persona's forbidden-topics list",
        fix: "Remove or reframe without naming it",
      });
    }
    for (const tell of aiTells) {
      breaks.unshift({
        quote: tell,
        why: "Reads like assistant output, not a human post",
        fix: "Delete the meta phrase and start with the actual content",
      });
    }
    if (clicheScan.removed.length) {
      breaks.unshift({
        quote: clicheScan.removed.join(", "),
        why: "Dead clichés that make writing feel ghostwritten",
        fix: "Replace with a specific, concrete detail from their world",
      });
    }

    const verdict: CheckAnalysis["verdict"] =
      forbidden.length || aiTells.some((t) => t.includes("AI") || t.includes("assistant"))
        ? "Major rewrite needed"
        : analysis?.verdict || (clicheScan.removed.length || breaks.length > 2 ? "Needs changes" : "Safe to post");

    // Composite score: LLM judgment weighted with the measured voice match.
    const base = analysis?.score ?? (breaks.length === 0 ? 80 : Math.max(30, 80 - breaks.length * 12));
    const score = analysis
      ? Math.round(base * 0.7 + (fp.samples ? voiceScore : base) * 0.3)
      : Math.round(Math.max(10, base - breaks.length * 10));

    return NextResponse.json({
      score,
      verdict,
      matches: analysis?.matches || [],
      breaks: breaks.slice(0, 8),
      rewrites: analysis?.rewrites || [],
      meta: {
        cliches: clicheScan.removed,
        aiTells,
        forbidden,
        voiceScore: fp.samples ? voiceScore : null,
        voiceSamples: fp.samples,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
