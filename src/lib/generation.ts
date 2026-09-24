/**
 * Persona OS — Engine v2 core.
 *
 * Responsibilities:
 *  1. Provider chain (OpenRouter → OpenAI → Anthropic → built-in SDK) with
 *     per-attempt timeouts and one silent retry — a failed call never
 *     becomes a failed user experience while any provider is reachable.
 *  2. Prompt architecture: persona + measured Voice DNA + platform rules +
 *     posted-awareness + per-variant STRUCTURAL directives, so multiple
 *     variants differ in architecture (story vs contrarian vs framework),
 *     not just wording.
 *  3. Post-processing pipeline: strip meta → scrub clichés → quality gate →
 *     voice match → rank. Output is `VariantResult[]`, ready for UI.
 *  4. Viral playbook (src/lib/viralPlaybook.ts) injects research-backed
 *     hook families and craft rules for captions, scripts, and image prompts.
 */

import ZAI from "z-ai-web-dev-sdk";
import type { PlatformId } from "./platforms";
import { PLATFORMS } from "./platforms";
import { HOOK_FAMILIES, CAPTION_CRAFT, SCRIPT_CRAFT, IMAGE_PROMPT_CRAFT } from "./viralPlaybook";
import {
  extractVoiceFingerprint,
  renderFingerprintBlock,
  voiceMatchScore,
  voiceMatchNote,
  type VoiceFingerprint,
} from "./voice";
import { qualityGate, stripMetaWrapping, type QualityReport } from "./quality";

export type GenType = "caption" | "script" | "story_arc" | "image_prompt";

export interface PersonaInput {
  name: string;
  backstory: string;
  visual_style?: string | null;
  tone_of_voice?: string | null;
  lifestyle_pillars?: string[] | null;
  content_rules?: string[] | null;
  forbidden_topics?: string[] | null;
}

export interface GenerateRequest {
  persona: PersonaInput;
  type: GenType;
  topic?: string;
  platform: PlatformId;
  variants: number;
  model?: string;
  voiceSamples?: string[];
  goldSamples?: string[];
  postedContext?: { content?: string; created_at?: string }[];
  assetContext?: { type?: string; tags?: string[]; content?: string; description?: string };
  rewrite?: { original: string; instruction: string };
  moreLike?: { original: string; avoid?: string[] };
  polish?: boolean;
}

export interface VariantResult {
  content: string;
  original?: string;
  rank: number;
  voiceMatch: number;
  voiceNote: string;
  hookType: string;
  wordCount: number;
  why: string;
  flags: string[];
  repetition: { score: number; against: string | null };
  fit: { fits: boolean; overBy: number; length: number; limit: number };
  blocked: boolean;
  blockReason: string | null;
  polished?: boolean;
}

export interface GenerateResponse {
  engine: "v2";
  variants: VariantResult[];
  fingerprint: { used: boolean; samples: number; summary: string } | null;
  provider: string;
  degraded: boolean;
  content?: string;
}

const TIMEOUT_MS = 45_000;

export const OPENROUTER_DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

export const OPENROUTER_ALLOWED_MODELS = new Set([
  "meta-llama/llama-3.3-70b-instruct",
  "deepseek/deepseek-chat-v3-0324",
  "mistralai/mistral-small-24b-instruct-2501",
  "meta-llama/llama-3.1-8b-instruct",
]);

export interface LlmResult {
  content: string;
  provider: string;
  degraded: boolean;
}

export type ChatMessage = { role: "system" | "user"; content: string };

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(key: string, model: string, messages: ChatMessage[], temp: number, json: boolean, timeoutMs = TIMEOUT_MS) {
  const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://persona-os.app",
      "X-Title": "Persona OS",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: temp,
      max_tokens: 1600,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  }, timeoutMs);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || data.message || "OpenRouter error");
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error("Empty completion");
  return content as string;
}

