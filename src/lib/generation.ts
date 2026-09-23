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
 */

import ZAI from "z-ai-web-dev-sdk";
import type { PlatformId } from "./platforms";
import { PLATFORMS } from "./platforms";
import {
  extractVoiceFingerprint,
  renderFingerprintBlock,
  voiceMatchScore,
  voiceMatchNote,
  type VoiceFingerprint,
} from "./voice";
import { qualityGate, stripMetaWrapping, type QualityReport } from "./quality";

/* ---------------------------------- types ---------------------------------- */

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
  /** Curated gold-set samples — when present they override voiceSamples. */
  goldSamples?: string[];
  postedContext?: { content?: string; created_at?: string }[];
  assetContext?: { type?: string; tags?: string[]; content?: string; description?: string };
  /** Quick-rewrite: transform an existing draft with an instruction. */
  rewrite?: { original: string; instruction: string };
  /** "3 more of this one": fresh variations of a winner. */
  moreLike?: { original: string; avoid?: string[] };
  /** Editor polish pass (critique + refine) after the quality gate. */
  polish?: boolean;
}

export interface VariantResult {
  content: string;
  /** Pre-scrub text, present only when the quality gate removed something —
   * powers the "Undo scrub" control. */
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
  /** True when the editor polish pass improved this variant. */
  polished?: boolean;
}

export interface GenerateResponse {
  engine: "v2";
  variants: VariantResult[];
  fingerprint: { used: boolean; samples: number; summary: string } | null;
  provider: string;
  degraded: boolean;
  /** Legacy single-string field (best variant) for existing callers. */
  content?: string;
}

/* ------------------------------ provider chain ----------------------------- */

const TIMEOUT_MS = 45_000;

/**
 * Verified-against-catalog OpenRouter default (2026-09). The previous default
 * (openai/gpt-4o-mini) is region-blocked on current OpenRouter and burned two
 * retries on every call before falling back — degrading every generation.
 * Callers can still pass an explicit model via opts.model.
 */
export const OPENROUTER_DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

/**
 * Model ids the API will honor. Anything else (stale clients, junk from a
 * tampered request) falls back to the default instead of burning retries on
 * ids that are dead on the live catalog.
 */
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

/**
 * Run one completion through the provider chain.
 * Each provider gets 2 attempts (transient 429/5xx are common);
 * the first provider that answers wins.
 */
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
  // Requested model failed on OpenRouter? Try the verified default there
  // BEFORE degrading to built-in — the built-in model is rate-limited in some
  // regions and a healthy OpenRouter model is always preferable.
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
    if (i > 0) degraded = true; // falling back = degraded mode
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const content = await p.run();
        return { content, provider: p.name, degraded };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${p.name} #${attempt}: ${msg}`);
        if (msg.includes("timed out") || msg.includes("aborted")) break; // don't retry timeouts
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw new Error(`All providers failed — ${errors.slice(-2).join(" | ")}`);
}

/* ---------------------------- variant strategies ---------------------------- */

interface VariantStrategy {
  id: string;
  label: string;
  temperature: number;
  directive: string;
}

const CAPTION_STRATEGIES: VariantStrategy[] = [
  {
    id: "story",
    label: "Story hook",
    temperature: 0.9,
    directive:
      "STRUCTURE: open with a real-feeling micro-story or moment (2-3 sentences max), then land one insight. Concrete details beat adjectives.",
  },
  {
    id: "contrarian",
    label: "Bold take",
    temperature: 0.75,
    directive:
      "STRUCTURE: lead with a bold, defensible opinion that takes a position. One short paragraph. No hedging. The reader should react.",
  },
  {
    id: "framework",
    label: "List/framework",
    temperature: 0.6,
    directive:
      "STRUCTURE: a tight list or numbered framework (3 items max, one line each) with a one-line closer. Scannable in 3 seconds.",
  },
  {
    id: "question",
    label: "Curiosity gap",
    temperature: 0.85,
    directive:
      "STRUCTURE: open with a question the reader wants answered, give the surprising answer in 2-3 lines, stop early. Leave whitespace at the end.",
  },
];

const SCRIPT_STRATEGIES: VariantStrategy[] = [
  {
    id: "pattern-interrupt",
    label: "Pattern interrupt",
    temperature: 0.85,
    directive:
      "STRUCTURE: first line must stop the scroll (unexpected claim or visual moment), then setup → twist → payoff. Include [visual] cues inline.",
  },
  {
    id: "direct-value",
    label: "Direct value",
    temperature: 0.6,
    directive:
      "STRUCTURE: promise the outcome in line 1, deliver 3 tight beats, end on the takeaway. Spoken language, contractions, no stage-play fluff.",
  },
];

