import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { persona } = await req.json();

    if (!persona) {
      return NextResponse.json({ error: "Missing persona" }, { status: 400 });
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY required" },
        { status: 500 }
      );
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

Make the persona more specific and higher-signal. Remove vagueness.`;

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
          {
            role: "user",
            content: `Current persona:\n${JSON.stringify(persona, null, 2)}`,
          },
        ],
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "OpenRouter error");

    const content = data.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = persona;
    }

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 });
  }
}
