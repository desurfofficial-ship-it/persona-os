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

  // 2026 AI-tell vocabulary (Pangram / Graphite / Forbes tells research)
  { pattern: /\bensuring that\b/gi, note: "ensuring that" },
  { pattern: /\bensures that\b/gi, note: "ensures that" },
  { pattern: /\bhighlights the\b/gi, note: "highlights the" },
  { pattern: /\bplays a (crucial|critical|important|key) role\b/gi, note: "plays a crucial role" },
  { pattern: /\bis essential for\b/gi, note: "is essential for" },
  { pattern: /\brobust\b/gi, note: "robust" },
  { pattern: /\bseamless\b/gi, note: "seamless" },
  { pattern: /\bcomprehensive\b/gi, note: "comprehensive" },
  { pattern: /\bholistic\b/gi, note: "holistic" },
  { pattern: /\bmultifaceted\b/gi, note: "multifaceted" },
  { pattern: /\bpivotal\b/gi, note: "pivotal" },
  { pattern: /\bcutting-?edge\b/gi, note: "cutting-edge" },
  { pattern: /\bgroundbreaking\b/gi, note: "groundbreaking" },
  { pattern: /\btransformative\b/gi, note: "transformative" },
  { pattern: /\bunderscores?\b/gi, note: "underscores" },
  { pattern: /\bshowcas(e|es|ing)\b/gi, note: "showcase" },
  { pattern: /\bmeticulously\b/gi, note: "meticulously" },
  { pattern: /\bintricate\b/gi, note: "intricate" },
  { pattern: /\bplethora\b/gi, note: "plethora" },
  { pattern: /\bmyriad\b/gi, note: "myriad" },
  { pattern: /\bfoster(ing)?\b/gi, note: "foster" },
  { pattern: /\bharness(ing)?\b/gi, note: "harness" },
  { pattern: /\baligns (well )?with\b/gi, note: "aligns with" },
  { pattern: /\bin the landscape of\b/gi, note: "in the landscape of" },
  { pattern: /\bever-?(evolving|changing)\b/gi, note: "ever-evolving" },
  { pattern: /\bhere'?s the thing\b/gi, note: "here's the thing" },
  { pattern: /\blet me be clear\b/gi, note: "let me be clear" },
  { pattern: /\bthe truth is[,:]\b/gi, note: "the truth is" },
  { pattern: /\band that matters\.?$/gim, note: "and that matters" },
  { pattern: /\bthat'?s the (part|thing) (everyone|most people) miss/gi, note: "that's the part everyone misses" },
  { pattern: /\bwhich is exactly the point\b/gi, note: "which is exactly the point" },
  { pattern: /\bin conclusion[,:]/gi, note: "in conclusion" },
  { pattern: /\bfurthermore[,:]/gi, note: "furthermore" },
  { pattern: /\bmoreover[,:]/gi, note: "moreover" },
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


/* ------------------------ structural AI cadence (2026) --------------------- */

/** Patterns that read as machine cadence even without banned words. */
const STRUCTURAL_SLOP: { pattern: RegExp; note: string }[] = [
  // "It's not just X — it's Y" / "This isn't about X. It's about Y."
  {
    pattern: /\b(?:it'?s|this is) not (?:just |only |merely |simply )?.{3,60}?\b(?:it'?s|it is) (?:about |a )/gi,
    note: "not-just-X-its-Y frame",
  },
  {
    pattern: /\bthat'?s not .{5,40}\.\s*that'?s /gi,
    note: "that's-not-X-that's-Y frame",
  },
  {
    pattern: /\brather than (?:simply |merely |just |relying )/gi,
    note: "rather-than hedge",
  },
  {
    pattern: /\bless (?:like )?a .{3,30},?\s*more (?:like )?a /gi,
    note: "less-a-X-more-a-Y metaphor",
  },
  {
    pattern: /\bnot only .{5,40}\bbut also\b/gi,
    note: "not-only-but-also",
  },
];

export function detectStructuralSlop(text: string): string[] {
  const hits: string[] = [];
  for (const s of STRUCTURAL_SLOP) {
    if (s.pattern.test(text)) hits.push(s.note);
    s.pattern.lastIndex = 0;
  }
  // Em-dash density in short posts: >2 em/en dashes in <180 chars is a cluster signal
  const dashCount = (text.match(/[—–]/g) || []).length;
  if (text.length < 220 && dashCount >= 3) hits.push("em-dash density");
  // Symmetric beige bullets: 4+ lines starting the same way
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const bulletish = lines.filter((l) => /^[-•*✅🚀💡]/.test(l) || /^\d+[\.)]/.test(l));
  if (bulletish.length >= 4) {
    const starts = bulletish.map((l) => l.replace(/^[-•*\d.)\s]+/, "").slice(0, 12).toLowerCase());
    const uniq = new Set(starts);
    if (uniq.size <= 2) hits.push("beige bullet cluster");
  }
  return hits;
}


/* ------------------------------ packaging score ---------------------------- */

/**
 * Eden insight: most posts die in packaging (first line / fold), not the idea.
 * Deterministic 0–100 score for captions. Scripts/story use a lighter pass.
 */
