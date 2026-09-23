import { NextRequest, NextResponse } from "next/server";
import {
  sanitizePersona,
  sanitizeStringList,
  buildSystemPrompt,
  buildUserPrompt,
  safeModel,
} from "@/lib/persona-prompt";

const ALLOWED_TYPES = new Set(["caption", "script", "story_arc", "image_prompt", "rewrite"]);

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { persona: rawPersona, type, topic, model, avoidContent, workedContent, floppedContent } =
      body;

    if (!rawPersona || !type) {
      return NextResponse.json({ error: "Missing persona or type" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
    }

    let persona;
    try {
      persona = sanitizePersona(rawPersona);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Invalid persona" }, { status: 400 });
    }

    const systemPrompt = buildSystemPrompt(persona, {
      avoidContent: sanitizeStringList(avoidContent, 15, 250),
      workedContent: sanitizeStringList(workedContent, 8, 300),
      floppedContent: sanitizeStringList(floppedContent, 6, 200),
    });
    const userPrompt = buildUserPrompt(type, topic);
    const selectedModel = safeModel(model);

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (openrouterKey) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);

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
            model: selectedModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.75,
            max_tokens: 2048,
          }),
          signal: controller.signal,
        });

        const data = await res.json();

        if (!res.ok) {
          console.error("OpenRouter error:", data);
          const msg = data.error?.message || data.message || "OpenRouter error";
          // Don't leak key fragments
          throw new Error(String(msg).replace(/sk-[a-zA-Z0-9-]+/g, "[redacted]"));
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") {
          return NextResponse.json({ error: "Empty model response" }, { status: 502 });
        }
        return NextResponse.json({ content });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return NextResponse.json({ error: "Generation timed out. Try again." }, { status: 504 });
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
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
          max_tokens: 2048,
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
    console.error("[generate]", err);
    const message = err?.message || "Server error";
    return NextResponse.json(
      { error: String(message).slice(0, 300) },
      { status: 500 }
    );
  }
}
