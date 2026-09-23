import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { persona, text, mode } = await req.json();

    if (!persona || !text) {
      return NextResponse.json({ error: "Missing persona or text" }, { status: 400 });
    }

    const examples =
      persona.example_posts && persona.example_posts.length > 0
        ? `\nGold examples:\n${persona.example_posts.slice(0, 5).join("\n---\n")}`
        : "";

    // Quick score mode for ambient scoring after generate
    if (mode === "score") {
      const systemPrompt = `You score how well text matches a persona. Reply with ONLY a JSON object:
{"score": number 0-100, "verdict": "Safe to post" | "Needs changes" | "Major rewrite", "note": "one short sentence"}

PERSONA: ${persona.name}
Tone: ${persona.tone_of_voice || "n/a"}
Rules: ${(persona.content_rules || []).join("; ") || "none"}
Forbidden: ${(persona.forbidden_topics || []).join(", ") || "none"}
${examples}`;

      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterKey) {
        return NextResponse.json({ score: null, verdict: null, note: "Add OPENROUTER_API_KEY for scoring" });
      }

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
            { role: "user", content: text },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "OpenRouter error");

      let parsed = { score: 0, verdict: "Needs changes", note: "" };
      try {
        parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
      } catch {
        /* ignore */
      }
      return NextResponse.json(parsed);
    }

    const systemPrompt = `You are an expert brand consistency analyst.

Analyze the provided text against this persona and give a clear, structured report.

PERSONA:
Name: ${persona.name}
Backstory: ${persona.backstory}
Tone of Voice: ${persona.tone_of_voice || "not specified"}
Lifestyle Pillars: ${(persona.lifestyle_pillars || []).join(", ") || "none"}
Content Rules: ${(persona.content_rules || []).join("; ") || "none"}
Forbidden Topics: ${(persona.forbidden_topics || []).join(", ") || "none"}
${examples}

Your response must include:
1. Overall Consistency Score (0-100)
2. What matches the persona well
3. What breaks character or conflicts
4. Specific suggested rewrites for any problematic parts
5. Final verdict (Safe to post / Needs changes / Major rewrite needed)

Be direct and practical.`;

    const openrouterKey = process.env.OPENROUTER_API_KEY;

    if (!openrouterKey) {
      return NextResponse.json({
        content: `Consistency analysis requires OPENROUTER_API_KEY.\n\nText length: ${text.length} characters\nPersona: ${persona.name}`,
      });
    }

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
          { role: "user", content: `Analyze this text:\n\n${text}` },
        ],
        temperature: 0.4,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || "OpenRouter error");
    }

    return NextResponse.json({
      content: data.choices?.[0]?.message?.content || "No analysis generated",
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 });
  }
}