async function callOpenAI(key: string, messages: ChatMessage[], temp: number, json: boolean, timeoutMs = TIMEOUT_MS) {
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: temp,
      max_tokens: 1600,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  }, timeoutMs);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "OpenAI error");
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error("Empty completion");
  return content as string;
}

async function callAnthropic(key: string, messages: ChatMessage[], temp: number, timeoutMs = TIMEOUT_MS) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1600,
      system,
      temperature: temp,
      messages: messages.filter((m) => m.role === "user"),
    }),
  }, timeoutMs);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Anthropic error");
  const content = data.content?.[0]?.text;
  if (!content?.trim()) throw new Error("Empty completion");
  return content as string;
}

let zaiPromise: Promise<ZAI> | null = null;
async function callBuiltIn(messages: ChatMessage[], temp: number, timeoutMs = TIMEOUT_MS) {
  if (!zaiPromise) zaiPromise = ZAI.create();
  const zai = await zaiPromise;
  const timer = setTimeout(() => {}, timeoutMs);
  try {
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages,
        temperature: temp,
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("Generation timed out")), timeoutMs)
      ),
    ]);
    const content = (completion as { choices?: { message?: { content?: string } }[] })
      ?.choices?.[0]?.message?.content;
    if (!content?.trim()) throw new Error("Empty completion");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export async function llmComplete(
  messages: ChatMessage[],
  temp: number,
  opts?: { model?: string; json?: boolean; timeoutMs?: number }
): Promise<LlmResult> {
  const providers: { name: string; run: () => Promise<string> }[] = [];
  const orKey = process.env.OPENROUTER_API_KEY;
  const oaKey = process.env.OPENAI_API_KEY;
  const anKey = process.env.ANTHROPIC_API_KEY;
  const t = opts?.timeoutMs ?? TIMEOUT_MS;
  if (orKey)
    providers.push({
      name: `openrouter:${opts?.model || OPENROUTER_DEFAULT_MODEL.replace(/.*\//, "")}`,
      run: () => callOpenRouter(orKey, opts?.model || OPENROUTER_DEFAULT_MODEL, messages, temp, !!opts?.json, t),
    });
  if (orKey && opts?.model && opts.model !== OPENROUTER_DEFAULT_MODEL)
    providers.push({
      name: `openrouter:default(${OPENROUTER_DEFAULT_MODEL.replace(/.*\//, "")})`,
      run: () => callOpenRouter(orKey, OPENROUTER_DEFAULT_MODEL, messages, temp, !!opts?.json, t),
    });
  if (oaKey)
    providers.push({ name: "openai:gpt-4o-mini", run: () => callOpenAI(oaKey, messages, temp, !!opts?.json, t) });
  if (anKey)
    providers.push({ name: "anthropic:haiku", run: () => callAnthropic(anKey, messages, temp, t) });
  providers.push({ name: "built-in", run: () => callBuiltIn(messages, temp, t) });

  const errors: string[] = [];
  let degraded = false;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    if (i > 0) degraded = true;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const content = await p.run();
        return { content, provider: p.name, degraded };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${p.name} #${attempt}: ${msg}`);
        if (msg.includes("timed out") || msg.includes("aborted")) break;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw new Error(`All providers failed — ${errors.slice(-2).join(" | ")}`);
}

interface VariantStrategy {
  id: string;
  label: string;
  temperature: number;
  directive: string;
}