export function packagingScore(
  text: string,
  opts?: { platformFold?: number; type?: string }
): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 70;
  const fold = opts?.platformFold ?? 125;
  const type = opts?.type || "caption";
  const trimmed = text.trim();
  if (!trimmed) return { score: 0, notes: ["empty"] };

  const firstLine =
    trimmed.split(/\n/).map((l) => l.trim()).find(Boolean) || trimmed;
  const firstLen = [...firstLine].length;

  // Fold survival: first line should land a punch inside the fold
  if (type === "caption" || type === "story_arc") {
    if (firstLen <= fold && firstLen >= 12) {
      score += 8;
    } else if (firstLen > fold) {
      score -= 12;
      notes.push("first line past fold");
    } else if (firstLen < 8) {
      score -= 8;
      notes.push("first line too thin");
    }
  }

  // Specificity signals (numbers, concrete nouns vs pure abstraction)
  if (/\d/.test(firstLine)) {
    score += 6;
    notes.push("specific number in hook");
  }
  if (/\b(i|i'm|i've|my)\b/i.test(firstLine)) {
    score += 3;
  }

  // Weak packaging openers
  if (/^(so |well |hey |hi |hello |today |just |really )/i.test(firstLine)) {
    score -= 15;
    notes.push("weak warm-up opener");
  }
  if (/^(in today'?s|in a world|as we all)/i.test(firstLine)) {
    score -= 18;
    notes.push("generic essay opener");
  }

  // Structural slop hurts packaging
  const slop = detectStructuralSlop(trimmed);
  score -= Math.min(20, slop.length * 6);
  for (const s of slop) notes.push(`slop:${s}`);

  // Burstiness: sentence length variance (flat = AI metronome)
  const sentences = trimmed.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 3);
  if (sentences.length >= 3) {
    const lens = sentences.map((s) => s.split(/\s+/).length);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance =
      lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length;
    if (variance < 4) {
      score -= 8;
      notes.push("flat sentence rhythm");
    } else if (variance > 12) {
      score += 4;
    }
  }

  // Triple re-summary heuristic: same content words repeating across sentences
  if (sentences.length >= 4) {
    const bags = sentences.map(
      (s) =>
        new Set(
          s
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 4)
        )
    );
    let highOverlap = 0;
    for (let i = 0; i < bags.length - 1; i++) {
      const a = bags[i];
      const b = bags[i + 1];
      if (!a.size || !b.size) continue;
      let inter = 0;
      for (const t of a) if (b.has(t)) inter++;
      if (inter / Math.min(a.size, b.size) > 0.45) highOverlap++;
    }
    if (highOverlap >= 2) {
      score -= 12;
      notes.push("re-summarizes same point");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, notes };
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

export interface QualityGateResult {
  /** Cleaned text ready to show the user. */
  cleaned: string;
  /** Original raw after only meta-strip (before cliché scrub). */
  original: string;
  /** True when cleaned differs from original. */
  changed: boolean;
  blocked: boolean;
  blockReason: string | null;
  flags: string[];
  report: QualityReport;
  repetition: RepetitionRisk;
  fit: PlatformFit;
}

type GenTypeLite = "caption" | "script" | "story_arc" | "image_prompt";

/**
 * Full deterministic quality pass on a raw model output.
 * Signature matches generation.ts runVariant usage.
 */
export function qualityGate(
  raw: string,
  opts: {
    platform: PlatformId;
    type?: GenTypeLite;
    persona?: { name?: string; forbidden_topics?: string[] };
    fingerprint?: unknown;
    forbidden?: string[];
    posted?: { content?: string }[];
  }
): QualityGateResult {
  const original = stripMetaWrapping(raw);
  let text = original;
  const scan = scrubCliches(text);
  text = scan.text;

  const aiTells = detectAiTells(text);
  const forbiddenList =
    opts.forbidden ||
    opts.persona?.forbidden_topics ||
    [];
  const forbidden = detectForbidden(text, forbiddenList);
  const repetition = repetitionRisk(text, opts.posted || []);

  // Scripts and image prompts are not constrained by caption character limits.
  const skipCharLimit =
    opts.type === "script" ||
    opts.type === "image_prompt" ||
    opts.type === "story_arc";
  const fit = skipCharLimit
    ? {
        fits: true,
        overBy: 0,
        length: effectiveLength(text),
        limit: PLATFORMS[opts.platform].limit,
        hashtagCount: countHashtags(text),
        hashtagsOkay: true,
      }
    : platformCheck(text, opts.platform);

  const structural = detectStructuralSlop(text);
  const flags: string[] = [];
  for (const t of aiTells) flags.push(`ai-tell:${t}`);
  for (const c of scan.removed) flags.push(`cliche:${c}`);
  for (const s of structural) flags.push(`slop:${s}`);
  for (const f of forbidden) flags.push(`forbidden:${f}`);
  if (!fit.hashtagsOkay) flags.push(`hashtags:${fit.hashtagCount}>max`);
  if (!fit.fits && !skipCharLimit) flags.push(`over-limit:${fit.overBy}`);
  if (repetition.score >= 35) flags.push(`repetition:${repetition.score}`);

  const blocked =
    aiTells.some(
      (t) =>
        t.includes("AI") ||
        t.includes("assistant") ||
        t.includes("refusal")
    ) ||
    forbidden.length > 0 ||
    text.length < 20;

  const blockReason = forbidden.length
    ? `Touches forbidden topic: ${forbidden[0]}`
    : aiTells.some(
        (t) => t.includes("AI") || t.includes("assistant")
      )
      ? "Model leaked assistant language"
      : text.length < 20
        ? "Output too short to use"
        : null;

  return {
    cleaned: text,
    original,
    changed: text !== original,
    blocked,
    blockReason,
    flags,
    report: {
      aiTells,
      clichesRemoved: scan.removed,
      forbidden,
      blocked,
      blockReason,
    },
    repetition,
    fit,
  };
}