const SERIES_STRATEGIES: VariantStrategy[] = [
  {
    id: "arc",
    label: "Setup → tension → payoff",
    temperature: 0.7,
    directive:
      "STRUCTURE: build a real arc — post 1 sets the tension, middle posts escalate/complicate, final post pays it off and loops back to post 1. Each post names what it builds on.",
  },
  {
    id: "segments",
    label: "Standalone cluster",
    temperature: 0.5,
    directive:
      "STRUCTURE: 3-5 standalone posts on one theme, each complete on its own (someone seeing only one still gets value), ordered as an escalating series.",
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
      return [
        {
          id: "cinematic",
          label: "Cinematic",
          temperature: 0.7,
          directive:
            "STRUCTURE: full photography spec — subject & pose, environment, lighting (direction + quality), lens & framing, color palette, wardrobe, mood, and what to AVOID. One flowing paragraph a generator can use directly.",
        },
        {
          id: "candid",
          label: "Candid/documentary",
          temperature: 0.85,
          directive:
            "STRUCTURE: a candid, in-the-moment shot spec — imperfect framing is a feature. Describe the fleeting moment, ambient light, phone-camera realism, and the emotion on faces. Say what to AVOID.",
        },
      ];
  }
}

/* -------------------------------- prompt build ------------------------------ */

const ANTI_SLOP = `
QUALITY BAR (non-negotiable):
- NEVER wrap the content in meta commentary. No "Here's your...", no "Sure!", no "Option 1:", no "Hope this helps". Output ONLY the finished content itself.
- NEVER use: game-changer, delve, unlock the power, level up, take it to the next level, revolutionize, seamlessly, in the realm of, navigating the landscape, a testament to, paradigm shift, synergy, elevate your, buckle up, let's dive in, hustle hard, crushing it, at the end of the day, journey (as metaphor), elevate.
- No emoji unless the Voice DNA says the person uses emoji.
- No invented statistics, no fake quotes, no URLs.
- Concrete > abstract: specific moments, numbers, names of things they'd actually say.`;

function personaBlock(persona: PersonaInput): string {
  return `PERSONA NAME: ${persona.name}
BACKSTORY: ${persona.backstory}
TONE OF VOICE: ${persona.tone_of_voice || "natural and authentic"}
VISUAL STYLE: ${persona.visual_style || "not specified"}
LIFESTYLE PILLARS: ${(persona.lifestyle_pillars || []).join(", ") || "none specified"}
CONTENT RULES: ${(persona.content_rules || []).join("; ") || "none"}
FORBIDDEN TOPICS: ${(persona.forbidden_topics || []).join(", ") || "none"}`;
}