const CAPTION_STRATEGIES: VariantStrategy[] = [
  {
    id: "specific-number",
    label: "Specific claim",
    temperature: 0.75,
    directive:
      "STRUCTURE: open with a specific number/result/timeline claim (not vague hype). One tight body beat that proves it. Close with a single question or one-word reply CTA. First line must survive the platform fold alone.",
  },
  {
    id: "contrarian",
    label: "Bold take",
    temperature: 0.78,
    directive:
      "STRUCTURE: lead with a contrarian or 'everyone's wrong' claim the persona can defend. Short body that shows the alternative. No hedging. First line = the whole argument in miniature.",
  },
  {
    id: "story",
    label: "Story hook",
    temperature: 0.88,
    directive:
      "STRUCTURE: confession or before/after micro-story (2–3 lines max), then one insight. Concrete details (time, place, object) beat adjectives. End on the lesson, not a summary.",
  },
  {
    id: "list-framework",
    label: "List/framework",
    temperature: 0.62,
    directive:
      "STRUCTURE: listicle preamble in line 1 ('3 signs…' / 'Only 2 rules…'), then 3 items max one line each, one-line closer. Scannable in 3 seconds. Completion bias is the point.",
  },
  {
    id: "curiosity",
    label: "Curiosity gap",
    temperature: 0.85,
    directive:
      "STRUCTURE: open a curiosity gap in line 1, pay it off in 2–3 short lines, stop early. Leave whitespace. One soft CTA. Never clickbait without delivery.",
  },
  {
    id: "mistake-warning",
    label: "Mistake warning",
    temperature: 0.72,
    directive:
      "STRUCTURE: 'Stop doing X' or cost-of-mistake opener, then the better move in plain language. Loss aversion, not shame. One practical CTA.",
  },
];

const SCRIPT_STRATEGIES: VariantStrategy[] = [
  {
    id: "pattern-interrupt",
    label: "Pattern interrupt",
    temperature: 0.85,
    directive:
      "STRUCTURE: 0–3s pattern-interrupt hook (spoken ≤14 words + [on-screen text]). Then tension → 3 value beats with [visual] cues → reward the promise → one CTA. Micro-loop mid-script ('but the third…'). Mute-friendly.",
  },
  {
    id: "direct-value",
    label: "Direct value",
    temperature: 0.65,
    directive:
      "STRUCTURE: promise the outcome in line 1, deliver 3 tight how-to beats with [visual] cues, end on takeaway + one CTA. Spoken contractions. No channel intro.",
  },
  {
    id: "open-loop",
    label: "Open loop",
    temperature: 0.8,
    directive:
      "STRUCTURE: open a loop in the first 3 seconds, plant micro-payoffs every 5–10s, resolve the loop in the final 5 seconds BEFORE the CTA. Inline [visual] every beat.",
  },
  {
    id: "problem-solution",
    label: "Problem → fix",
    temperature: 0.7,
    directive:
      "STRUCTURE: name a specific problem (0–3s), agitate the cost once (3–8s), spend the rest on the fix with [visual] demo cues, one CTA. One problem only.",
  },
];

const SERIES_STRATEGIES: VariantStrategy[] = [
  {
    id: "arc",
    label: "Setup → tension → payoff",
    temperature: 0.7,
    directive:
      "STRUCTURE: real arc — post 1 sets tension with a fold-proof hook, middle posts escalate, final post pays off and loops to post 1. Each post names what it builds on. Each post has its own CTA.",
  },
  {
    id: "segments",
    label: "Standalone cluster",
    temperature: 0.55,
    directive:
      "STRUCTURE: 3–5 standalone posts on one theme; each complete alone; ordered as an escalating series. Every post opens with a different hook family.",
  },
];

const IMAGE_STRATEGIES: VariantStrategy[] = [
  {
    id: "editorial",
    label: "Editorial brand",
    temperature: 0.7,
    directive:
      "STRUCTURE: SCBLM-style prompt — Subject, Composition (shot/lens/negative space), Brand/visual style from persona, Lighting (direction+quality), Mood/palette. End with AVOID: list. One paste-ready paragraph.",
  },
  {
    id: "candid",
    label: "Candid documentary",
    temperature: 0.85,
    directive:
      "STRUCTURE: candid in-the-moment shot — imperfect framing OK. Fleeting action, ambient light, phone-camera realism, emotion on faces. Match persona visual style. AVOID stock smile, text, logos, extra fingers.",
  },
  {
    id: "product-scene",
    label: "Scene / still life",
    temperature: 0.65,
    directive:
      "STRUCTURE: environment-first still — props that belong in their world, soft directional light, shallow depth of field, room for text overlay. Palette locked to visual style. AVOID clutter and watermarks.",
  },
];

