/**
 * Persona OS — Engine v2
 * Voice fingerprint ("Voice DNA"): a deterministic statistical profile of
 * HOW the persona actually writes, extracted from their real posts.
 *
 * Describing a voice in adjectives ("direct, irreverent") never survives
 * contact with an LLM. Showing the model the *statistics* of the real
 * writing — sentence rhythm, punctuation habits, emoji policy, hook style,
 * signature words — does. This module turns raw posts into that profile,
 * renders it as prompt constraints, and scores candidate outputs against
 * it so "does this sound like me?" becomes a number, not a vibe.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for",
  "with", "is", "are", "was", "were", "be", "been", "being", "it", "its",
  "this", "that", "these", "those", "i", "im", "ive", "my", "me", "mine",
  "we", "our", "us", "you", "your", "yours", "they", "their", "them", "he",
  "she", "his", "her", "at", "as", "by", "from", "about", "into", "over",
  "under", "after", "before", "how", "why", "what", "when", "where", "who",
  "not", "no", "yes", "do", "does", "did", "done", "so", "just", "can",
  "cant", "will", "would", "should", "could", "have", "has", "had", "get",
  "got", "out", "up", "down", "all", "more", "most", "some", "any", "than",
  "then", "there", "here", "now", "very", "too", "also", "because", "while",
  "one", "like", "dont", "didnt", "wasnt", "isnt", "wont", "even", "really",
]);

export interface VoiceFingerprint {
  /** Posts analyzed. */
  samples: number;
  /** Average words per sentence and the spread (rhythm). */
  avgSentenceWords: number;
  sentenceSpread: "short-punchy" | "varied" | "long-flowing";
  /** Words per post. */
  avgPostWords: number;
  /** Emoji per 100 words, plus the top emojis actually used. */
  emojiPer100: number;
  topEmojis: string[];
  /** Punctuation habits, per 100 sentences. */
  exclamations: number;
  questions: number;
  ellipses: number;
  emDashes: number;
  /** Ratio of sentences starting with "I" (0-1). */
  firstPersonOpeners: number;
  /** Dominant casing style. */
  casing: "sentence" | "lowercase" | "mixed-caps";
  /** Hook style of first lines. */
  hooks: string[];
  /** Signature words/phrases that make this voice recognizable. */
  signatureWords: string[];
  /** Line rhythm: mostly one-liners or multi-line blocks. */
  lineStyle: "one-liners" | "short-blocks" | "long-form";
  /** Whether posts typically end with a CTA/question. */
  endsWithQuestion: boolean;
}

/* ---------------------------------- extract --------------------------------- */

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) || [];
}

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}\u{2B00}-\u{2BFF}]/gu;