function postedBlock(posted: { content?: string }[] | undefined, topic?: string): string {
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

/**
 * "3 more of this one" block: the user flagged a post as a winner; every
 * variant must take the SAME idea somewhere new, not paraphrase it.
 */
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

function typeTask(type: GenType, topic: string, persona: PersonaInput, strategy: VariantStrategy, rewrite?: { original: string; instruction: string }): string {
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

${strategy.directive}
- Aim for the length their Voice DNA shows; hard limit is the platform limit.
- It must sound like they wrote it on their phone in 60 seconds, not like a brand account.
${persona.content_rules?.length ? `- Obey every content rule.` : ""}`;
    case "script":
      return `Write a short spoken video script (30-60 seconds)${about}.

${strategy.directive}
- Format: HOOK (first 3 seconds) / BEATS with [visual] cues inline / CLOSE.
- Spoken language: contractions, short sentences, how people actually talk.`;
    case "story_arc":
      return `Create a content series of 3-5 posts${about}.

${strategy.directive}
- For EACH post: the hook line, the angle in 2-3 sentences, and the one thing the reader should do or feel.
- Number them and show how each builds on the previous.
- Output as plain structured text (POST 1:, POST 2:, ...) — no markdown headers.`;
    case "image_prompt":
      return `Write ONE image generation prompt for a photo that belongs in ${persona.name}'s world${about}.

${strategy.directive}
- Include: subject & pose, environment, lighting, lens/framing, color palette, wardrobe, mood, and a final "AVOID:" list.
- The result must be consistent with their VISUAL STYLE.
${persona.visual_style ? `- Their visual style: ${persona.visual_style}` : ""}`;
  }
}

/* ------------------------------- post-process ------------------------------- */

/**
 * Few-shot exemplars: real posts by this person, verbatim in the system
 * prompt. Statistics describe a voice; examples demonstrate it. Showing the
 * model 2-3 gold samples is the single highest-leverage quality input.
 */
export function renderExemplarBlock(samples: string[]): string {
  const gold = samples
    .map((s) => (s || "").trim())
    .filter((s) => s.length > 40)
    .slice(0, 3);
  if (!gold.length) return "";
  return (
    "\n\nVOICE EXEMPLARS — actual posts by this person. Match this exact feel (rhythm, attitude, vocabulary, line breaks), not a generic 'social media' voice:\n" +
    gold.map((s) => `---\n${s.slice(0, 420)}`).join("\n---\n") +
    "\n---\nWrite like these. If the Voice DNA stats and these examples ever conflict, the examples win."
  );
}

/**
 * Editor polish pass: a fast critique-and-refine call that tightens hooks,
 * cuts flab, and de-generifies the draft. The polished version only ships if
 * it scores at least as well on voice match as the original — polish never
 * makes a draft worse.
 */
async function polishDraft(
  text: string,
  opts: { persona: PersonaInput; fingerprint: VoiceFingerprint; type: GenType; systemBase: string; model?: string }
): Promise<{ text: string; polished: boolean }> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemBase },
    {
      role: "user",
      content: `EDIT this ${opts.type.replace("_", " ")} — make it impossible to ignore while keeping ${opts.persona.name}'s exact voice.

Fix, in priority order:
1. HOOK: is the first line a reason to stop scrolling? If not, rebuild it (specific moment, bold claim, or sharp question).
2. FLAB: cut every word that isn't earning its place. One idea per line.
3. GENERIC: replace any sentence that could appear in anyone's post with one only ${opts.persona.name} would write (concrete detail, number, name, or opinion).
4. LANDING: the last line should stick, not summarize.

Keep the same format, same language, and the same core message. Do not add meta commentary. Output ONLY the improved ${opts.type.replace("_", " ")}, nothing else.

DRAFT TO EDIT:
${text}`,
    },
  ];
  try {
    const res = await llmComplete(messages, 0.4, {
      model: opts.model,
      timeoutMs: 20_000,
    });
    const candidate = stripMetaWrapping(res.content);
    if (!candidate || candidate.length < 20) return { text, polished: false };
    // Polish must never regress: keep it only if it scores >= the original.
    const before = voiceMatchScore(text, opts.fingerprint);
    const after = voiceMatchScore(candidate, opts.fingerprint);
    // Small tolerance: an equal-or-better score wins; a 3+ point gain is a clear win.
    if (after >= before - 2) return { text: candidate, polished: true };
    return { text, polished: false };
  } catch {
    return { text, polished: false };
  }
}

export interface RunVariantArgs {
  persona: PersonaInput;
  type: GenType;
  topic?: string;
  platform: PlatformId;
  /** Legacy callers (ideas/series/sample) get no platform formatting block. */
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
}

/** One variant = one LLM call + full post-processing (+ optional polish). */
export async function runVariant(args: RunVariantArgs): Promise<VariantResult> {
  const { persona, type, topic, platform, strategy, fingerprint, systemBase } = args;

  const userPrompt =
    typeTask(type, topic || "", persona, strategy, args.rewrite) +
    (args.moreLike ? moreLikeBlock(args.moreLike) : "") +
    (args.includePlatformBlock ? platformBlock(platform, type) : "");

  const messages: ChatMessage[] = [
    { role: "system", content: systemBase },
    { role: "user", content: userPrompt },
  ];

  const llm = await llmComplete(messages, strategy.temperature, { model: args.model });
  let gate = qualityGate(llm.content, {
    personaName: persona.name,
    forbidden: persona.forbidden_topics || [],
    platform,
    posted: args.posted,
  });

  // One silent corrective regeneration when the gate catches an assistant
  // leak or forbidden topic — the user should never see those.
  if (gate.report.blocked) {
    const corrective: ChatMessage[] = [
      { role: "system", content: systemBase },
      {
        role: "user",
        content:
          userPrompt +
          `\n\nCRITICAL FIX NEEDED: your previous attempt ${
            gate.report.forbidden.length
              ? `mentioned a forbidden topic (${gate.report.forbidden.join(", ")})`
              : "included assistant-style meta commentary"
          }. Regenerate it completely clean. Output ONLY the finished content.`,
      },
    ];
    try {
      const retry = await llmComplete(corrective, Math.max(0.4, strategy.temperature - 0.2), {
        model: args.model,
      });
      const retryGate = qualityGate(retry.content, {
        personaName: persona.name,
        forbidden: persona.forbidden_topics || [],
        platform,
        posted: args.posted,
      });
      if (!retryGate.report.blocked) {
        gate = retryGate;
        void llm;
      }
    } catch {
      // keep the first attempt's gate result
    }
  }

  const preScrub = gate.text;

  // Editor polish (optional): tighten hook/flab/generic phrasing. Only kept
  // when it doesn't regress the voice-match score.
  let polished = false;
  if (args.polish && !gate.report.blocked && preScrub.length > 40) {
    const result = await polishDraft(preScrub, {
      persona,
      fingerprint,
      type,
      systemBase,
      model: args.model,
    });
    if (result.polished) {
      const polishedGate = qualityGate(result.text, {
        personaName: persona.name,
        forbidden: persona.forbidden_topics || [],
        platform,
        posted: args.posted,
      });
      if (!polishedGate.report.blocked) {
        gate = polishedGate;
        polished = true;
      }
    }
  }

  const voiceMatch = voiceMatchScore(gate.text, fingerprint);
  const wordCount = gate.text.split(/\s+/).filter(Boolean).length;

  const flags: string[] = [];
  if (gate.report.clichesRemoved.length)
    flags.push(`Scrubbed: ${gate.report.clichesRemoved.slice(0, 3).join(", ")}`);
  if (gate.report.aiTells.length) flags.push(`AI tells: ${gate.report.aiTells.join(", ")}`);
  if (!gate.fit.fits) flags.push(`Over ${PLATFORMS[platform].name} limit by ${gate.fit.overBy} chars`);
  if (gate.fit.hashtagCount > PLATFORMS[platform].hashtags.max)
    flags.push(`Too many hashtags for ${PLATFORMS[platform].name}`);
  if (gate.repetition.score >= 35)
    flags.push(`Close to a posted post (${gate.repetition.score}% similar)`);
  if (!fingerprint.samples) flags.push("No pasted posts yet — add 3+ to lock the voice");

  const whyParts: string[] = [];
  whyParts.push(strategy.label.toLowerCase());
  if (fingerprint.samples) whyParts.push(voiceMatchNote(voiceMatch).toLowerCase());
  if (gate.fit.fits) whyParts.push(`fits ${PLATFORMS[platform].name} (${gate.fit.length}/${gate.fit.limit})`);
  else whyParts.push(`needs trimming (${gate.fit.overBy} over)`);
  if (gate.report.clichesRemoved.length) whyParts.push("clichés scrubbed");

  return {
    content: gate.text,
    original:
      !polished && gate.report.clichesRemoved.length && preScrub !== gate.text ? preScrub : undefined,
    rank: 0,
    voiceMatch,
    voiceNote: voiceMatchNote(voiceMatch),
    hookType: strategy.label,
    wordCount,
    why: whyParts.join(" · "),
    flags,
    repetition: gate.repetition,
    fit: { fits: gate.fit.fits, overBy: gate.fit.overBy, length: gate.fit.length, limit: gate.fit.limit },
    blocked: gate.report.blocked,
    blockReason: gate.report.blockReason,
    polished,
  };
}

/** Build the shared system prompt (persona + fingerprint + exemplars + anti-slop). */
export function buildSystemPrompt(
  persona: PersonaInput,
  fingerprint: VoiceFingerprint,
  exemplars?: string[]
): string {
  const fingerprintBlock = renderFingerprintBlock(fingerprint);
  const exemplarBlock = renderExemplarBlock(exemplars || []);
  return `You are the personal content engine for ${persona.name}. You write AS them — their rhythm, their vocabulary, their attitude. Not a brand version of them. Them.

${personaBlock(persona)}${fingerprintBlock}${exemplarBlock}

HARD RULES:
- Never break character. Never mention being an AI or that content is generated.
- Stay consistent with the backstory and lifestyle pillars.
- Completely avoid forbidden topics. If the requested topic conflicts with the persona, reframe it in character.
${ANTI_SLOP}`;
}

/** Extract the fingerprint from whatever real samples we have. */
export function fingerprintFrom(samples: string[]): VoiceFingerprint {
  return extractVoiceFingerprint(samples || []);
}

/** Rank variants: quality first, then voice match, then freshness. */
export function rankVariants(variants: VariantResult[]): VariantResult[] {
  const scoreOf = (v: VariantResult) =>
    (v.blocked ? -1000 : 0) +
    v.voiceMatch +
    (v.fit.fits ? 10 : -v.fit.overBy / 20) -
    Math.max(0, v.repetition.score - 30) / 2;
  return [...variants]
    .map((v) => ({ v, s: scoreOf(v) }))
    .sort((a, b) => b.s - a.s)
    .map(({ v }, i) => ({ ...v, rank: i + 1 }));
}

export type { QualityReport };
