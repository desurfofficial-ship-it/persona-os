import { NextRequest, NextResponse } from "next/server";
import { sanitizePersona } from "@/lib/persona-prompt";

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { persona: rawPersona, text, mode } = body;

    if (!rawPersona || !text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing persona or text" }, { status: 400 });
    }

    const clippedText = text.trim().slice(0, 12000);
    if (!clippedText) {
      return NextResponse.json({ error: "Text is empty" }, { status: 400 });
    }

    let persona;
    try {
      persona = sanitizePersona(rawPersona);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Invalid persona" }, { status: 400 });
    }

    const examples =
      persona.example_posts.length > 0
        ? `\nGold examples:\n${persona.example_posts.slice(0, 5).join("\n---\n")}`
        : "";

    const openrouterKey = process.env.OPENROUTER_API_KEY;

    if (mode === "score") {
      const systemPrompt = `You score how well text matches a persona. Reply with ONLY a JSON object:
{"score": number 0-100, "verdict": "Safe to post" | "Needs changes" | "Major rewrite", "note": "one short sentence"}

PERSONA: ${persona.name}
Tone: ${persona.tone_of_voice || "n/a"}
Rules: ${persona.content_rules.join("; ") || "none"}
Forbidden: ${persona.forbidden_topics.join(", ") || "none"}
${examples}`;

      if (!openrouterKey) {
        return NextResponse.json({
          score: null,
          verdict: null,
          note: "Add OPENROUTER_API_KEY for scoring",
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

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
              { role: "user", content: clippedText },
            ],
            temperature: 0.2,
            response_format: { type: "json_object" },
            max_tokens: 200,
          }),
          signal: controller.signal,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "OpenRouter error");

        let parsed: { score?: number; verdict?: string; note?: string } = {};
        try {
          parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
        } catch {
          /* ignore */
        }

        const score =
          typeof parsed.score === "number"
            ? Math.max(0, Math.min(100, Math.round(parsed.score)))
            : null;

        return NextResponse.json({
          score,
          verdict: parsed.verdict || null,
          note: parsed.note ? String(parsed.note).slice(0, 200) : null,
        });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return NextResponse.json({ score: null, verdict: null, note: "Score timed out" });
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    const systemPrompt = `You are an expert brand consistency analyst.

Analyze the provided text against this persona and give a clear, structured report.

PERSONA:
Name: ${persona.name}
Backstory: ${persona.backstory}
Tone of Voice: ${persona.tone_of_voice || "not specified"}
Lifestyle Pillars: ${persona.lifestyle_pillars.join(", ") || "none"}
Content Rules: ${persona.content_rules.join("; ") || "none"}
Forbidden Topics: ${persona.forbidden_topics.join(", ") || "none"}
${examples}

Your response must include:
1. Overall Consistency Score (0-100)
2. What matches the persona well
3. What breaks character or conflicts
4. Specific suggested rewrites for any problematic parts
5. Final verdict (Safe to post / Needs changes / Major rewrite needed)

Be direct and practical.`;

    if (!openrouterKey) {
      return NextResponse.json({
        content: `Consistency analysis requires OPENROUTER_API_KEY.\n\nText length: ${clippedText.length} characters\nPersona: ${persona.name}`,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

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
            { role: "user", content: `Analyze this text:\n\n${clippedText}` },
          ],
          temperature: 0.4,
          max_tokens: 1500,
        }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "OpenRouter error");

      return NextResponse.json({
        content: data.choices?.[0]?.message?.content || "No analysis generated",
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return NextResponse.json({ error: "Analysis timed out. Try shorter text." }, { status: 504 });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    console.error("[check]", err);
    return NextResponse.json(
      { error: String(err.message || "Server error").slice(0, 300) },
      { status: 500 }
    );
  }
}