export function extractVoiceFingerprint(posts: string[]): VoiceFingerprint {
  const clean = posts.map((p) => (p || "").trim()).filter((p) => p.length > 20);
  const all = clean.join("\n");
  const sents = sentences(all);
  const w = words(all);
  const totalWords = w.length || 1;

  // Sentence rhythm
  const lens = sents.map((s) => words(s).length).filter((n) => n > 0);
  const avgSentenceWords = lens.length
    ? Math.round((lens.reduce((a, b) => a + b, 0) / lens.length) * 10) / 10
    : 12;
  const spread = lens.length > 1 ? stdDev(lens) : 4;
  const sentenceSpread =
    avgSentenceWords <= 10 ? "short-punchy" : avgSentenceWords >= 20 ? "long-flowing" : "varied";

  // Emoji
  const emojis = all.match(EMOJI_RE) || [];
  const emojiPer100 = Math.round(((emojis.length / totalWords) * 100) * 10) / 10;
  const emojiCount: Record<string, number> = {};
  for (const e of emojis) emojiCount[e] = (emojiCount[e] || 0) + 1;
  const topEmojis = Object.entries(emojiCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([e]) => e);

  // Punctuation per 100 sentences
  const nSents = Math.max(sents.length, 1);
  const per100 = (n: number) => Math.round((n / nSents) * 100);
  const exclamations = per100((all.match(/!/g) || []).length);
  const questions = per100((all.match(/\?/g) || []).length);
  const ellipses = per100((all.match(/\.\.\./g) || []).length);
  const emDashes = per100((all.match(/—|--/g) || []).length);

  // First-person openers
  const fpOpen = sents.filter((s) => /^(i|i'm|ive|i'll|my)\b/i.test(s)).length;
  const firstPersonOpeners = Math.round((fpOpen / nSents) * 100) / 100;

  // Casing: fraction of posts that are fully lowercase
  const lowerPosts = clean.filter((p) => p === p.toLowerCase() && /[a-z]/.test(p)).length;
  const capsWords = (all.match(/\b[A-Z]{3,}\b/g) || []).length;
  const casing =
    clean.length > 1 && lowerPosts / clean.length > 0.6
      ? "lowercase"
      : capsWords > clean.length
        ? "mixed-caps"
        : "sentence";

  // Hook style (first line of each post)
  const hooks: string[] = [];
  for (const p of clean) {
    const first = p.split("\n")[0].trim();
    if (/^(have you|what if|why do|ever notice|did you know)/i.test(first)) hooks.push("question");
    else if (/^\d/.test(first) || /\b\d+%|\$\d/.test(first)) hooks.push("number-or-stat");
    else if (/^(i|i'm|my|ive|when i|last|yesterday|today)/i.test(first)) hooks.push("first-person-story");
    else if (/^(most|everyone|nobody|stop|stop doing|unpopular)/i.test(first)) hooks.push("contrarian");
    else if (first.length <= 42 && !/[.?!]$/.test(first)) hooks.push("short-punch");
    else hooks.push("declarative");
  }
  const hookCounts: Record<string, number> = {};
  for (const h of hooks) hookCounts[h] = (hookCounts[h] || 0) + 1;
  const topHooks = Object.entries(hookCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([h]) => h);

  // Signature words: frequent non-stopwords that aren't ubiquitous English
  const freq: Record<string, number> = {};
  for (const word of w) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    freq[word] = (freq[word] || 0) + 1;
  }
  const signatureWords = Object.entries(freq)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  // Line style
  const lineCounts = clean.map((p) => p.split("\n").filter((l) => l.trim()).length);
  const avgLines = lineCounts.reduce((a, b) => a + b, 0) / (lineCounts.length || 1);
  const lineStyle =
    avgLines <= 1.6 ? "one-liners" : avgLines <= 6 ? "short-blocks" : "long-form";

  const endsWithQuestion =
    clean.filter((p) => /\?\s*$/.test(p.trim())).length / (clean.length || 1) > 0.4;

  return {
    samples: clean.length,
    avgSentenceWords,
    sentenceSpread,
    avgPostWords: Math.round(totalWords / (clean.length || 1)),
    emojiPer100,
    topEmojis,
    exclamations,
    questions,
    ellipses,
    emDashes,
    firstPersonOpeners,
    casing,
    hooks: topHooks,
    signatureWords,
    lineStyle,
    endsWithQuestion,
  };
}

function stdDev(nums: number[]): number {
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(v);
}

/* ---------------------------------- render ---------------------------------- */

/** Render the fingerprint as a strict prompt block for the generator. */
export function renderFingerprintBlock(fp: VoiceFingerprint): string {
  if (fp.samples === 0) return "";
  const lines: string[] = [
    "",
    "VOICE DNA — measured from this person's real posts. Match these statistics, not a generic 'social media' voice:",
    `- Sentence rhythm: ${fp.sentenceSpread} (avg ${fp.avgSentenceWords} words/sentence)`,
    `- Post length: ~${fp.avgPostWords} words per post`,
  ];
  if (fp.emojiPer100 >= 0.5) {
    lines.push(
      `- Emoji: YES, ${fp.emojiPer100}/100 words${fp.topEmojis.length ? ` (they use ${fp.topEmojis.join(" ")})` : ""}`
    );
  } else {
    lines.push("- Emoji: NO or extremely rare — write without emoji");
  }
  const punct: string[] = [];
  if (fp.exclamations >= 20) punct.push("exclamation marks are normal for them");
  else punct.push("almost never use exclamation marks");
  if (fp.questions >= 15) punct.push("asks questions mid-post");
  if (fp.ellipses >= 10) punct.push("uses ellipses for dramatic pauses");
  if (fp.emDashes >= 10) punct.push("uses em-dashes as a signature");
  lines.push(`- Punctuation: ${punct.join("; ")}`);
  if (fp.firstPersonOpeners >= 0.25)
    lines.push(
      `- Perspective: heavily first-person (${Math.round(fp.firstPersonOpeners * 100)}% of sentences start with I/my) — write from inside their head`
    );
  if (fp.casing === "lowercase") lines.push("- Casing: all lowercase — that is their brand, keep it");
  if (fp.casing === "mixed-caps") lines.push("- Casing: occasional ALL-CAPS words for emphasis");
  if (fp.hooks.length)
    lines.push(`- Hooks that are theirs: ${fp.hooks.join(", ")} — open with one of these styles`);
  if (fp.signatureWords.length)
    lines.push(
      `- Signature vocabulary (use naturally, don't force): ${fp.signatureWords.join(", ")}`
    );
  lines.push(`- Line style: ${fp.lineStyle.replace("-", " ")}`);
  if (fp.endsWithQuestion) lines.push("- They often end posts with a question to the reader");
  return lines.join("\n");
}

/* ----------------------------------- score ---------------------------------- */

/**
 * Score how well a candidate text matches the fingerprint (0-100).
 * Deterministic, instant, and used to rank variations honestly.
 */
export function voiceMatchScore(text: string, fp: VoiceFingerprint): number {
  if (fp.samples === 0) return 70; // neutral default when we have no samples
  let score = 50;

  const sents = sentences(text);
  const w = words(text);
  const avg =
    sents.length > 0 ? w.length / Math.max(sents.length, 1) : w.length;

  // Rhythm match (±25)
  const rhythmDelta = Math.abs(avg - fp.avgSentenceWords);
  score += rhythmDelta <= 3 ? 25 : rhythmDelta <= 6 ? 15 : rhythmDelta <= 10 ? 5 : -10;

  // Emoji policy match (±15)
  const emojis = text.match(EMOJI_RE) || [];
  const emojiRate = (emojis.length / Math.max(w.length, 1)) * 100;
  if (fp.emojiPer100 >= 0.5 && emojiRate >= 0.3) score += 15;
  else if (fp.emojiPer100 < 0.5 && emojiRate < 0.3) score += 15;
  else if (fp.emojiPer100 < 0.5 && emojiRate >= 1) score -= 15;
  else score += 5;

  // Casing match (±10)
  if (fp.casing === "lowercase" && text === text.toLowerCase()) score += 10;
  else if (fp.casing === "lowercase" && text !== text.toLowerCase()) score -= 5;
  else score += 5;

  // Punctuation personality (±10)
  const bangs = (text.match(/!/g) || []).length;
  if (fp.exclamations < 10 && bangs >= 2) score -= 10;
  else if (fp.exclamations >= 20 && bangs >= 1) score += 10;
  else score += 4;

  // First person (±10)
  const fpOpen = sents.filter((s) => /^(i|i'm|ive|i'll|my)\b/i.test(s)).length;
  const fpRatio = sents.length ? fpOpen / sents.length : 0;
  if (fp.firstPersonOpeners >= 0.25 && fpRatio >= 0.15) score += 10;
  else if (fp.firstPersonOpeners < 0.1 && fpRatio < 0.1) score += 5;
  else score += 2;

  // Signature vocabulary (±15)
  const lower = text.toLowerCase();
  const hits = fp.signatureWords.filter((word) => lower.includes(word)).length;
  score += Math.min(15, hits * 5);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Plain-language reason shown under each variation. */
export function voiceMatchNote(score: number): string {
  if (score >= 85) return "Nails their rhythm and vocabulary";
  if (score >= 70) return "Sounds like them";
  if (score >= 55) return "Close, slightly off their rhythm";
  return "Drifts from their voice — consider regenerating";
}