export function strategiesFor(type: GenType): VariantStrategy[] {
  switch (type) {
    case "caption":
      return CAPTION_STRATEGIES;
    case "script":
      return SCRIPT_STRATEGIES;
    case "story_arc":
      return SERIES_STRATEGIES;
    case "image_prompt":
      return IMAGE_STRATEGIES;
  }
}

const ANTI_SLOP = `
QUALITY BAR (non-negotiable):
- NEVER wrap the content in meta commentary. No "Here's your...", no "Sure!", no "Option 1:", no "Hope this helps". Output ONLY the finished content itself.
- NEVER use: game-changer, delve, unlock the power, level up, take it to the next level, revolutionize, seamlessly, in the realm of, navigating the landscape, a testament to, paradigm shift, synergy, elevate your, buckle up, let's dive in, hustle hard, crushing it, at the end of the day, journey (as metaphor), elevate, "not gonna lie", "let that sink in", "and that's on period".
- No emoji unless the Voice DNA says the person uses emoji.
- No invented statistics, no fake quotes, no URLs, no "link in bio" unless the persona truly uses that phrase.
- Concrete > abstract: specific moments, numbers, names of things they'd actually say.
- Viral ≠ generic: specificity and persona voice beat template energy every time.`;

function personaBlock(persona: PersonaInput): string {
  return `PERSONA NAME: ${persona.name}
BACKSTORY: ${persona.backstory}
TONE OF VOICE: ${persona.tone_of_voice || "natural and authentic"}
VISUAL STYLE: ${persona.visual_style || "not specified"}
LIFESTYLE PILLARS: ${(persona.lifestyle_pillars || []).join(", ") || "none specified"}
CONTENT RULES: ${(persona.content_rules || []).join("; ") || "none"}
FORBIDDEN TOPICS: ${(persona.forbidden_topics || []).join(", ") || "none"}`;
}

function postedBlock(posted: { content?: string }[] | undefined): string {
  if (!posted?.length) return "";
  const list = posted
    .slice(0, 12)
    .map((p, i) => {
      const excerpt = String(p.content || "").replace(/\s+/g, " ").slice(0, 220);
      return `${i + 1}. ${excerpt}`;
    })
    .join("\n");
  return `

ALREADY POSTED BY THIS PERSON (newest first):
${list}

FRESHNESS RULES:
- Do NOT reuse the topics, hooks, claims, or angles above.
- If the requested topic is close to a posted item, take a clearly different angle: new insight, opposite take, next step, or deeper layer.
- The output must feel like the NEXT post, not a rerun.`;
}

function assetBlock(asset: GenerateRequest["assetContext"]): string {
  if (!asset || (!asset.description && !asset.content && !asset.tags?.length)) return "";
  const bits: string[] = [];
  if (asset.description) bits.push(`what it shows: ${String(asset.description).slice(0, 300)}`);
  if (asset.content) bits.push(`attached note/text: ${String(asset.content).slice(0, 300)}`);
  if (asset.tags?.length) bits.push(`tags: ${asset.tags.join(", ")}`);
  return `

THE POST WILL ACCOMPANY A VAULT ASSET (${asset.type || "image"}):
${bits.join("\n")}
- Write the words so they naturally pair with this asset.
- Do NOT invent visual details that contradict the asset.`;
}

