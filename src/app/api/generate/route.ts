import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { persona, type, topic } = await req.json();

    if (!persona || !type) {
      return NextResponse.json({ error: "Missing persona or type" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

    // Build a strong system prompt that enforces persona consistency
    const systemPrompt = `You are a content writer that MUST stay 100% in character for the following persona.

PERSONA NAME: ${persona.name}
BACKSTORY: ${persona.backstory}
TONE OF VOICE: ${persona.tone_of_voice || "natural and authentic"}
LIFESTYLE PILLARS: ${(persona.lifestyle_pillars || []).join(", ") || "none specified"}
CONTENT RULES: ${(persona.content_rules || []).join("; ") || "none"}
FORBIDDEN TOPICS: ${(persona.forbidden_topics || []).join(", ") || "none"}

Rules:
- Never break character.
- Never mention that you are an AI.
- Match the tone exactly.
- Stay consistent with the backstory and lifestyle pillars.
- If something conflicts with the persona, refuse or reframe it.`;

    let userPrompt = "";
    switch (type) {
      case "caption":
        userPrompt = `Write a short, high-performing social media caption${topic ? ` about: ${topic}` : ""}. Keep it under 280 characters if possible. Make it feel native to the persona.`;
        break;
      case "script":
        userPrompt = `Write a short video script (30-60 seconds)${topic ? ` about: ${topic}` : ""}. Include natural spoken language and a clear hook.`;
        break;
      case "story_arc":
        userPrompt = `Create a short story arc or content series outline (3-5 posts)${topic ? ` around: ${topic}` : ""}. Each point should feel like a natural progression for this persona.`;
        break;
      case "image_prompt":
        userPrompt = `Write a detailed image generation prompt that would produce a photo matching this persona's visual world${topic ? ` related to: ${topic}` : ""}. Be specific about lighting, setting, clothing, mood.`;
        break;
      default:
        userPrompt = `Generate content of type ${type}${topic ? ` about ${topic}` : ""}.`;
    }

    // If no API key, return a simulated response so the UI still works
    if (!apiKey) {
      const simulated = `[Simulated ${type} for ${persona.name}]

${userPrompt}

---
This is a placeholder. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.local to enable real AI generation.

Persona tone: ${persona.tone_of_voice || "default"}
Pillars: ${(persona.lifestyle_pillars || []).join(", ")}`;

      return NextResponse.json({ content: simulated });
    }

    // Prefer OpenAI if key is present
    if (process.env.OPENAI_API_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "OpenAI error");
      }

      const content = data.choices[0]?.message?.content || "No content generated";
      return NextResponse.json({ content });
    }

    // Fallback: Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Anthropic error");
      }

      const content = data.content[0]?.text || "No content generated";
      return NextResponse.json({ content });
    }

    return NextResponse.json({ error: "No AI API key configured" }, { status: 500 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 });
  }
}
