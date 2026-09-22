import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

interface PostedContextItem {
  content?: string;
  created_at?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { persona, type, topic, model, postedContext } = await req.json();

    if (!persona || !type) {
      return NextResponse.json({ error: "Missing persona or type" }, { status: 400 });
    }

    // Posted-aware generation: tell the model what the user already published
    // so it produces fresh angles instead of repeating them.
    let postedBlock = "";
    if (Array.isArray(postedContext) && postedContext.length > 0) {
      const list = (postedContext as PostedContextItem[])
        .slice(0, 12)
        .map((p, i) => {
          const excerpt = String(p.content || "").replace(/\s+/g, " ").slice(0, 220);
          return `${i + 1}. ${excerpt}`;
        })
        .join("\n");
      postedBlock = `

RECENTLY POSTED BY THIS USER (their real published content, newest first):
${list}

AVOIDING REPEATS:
- Do NOT reuse the topics, hooks, claims, or angles listed above.
- If the requested topic is close to a posted item, take a noticeably different angle (new insight, opposite take, next step, deeper layer).
- The output must feel like the next post, not a rerun.`;
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
- If the requested topic conflicts with the persona, reframe it or refuse politely in character.` + postedBlock;

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

    // Preview fallback: use the built-in LLM SDK when no external keys are set.
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
      content: `[Simulated ${type} — ${persona.name}]\n\n${userPrompt}\n\n---\nAI generation is currently unavailable. Add OPENROUTER_API_KEY to .env.local for real generation.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
