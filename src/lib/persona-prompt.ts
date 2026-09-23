/** Shared, hardened persona system-prompt builder for generate / check / ideas. */

const MAX_FIELD = 4000;
const MAX_ITEM = 500;
const MAX_LIST = 15;

function clip(s: unknown, max = MAX_FIELD): string {
  if (s == null) return "";
  const t = String(s).trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function list(arr: unknown, maxItems = MAX_LIST, maxEach = MAX_ITEM): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x != null && String(x).trim())
    .slice(0, maxItems)
    .map((x) => clip(x, maxEach));
}

export function sanitizePersona(raw: any) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid persona");
  }
  const name = clip(raw.name, 120);
  if (!name) throw new Error("Persona name is required");

  return {
    name,
    backstory: clip(raw.backstory, MAX_FIELD),
    tone_of_voice: clip(raw.tone_of_voice, 500),
    lifestyle_pillars: list(raw.lifestyle_pillars, 12, 80),
    content_rules: list(raw.content_rules, 12, 200),
    forbidden_topics: list(raw.forbidden_topics, 12, 80),
    example_posts: list(raw.example_posts, 8, 400),
  };
}

export function sanitizeStringList(arr: unknown, maxItems = 15, maxEach = 300): string[] {
  return list(arr, maxItems, maxEach);
}

export function buildSystemPrompt(
  persona: ReturnType<typeof sanitizePersona>,
  opts: {
    avoidContent?: string[];
    workedContent?: string[];
    floppedContent?: string[];
  } = {}
): string {
  const examples =
    persona.example_posts.length > 0
      ? `\n\nGOLD EXAMPLE POSTS (match this style, rhythm, and energy closely):\n${persona.example_posts
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}`
      : "";

  const worked =
    opts.workedContent && opts.workedContent.length > 0
      ? `\n\nPOSTS THAT WORKED WELL (double down on themes/hooks — do not copy verbatim):\n${opts.workedContent
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}`
      : "";

  const flopped =
    opts.floppedContent && opts.floppedContent.length > 0
      ? `\n\nPOSTS THAT FLOPPED (avoid similar topics, tone, or structure):\n${opts.floppedContent
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}`
      : "";

  const avoid =
    opts.avoidContent && opts.avoidContent.length > 0
      ? `\n\nALREADY POSTED (do NOT repeat topics, angles, or phrasing):\n${opts.avoidContent
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}\n\nGenerate something fresh.`
      : "";

  return `You are a content writer that MUST stay 100% in character for the following persona.

PERSONA NAME: ${persona.name}
BACKSTORY: ${persona.backstory || "(not specified)"}
TONE OF VOICE: ${persona.tone_of_voice || "natural and authentic"}
LIFESTYLE PILLARS: ${persona.lifestyle_pillars.join(", ") || "none specified"}
CONTENT RULES: ${persona.content_rules.join("; ") || "none"}
FORBIDDEN TOPICS: ${persona.forbidden_topics.join(", ") || "none"}
${examples}${worked}${flopped}${avoid}

STRICT RULES:
- Never break character.
- Never mention that you are an AI or that this is generated.
- Match the tone of voice exactly.
- If gold example posts are provided, match their sentence length, rhythm, and energy.
- Prefer themes and hooks similar to posts that WORKED; avoid patterns from posts that FLOPPED.
- Stay consistent with the backstory and lifestyle pillars.
- Follow every content rule.
- Completely avoid any forbidden topics.
- If the requested topic conflicts with the persona, reframe it or refuse politely in character.
- Do not repeat ideas, angles, or near-identical phrasing from already-posted content.`;
}

export function buildUserPrompt(type: string, topic?: string): string {
  const t = clip(topic, 8000);
  switch (type) {
    case "caption":
      return `Write a short, high-performing social media caption${t ? ` about: ${t}` : ""}. Keep it punchy and under 280 characters if possible. Make it feel completely native to this persona.`;
    case "script":
      return `Write a short video script (30-60 seconds spoken)${t ? ` about: ${t}` : ""}. Include a strong hook in the first 3 seconds and natural spoken language.`;
    case "story_arc":
      return `Create a short content series outline (3-5 posts)${t ? ` around: ${t}` : ""}. Each post should feel like a natural progression for this persona.`;
    case "image_prompt":
      return `Write a detailed image generation prompt that would produce a photo matching this persona's world${t ? ` related to: ${t}` : ""}. Be specific about lighting, setting, clothing, expression, and mood.`;
    case "rewrite":
      return `Rewrite the following text so it sounds exactly like this persona — same tone, rhythm, rules, and energy. Keep the core meaning.\n\n${t || ""}`;
    default:
      return `Generate content of type "${clip(type, 40)}"${t ? ` about ${t}` : ""}.`;
  }
}

export const ALLOWED_MODELS = new Set([
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-haiku",
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.1-8b-instruct",
  "openai/gpt-4o",
  "anthropic/claude-3.5-sonnet",
]);

export function safeModel(model?: string): string {
  if (model && ALLOWED_MODELS.has(model)) return model;
  return "openai/gpt-4o-mini";
}
