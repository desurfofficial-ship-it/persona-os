/**
 * Persona OS — Engine v2
 * The quality gate: every draft passes through here before the user sees it.
 *
 * An LLM's raw output is never ship-ready: it wraps content in meta
 * commentary ("Here's your caption:"), leaks AI tells ("As an AI..."),
 * leans on dead clichés ("game-changer"), and sometimes wanders into
 * forbidden territory. This module strips, flags, and scores — so the
 * user only ever sees clean, in-character drafts.
 */

import type { PlatformId } from "./platforms";
import { PLATFORMS, countHashtags, effectiveLength } from "./platforms";
import { tokenize } from "./duplicate";

/* ------------------------------ meta wrappers ------------------------------ */

const WRAPPER_PATTERNS: { pattern: RegExp; replacement?: string }[] = [
  // Assistant openers — require trailing punctuation so a genuine post that
  // happens to start with "Sure" or "Great" is not eaten.
  { pattern: /^\s*(sure|certainly|of course|great|awesome|got it)\s*[!,.:'-]+\s*/i },
  { pattern: /^\s*(here('|’)?s|this is)\s+(a|an|the|your)?\s*(quick\s+|short\s+|new\s+)?(caption|script|post|draft|version|rewrite|take|thread|series|outline|image prompt|prompt)\b[^:\n]*:\s*/i },
  // NOTE: "post" is deliberately absent — "POST 1:" is requested series structure.
  { pattern: /^\s*(caption|script|option|version|draft|variation|rewrite)\s*#?\d*\s*[:\-–—]\s*/i },
  { pattern: /^\s*(option|variation|draft|version)\s+\d+\s*\(([^)]*)\)\s*[:\-–—]\s*/i },
  { pattern: /^\s*(?:\*\*)?[\w\s]+(?:\*\*)?\s*[—–-]\s*(?:\*\*)?(?:caption|script|version)\s*(?:\*\*)?\s*\n+/i },
  // A model that wrapped the entire answer in quotes.
  { pattern: /^\s*["“]([\s\S]*)["”]\s*$/, replacement: "$1" },
];

const TRAILING_PATTERNS: RegExp[] = [
  /\n+\s*(hope this helps|let me know if|feel free to|want me to|would you like|need any adjustments?)[^\n]*\.?\s*$/i,
  /\n+\s*This (caption|script|post|version) (is designed|works|should)[^\n]*$/i,
];

/** Remove model meta-commentary so output starts at the actual content. */
export function stripMetaWrapping(raw: string): string {
  let text = raw.trim();
  // Run until stable (max 6 passes): "Sure! Here's your caption: ..." needs
  // multiple sequential strips, and order shouldn't matter.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const wp of WRAPPER_PATTERNS) {
      const next = text.replace(wp.pattern, wp.replacement ?? "");
      if (next.trim() && next !== text) {
        text = next.trim();
        changed = true;
      }
    }
    for (const p of TRAILING_PATTERNS) {
      const next = text.replace(p, "").trim();
      if (next && next !== text) {
        text = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Strip markdown fences if the model wrapped everything.
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  // Collapse 3+ blank lines to 2.
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

/* --------------------------------- clichés --------------------------------- */

export interface ClicheRule {
  pattern: RegExp;
  note: string;
  /** Optional silent replacement; if absent the phrase is simply deleted. */
  replace?: string;
}

export const CLICHE_RULES: ClicheRule[] = [
  { pattern: /\bgame-?changer\b/gi, note: "game-changer" },
  { pattern: /\bdelv(e|ing)\b/gi, note: "delve" },
  { pattern: /\bin today'?s (fast-?paced|digital|modern|ever-?changing) world\b/gi, note: "in today's world opener" },
  { pattern: /\bunlock(ing)? (the )?(power|full potential|secrets?) of\b/gi, note: "unlock the power" },
  { pattern: /\blevel up your\b/gi, note: "level up your" },
  { pattern: /\btake (it|things) to the next level\b/gi, note: "next level" },
  { pattern: /\brevolutioniz(e|ing)\b/gi, note: "revolutionize" },
  { pattern: /\bseamless(ly)? integrat/i, note: "seamlessly integrate" },
  { pattern: /\bin the realm of\b/gi, note: "in the realm of" },
  { pattern: /\bnavigat(e|ing) the (complexities|landscape|world) of\b/gi, note: "navigating the landscape" },
  { pattern: /\ba testament to\b/gi, note: "a testament to" },
  { pattern: /\bthe (secret|key) (sauce|lies)\b/gi, note: "the secret lies" },
  { pattern: /\bparadigm shift\b/gi, note: "paradigm shift" },
  { pattern: /\bsynerg(y|ies|istic)\b/gi, note: "synergy" },
  { pattern: /\bleverage\b/gi, replace: "use", note: "leverage → use" },
  { pattern: /\bbuckle up\b/gi, note: "buckle up" },
  { pattern: /\blet'?s dive (in|deep)\b/gi, note: "let's dive in" },
  { pattern: /\bmoving (on |forward,? )?let'?s\b/gi, note: "moving on, let's" },
  { pattern: /\bat the end of the day\b/gi, note: "at the end of the day" },
  { pattern: /\bjourney\b/gi, note: "journey" },
  { pattern: /\bauthentic\b/gi, note: "authentic (ironic)" },
  { pattern: /\bhustl(e|ing) (hard|smart)\b/gi, note: "hustle hard" },
  { pattern: /\bcrush(ing)? it\b/gi, note: "crushing it" },
  { pattern: /\belevat(e|ing) your\b/gi, note: "elevate your" },
  { pattern: /\btapestry\b/gi, note: "tapestry" },
  { pattern: /\bmy (two cents|2 cents)\b/gi, note: "two cents" },
  { pattern: /\bthoughts\?\s*(👇|below)/i, note: "thoughts? 👇" },
  { pattern: /\blet that sink in\b/gi, note: "let that sink in" },
  { pattern: /\band that'?s on period\b/gi, note: "and that's on period" },
  { pattern: /\bnot gonna lie\b/gi, note: "not gonna lie" },
  { pattern: /\bin this economy\b/gi, note: "in this economy" },
  { pattern: /\bthe algorithm\b/gi, note: "the algorithm (meta)" },
  { pattern: /\bcontent is king\b/gi, note: "content is king" },
  { pattern: /\bstop scrolling\b/gi, note: "stop scrolling (meta)" },
  { pattern: /\byou won'?t believe\b/gi, note: "you won't believe" },
  { pattern: /\bthis changed (my|everything)\b/gi, note: "this changed everything" },
  { pattern: /\bgame changer\b/gi, note: "game changer" },
  { pattern: /\bhey guys[,!]?\s*/gi, note: "hey guys opener" },
  { pattern: /\bso the other day\b/gi, note: "so the other day" },
  { pattern: /\bwithout further ado\b/gi, note: "without further ado" },
  { pattern: /\bin today'?s video\b/gi, note: "in today's video" },
];

export interface ClicheScan {
  text: string;
  removed: string[];
}

/** Remove/replace dead clichés. Returns the cleaned text and what was touched. */
export function scrubCliches(text: string): ClicheScan {
  let out = text;
  const removed: string[] = [];
  for (const rule of CLICHE_RULES) {
    if (rule.pattern.test(out)) {
      removed.push(rule.note);
      out = rule.replace
        ? out.replace(rule.pattern, rule.replace)
        : out.replace(rule.pattern, "");
    }
    rule.pattern.lastIndex = 0;
  }
  // Tidy artifacts from removals.
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ (\?|!|\.|,|:)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
  return { text: out, removed };
}

/* --------------------------------- AI tells -------------------------------- */

const AI_TELLS: { pattern: RegExp; note: string }[] = [
  { pattern: /\bas (?:an? )?(?:ai|language model|virtual assistant)\b/i, note: "mentions being an AI" },
  { pattern: /\bi (cannot|can'?t|am unable to)\b/i, note: "refusal boilerplate" },
  { pattern: /\bi'?d be (happy|glad) to\b/i, note: "assistant persona leak" },
  { pattern: /\bcertainly[!,.]/i, note: "assistant persona leak" },
  { pattern: /^\s*(sure|of course|great question)\b/i, note: "assistant opener" },
  { pattern: /\b(here|below) (is|are) (a|an|the|some|\d)/i, note: "meta intro" },
  { pattern: /\bwe asked (the )?(ai|model|assistant)\b/i, note: "meta reference" },
];

export function detectAiTells(text: string): string[] {
  return AI_TELLS.filter((t) => t.pattern.test(text)).map((t) => t.note);
}

/* ----------------------------- forbidden topics ----------------------------- */

/** Deterministic scan for forbidden topics mentioned in the draft. */
export function detectForbidden(text: string, forbidden: string[]): string[] {
  if (!forbidden?.length) return [];
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const topic of forbidden) {
    const t = topic.toLowerCase().trim();
    if (t.length < 2) continue;
    if (lower.includes(t)) hits.push(topic);
  }
  return hits;
}

/* ------------------------------- repetition -------------------------------- */

export interface RepetitionRisk {
  score: number; // 0-100
  against: string | null; // excerpt of the posted post it clashes with
}

/** Jaccard similarity of a candidate against each posted item, best match. */
export function repetitionRisk(text: string, posted: { content?: string }[]): RepetitionRisk {
  let best = 0;
  let against: string | null = null;
  for (const p of posted) {
    const a = tokenize(text);
    const b = tokenize(p.content || "");
    if (a.size === 0 || b.size === 0) continue;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const s = inter / (a.size + b.size - inter);
    if (s > best) {
      best = s;
      against = (p.content || "").replace(/\s+/g, " ").slice(0, 120);
    }
  }
  return { score: Math.round(best * 100), against };
}

/* ------------------------------ platform fit ------------------------------- */

export interface PlatformFit {
  fits: boolean;
  overBy: number;
  length: number;
  limit: number;
  hashtagCount: number;
  hashtagsOkay: boolean;
}

export function platformCheck(text: string, platform: PlatformId): PlatformFit {
  const spec = PLATFORMS[platform];
  const length = effectiveLength(text);
  const hashtagCount = countHashtags(text);
  return {
    fits: length <= spec.limit,
    overBy: Math.max(0, length - spec.limit),
    length,
    limit: spec.limit,
    hashtagCount,
    hashtagsOkay: hashtagCount <= spec.hashtags.max,
  };
}

/* ------------------------------ composite gate ----------------------------- */

export interface QualityReport {
  aiTells: string[];
  clichesRemoved: string[];
  forbidden: string[];
  /** True if the draft is too broken to show as-is. */
  blocked: boolean;
  blockReason: string | null;
}

/** Full deterministic quality pass on a raw model output. */
export function qualityGate(
  raw: string,
  opts: { personaName: string; forbidden?: string[]; platform: PlatformId; posted?: { content?: string }[] }
): { text: string; report: QualityReport; repetition: RepetitionRisk; fit: PlatformFit } {
  let text = stripMetaWrapping(raw);
  const scan = scrubCliches(text);
  text = scan.text;
  const aiTells = detectAiTells(text);
  const forbidden = detectForbidden(text, opts.forbidden || []);
  const repetition = repetitionRisk(text, opts.posted || []);
  const fit = platformCheck(text, opts.platform);

  const blocked =
    aiTells.some((t) => t.includes("AI") || t.includes("assistant") || t.includes("refusal")) ||
    forbidden.length > 0 ||
    text.length < 20;

  return {
    text,
    report: {
      aiTells,
      clichesRemoved: scan.removed,
      forbidden,
      blocked,
      blockReason: forbidden.length
        ? `Touches forbidden topic: ${forbidden[0]}`
        : aiTells.some((t) => t.includes("AI") || t.includes("assistant"))
          ? "Model leaked assistant language"
          : text.length < 20
            ? "Output too short to use"
            : null,
    },
    repetition,
    fit,
  };
}
