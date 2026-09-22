import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { persona, type, topic, model } = await req.json();

    if (!persona || !type) {
      return NextResponse.json({ error: "Missing persona or type" }, { status: 400 });
    }

    const systemPrompt = `You are a content writer that MUST stay 100% in character for the following persona.

PERSONA NAME: ${persona.name}
BACKSTORY: ${persona.backstory}
TONE OF VOICE: ${persona.tone_of_voice || "natural and authentic"}
LIFESTYLE PILLARS: ${(persona.lifestyle_pillars || []).join(", ") || "none specified"}
CONTENT RULES: ${(persona.content_rules || []).join("; ") || "none"}
FORBIDDEN TOPICS: ${(persona.forbidden_topics || []).join(", ") || "none"}

STRICT RULES:
- Never break character.
- Never mention that you are an AI or that this is generated.
- Match the tone of voice exactly.
- Stay consistent with the backstory and lifestyle pillars.
- Follow every content rule.
- Completely avoid any forbidden topics.
- If the requested topic conflicts with the persona, reframe it or refuse politely in character.`;

    let userPrompt = "";
    switch (type) {
      case "caption":
        userPrompt = `Write a short, high-performing social media caption${topic ? ` about: ${topic}` : ""}. Keep it punchy and under 280 characters if possible. Make it feel completely native to this persona.`;
        break;
      case "script":
        userPrompt = `Write a short video script (30-60 seconds spoken)${topic ? ` about: ${topic}` : ""}. Include a strong hook in the first 3 seconds and natural spoken language.`;
        break;
      case "story_arc":
        userPrompt = `Create a short content series outline (3-5 posts)${topic ? ` around: ${topic}` : ""}. Each post should feel like a natural progression for this persona.`;
        break;
      case "image_prompt":
        userPrompt = `Write a detailed image generation prompt that would produce a photo matching this persona's world${topic ? ` related to: ${topic}` : ""}. Be specific about lighting, setting, clothing, expression, and mood.`;
        break;
      default:
        userPrompt = `Generate content of type "${type}"${topic ? ` about ${topic}` : ""}.`;
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    const selectedModel = model || "openai/gpt-4o-mini";

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
          model: selectedModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.75,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("OpenRouter error:", data);
        throw new Error(data.error?.message || data.message || "OpenRouter error");
      }

      const content = data.choices?.[0]?.message?.content || "No content generated";
      return NextResponse.json({ content });
    }

    if (openaiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.75,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "OpenAI error");

      return NextResponse.json({
        content: data.choices[0]?.message?.content || "No content generated",
      });
    }

    if (anthropicKey) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
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
      if (!res.ok) throw new Error(data.error?.message || "Anthropic error");

      return NextResponse.json({
        content: data.content[0]?.text || "No content generated",
      });
    }

    return NextResponse.json({
      content: `[Simulated ${type} — ${persona.name}]\n\n${userPrompt}\n\n---\nAdd OPENROUTER_API_KEY to .env.local and restart the server for real generation.`,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 });
  }
}