function moreLikeBlock(ml: { original: string; avoid?: string[] }): string {
  const avoid = (ml.avoid || [])
    .filter((s) => typeof s === "string" && s.trim())
    .slice(0, 4)
    .map((s, i) => `${i + 1}. ${s.replace(/\s+/g, " ").slice(0, 160)}`)
    .join("\n");
  return `

MORE LIKE THIS — the user picked the post below as one that WORKS. Write a NEW post with the same underlying idea and energy, but NOT a copy:

WINNER POST:
${ml.original.replace(/\s+/g, " ").slice(0, 600)}

VARIATION RULES:
- Different opening words and a different hook architecture than the winner.
- Same topic territory, NEW angle: next step, opposite take, deeper layer, a specific story, or a surprising consequence.
- It must stand alone — a reader who never saw the winner still gets the full value.
- Do NOT reuse any sentence or phrase from the winner${avoid ? ` or from these variations that already exist:\n${avoid}` : ""}.`;
}

function platformBlock(platform: PlatformId, type: GenType): string {
  const spec = PLATFORMS[platform];
  const rules = type === "image_prompt" ? "" : `\nPLATFORM FORMATTING (${spec.name}):\n` + spec.formatRules.map((r) => `- ${r}`).join("\n");
  return `\n\nTARGET PLATFORM: ${spec.name} (limit ${spec.limit} characters, first ${spec.fold} visible before truncation)
${spec.promptHint}${rules}`;
}

function typeTask(
  type: GenType,
  topic: string,
  persona: PersonaInput,
  strategy: VariantStrategy,
  rewrite?: { original: string; instruction: string }
): string {
  const about = topic ? ` about: ${topic}` : "";

  if (rewrite) {
    return `Rewrite the content below according to this instruction: "${rewrite.instruction}"

ORIGINAL:
${rewrite.original}

Keep it ${type === "caption" ? "in the same format (a caption)" : type === "script" ? "in the same format (a script)" : "in the same format"} and completely in ${persona.name}'s voice. Output only the rewritten content.`;
  }

  switch (type) {
    case "caption":
      return `Write ONE social media caption${about}.

${HOOK_FAMILIES}

${CAPTION_CRAFT}

${strategy.directive}
- Hard limit = platform limit; first-line fold is sacred.
- It must sound like they typed it on their phone in 60 seconds, not a brand desk.
${persona.content_rules?.length ? `- Obey every content rule.` : ""}
Output ONLY the finished caption.`;
    case "script":
      return `Write a short spoken video script (target 30–45 seconds, ~75–110 words)${about}.

${SCRIPT_CRAFT}

${strategy.directive}
- Format labels: HOOK: / BEAT 1: / BEAT 2: / BEAT 3: / PAYOFF: / CTA: with [visual] cues on each beat.
- Spoken language only. No "hey guys", no channel intro.
Output ONLY the script.`;
    case "story_arc":
      return `Create a content series of 3–5 posts${about}.

${HOOK_FAMILIES}

${strategy.directive}
- For EACH post: fold-proof hook line, 2–3 sentence body, one CTA.
- Number them (POST 1:, POST 2:, …) and show how each builds on the previous.
- Vary hook families across the series.
- Output plain structured text — no markdown headers.`;
    case "image_prompt":
      return `Write ONE image-generation prompt for a photo that belongs in ${persona.name}'s world${about}.

${IMAGE_PROMPT_CRAFT}

${strategy.directive}
- Consistency lock: reuse visual-style language; only change scene/action.
${persona.visual_style ? `- Their visual style (must honor): ${persona.visual_style}` : "- Infer a coherent visual style from backstory if none is set."}
Output ONLY the paste-ready prompt paragraph ending with AVOID: …`;
  }
}

