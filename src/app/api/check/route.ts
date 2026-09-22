import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export async function POST(req: NextRequest) {
  try {
    const { persona, text } = await req.json();

    if (!persona || !text) {
      return NextResponse.json({ error: "Missing persona or text" }, { status: 400 });
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

Your response must include:
1. Overall Consistency Score (0-100)
2. What matches the persona well
3. What breaks character or conflicts
4. Specific suggested rewrites for any problematic parts
5. Final verdict (Safe to post / Needs changes / Major rewrite needed)

Be direct and practical.`;

    const userPrompt = `Analyze this text:\n\n${text}`;

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
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "OpenRouter error");
      }

      return NextResponse.json({
        content: data.choices?.[0]?.message?.content || "No analysis generated",
      });
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
        return NextResponse.json({ content });
      }
    } catch (sdkErr) {
      console.error("Built-in LLM fallback failed:", sdkErr);
    }

    return NextResponse.json({
      content: `Consistency analysis is currently unavailable.\n\nText length: ${text.length} characters\nPersona: ${persona.name}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