export function renderExemplarBlock(samples: string[]): string {
  const gold = samples
    .filter((s) => typeof s === "string" && s.trim().length > 20)
    .slice(0, 5)
    .map((s, i) => `${i + 1}. ${s.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  if (!gold) return "";
  return `

GOLD EXAMPLE POSTS (match this style, rhythm, and energy closely — do not copy verbatim):
${gold}`;
}

export function fingerprintFrom(samples: string[]): VoiceFingerprint {
  return extractVoiceFingerprint(samples.filter((s) => s && s.length > 20));
}

export function buildSystemPrompt(
  persona: PersonaInput,
  fingerprint: VoiceFingerprint,
  voiceSamples: string[]
): string {
  return `You are a content writer that MUST stay 100% in character for the following persona.

${personaBlock(persona)}
${renderFingerprintBlock(fingerprint)}
${renderExemplarBlock(voiceSamples)}
${ANTI_SLOP}

STRICT RULES:
- Never break character.
- Never mention that you are an AI or that this is generated.
- Match the tone of voice exactly.
- Prefer themes and hooks similar to posts that WORKED when provided; avoid FLOPPED patterns.
- Follow every content rule.
- Completely avoid forbidden topics.`;
}

export async function runVariant(args: {
  persona: PersonaInput;
  type: GenType;
  topic?: string;
  platform: PlatformId;
  includePlatformBlock: boolean;
  strategy: VariantStrategy;
  fingerprint: VoiceFingerprint;
  systemBase: string;
  posted?: { content?: string }[];
  asset?: GenerateRequest["assetContext"];
  rewrite?: { original: string; instruction: string };
  moreLike?: { original: string; avoid?: string[] };
  polish?: boolean;
  model?: string;
}): Promise<VariantResult> {
  const {
    persona,
    type,
    topic,
    platform,
    includePlatformBlock,
    strategy,
    fingerprint,
    systemBase,
    posted,
    asset,
    rewrite,
    moreLike,
    polish,
    model,
  } = args;

  let user =
    typeTask(type, topic || "", persona, strategy, rewrite) +
    (includePlatformBlock && type !== "image_prompt" ? platformBlock(platform, type) : "") +
    postedBlock(posted) +
    assetBlock(asset) +
    (moreLike ? moreLikeBlock(moreLike) : "");

  const llm = await llmComplete(
    [
      { role: "system", content: systemBase },
      { role: "user", content: user },
    ],
    strategy.temperature,
    { model }
  );

  let content = stripMetaWrapping(llm.content);
  const gate = qualityGate(content, {
    platform,
    type,
    persona,
    fingerprint,
  });
  content = gate.cleaned;

  if (polish && !gate.blocked) {
    try {
      const polished = await llmComplete(
        [
          {
            role: "system",
            content: systemBase + "\nYou are polishing a draft. Keep meaning and voice. Tighten only.",
          },
          {
            role: "user",
            content: `Polish this ${type} for ${PLATFORMS[platform].name}. Keep persona voice. Output only the polished text.\n\n${content}`,
          },
        ],
        0.4,
        { model }
      );
      const p2 = stripMetaWrapping(polished.content);
      if (p2.trim().length > 20) content = p2;
    } catch {
      /* keep original */
    }
  }

  const voiceMatch = voiceMatchScore(content, fingerprint);
  const fitLimit = PLATFORMS[platform].limit;
  const length = [...content].length;
  const fits = type === "image_prompt" || length <= fitLimit;

  return {
    content,
    original: gate.changed ? gate.original : undefined,
    rank: 0,
    voiceMatch,
    voiceNote: voiceMatchNote(voiceMatch, fingerprint),
    hookType: strategy.label,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    why: strategy.directive.slice(0, 120),
    flags: gate.flags,
    repetition: { score: 0, against: null },
    fit: { fits, overBy: fits ? 0 : length - fitLimit, length, limit: fitLimit },
    blocked: gate.blocked,
    blockReason: gate.blockReason,
    polished: !!polish,
  };
}

export function rankVariants(variants: VariantResult[]): VariantResult[] {
  const scored = variants.map((v) => {
    let score = v.voiceMatch;
    if (v.blocked) score -= 50;
    if (!v.fit.fits) score -= 15;
    if (v.flags.length) score -= v.flags.length * 2;
    return { v, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s, i) => ({ ...s.v, rank: i + 1 }));
}
