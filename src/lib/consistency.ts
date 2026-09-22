/**
 * Consistency Engine v1 — cross-content contradiction detection.
 *
 * The /api/check route asks "does THIS text break character?".
 * This module answers the harder question the persona spec demands:
 * "do your posts and scripts CONTRADICT EACH OTHER?"
 *
 * Design (honest two-layer approach):
 *
 *  Layer 1 — deterministic claim extraction (free, instant, testable):
 *    Pull first-person factual claims out of every piece of content:
 *    identity statements ("I am/I'm X"), possession ("I have/own/drive X"),
 *    habits & exclusions ("I never X", "I always X", "every day I X"),
 *    and numeric facts ("I have 2 kids", "$10k months", "down 15 lbs").
 *
 *  Layer 2 — LLM contradiction scan (semantic, runs server-side):
 *    All content is compressed and a single LLM pass finds contradiction
 *    PAIRS the deterministic layer can't catch (vegan in March, steakhouse
 *    review in July). The API route merges both layers.
 *
 * Everything here is pure and deterministic so it can be unit-tested.
 */

export interface ScanItem {
  id: string;
  content: string;
  type: string;
  posted: boolean;
  createdAt: string;
}

export interface ExtractedClaim {
  quote: string;      // exact sentence containing the claim
  kind: "identity" | "possession" | "habit" | "exclusion" | "numeric";
  slot?: string;      // normalized subject, e.g. "diet", "car", "kids", "workout"
  value?: string;     // normalized value, e.g. "vegan", "2", "never drinks"
}

export interface Contradiction {
  a: { quote: string; itemId: string; date: string };
  b: { quote: string; itemId: string; date: string };
  why: string;
  severity: "high" | "medium" | "low";
  resolution: string;
  source: "deterministic" | "llm";
}

/* ------------------------------------------------------------------ */
/* Layer 1: deterministic claim extraction                             */
/* ------------------------------------------------------------------ */

const FIRST_PERSON = /(^|[\s.!?,"'])(i|i'm|im|i've|ive|i'll|ill|my|me)\b/i;

const IDENTITY = /\b(?:i(?:'m| am)|called|people call me|known as)\s+([a-z][a-z\s'-]{1,40})/i;
const POSSESSION = /\b(?:i|we)\s+(?:have|has|own(?:ed)?|drive|driving|bought|got|ride)\s+(?:a|an|my|two|\d+)?\s*([a-z0-9][a-z0-9\s'-]{1,40})/i;
const EXCLUSION = /\b(?:i|we)\s+(?:never|don't|dont|do not|won't|wont|stopped|quit|avoid)\s+([a-z][a-z\s'-]{1,40})/i;
const HABIT = /\b(?:i|we)\s+(?:always|every (?:day|morning|night|weekend)|only)\s+([a-z][a-z\s'-]{1,40})/i;
const NUMERIC = /\b(?:i|we)\s+(?:have|make|mades|earned|lost|gained|weigh|weighed|am|was)\s+(\$?\d[\d,.]*\s*(?:k|m|lbs?|kg|years old|kids?|children|employees|clients)?)\b/i;

/** Split content into sentences robustly (handles missing punctuation / line breaks). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

/** Normalize a phrase for slot comparison: lowercase, strip filler, collapse spaces. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(a|an|the|my|our|really|just|literally|actually|basically)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a phrase into a comparable slot (diet, drink, car, family, work...). */
const SLOT_RULES: { slot: string; any: RegExp }[] = [
  { slot: "diet", any: /\b(vegan|vegetarian|carnivore|pescatarian|keto|paleo|gluten.?free|dairy.?free)\b/i },
  { slot: "meat", any: /\b(steak|burger|ribeye|bacon|brisket|pork|rib|chicken wing|hot dog|kebab)\b/i },
  { slot: "alcohol", any: /\b(whisk[e]y|vodka|tequila|wine|beer|cocktail|drinking|shots|gin|rum|sake|champagne)\b/i },
  { slot: "car", any: /\b(lambo|rari|ferrari|porsche|tesla|bmw|mercedes|benz|audi|roll(s)? royce|bentley|car|truck|suv|mustang|corvette)\b/i },
  { slot: "transit", any: /\b(subway|metro|bus|train|bike|bicycle|walk(ing)? to work|carpool)\b/i },
  { slot: "relationship", any: /\b(married|single|divorc(ed|e)|engaged|girlfriend|boyfriend|wife|husband|partner)\b/i },
  { slot: "kids", any: /\b(kids?|children|son|daughter|child)\b/i },
  { slot: "location", any: /\b(live (?:in|at)|moved to|based (?:in|out of)|in (?:nyc|la|london|miami|austin|sf|tokyo|paris|dubai))\b/i },
  { slot: "gym", any: /\b(gym|lift(ing)?|weight(s| training)?|crossfit|pilates|yoga|running|marathon)\b/i },
  { slot: "wakeup", any: /\b(5\s?am|6\s?am|4\s?am|wake up|waking up|sunrise|early riser|morning person|night owl|2\s?am)\b/i },
  { slot: "smoking", any: /\b(smok(e|ing)|cigarette|vape|vaping|nicotine)\b/i },
  { slot: "religion", any: /\b(christian|catholic|muslim|jewish|buddhist|atheist|agnostic|hindu)\b/i },
  { slot: "politics", any: /\b(conservative|liberal|libertarian|leftist|right.?wing|left.?wing)\b/i },
];

function slotOf(phrase: string): string | undefined {
  return SLOT_RULES.find((r) => r.any.test(phrase))?.slot;
}

/** Known mutually-exclusive slot values — hard contradictions, no LLM needed. */
const OPPOSITES: Record<string, RegExp[]> = {
  diet: [/\b(vegan|vegetarian)\b/i, /\b(carnivore|steak|burger|ribeye|bacon|brisket)\b/i],
  alcohol: [/\b(never drink|don't drink|dont drink|sober|teetotal|quit drinking)\b/i, /\b(whisk[e]y|vodka|tequila|wine|beer|cocktail|shots|drinking)\b/i],
  transit: [/\b(lambo|ferrari|porsche|tesla|bmw|mercedes|benz|audi|rolls royce|bentley|drive|my car)\b/i, /\b(subway|metro|bus|no car|sold my car)\b/i],
  smoking: [/\b(never smok|quit smok|don't smok|dont smok)\b/i, /\b(smok(e|ing)|cigarette|vape|vaping)\b/i],
  wakeup: [/\b(morning person|5\s?am|4\s?am|early riser|sunrise)\b/i, /\b(night owl|2\s?am|3\s?am|4\s?am club.*bed|stay up)\b/i],
};

/**
 * Extract first-person factual claims from one piece of content.
 * Only sentences that look like first-person statements are considered,
 * and each claim keeps its exact quote for UI display.
 */
export function extractClaims(content: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();

  for (const sentence of splitSentences(content)) {
    if (!FIRST_PERSON.test(sentence)) continue;

    const push = (kind: ExtractedClaim["kind"], match: RegExp, slotHint?: string) => {
      const m = sentence.match(match);
      if (!m) return;
      const value = norm(m[0]);
      if (value.length < 2 || seen.has(value)) return;
      seen.add(value);
      claims.push({ quote: sentence.slice(0, 200), kind, slot: slotHint || slotOf(sentence), value });
    };

    push("identity", IDENTITY);
    push("possession", POSSESSION);
    push("exclusion", EXCLUSION);
    push("habit", HABIT);
    push("numeric", NUMERIC);
  }

  return claims.slice(0, 12);
}

/**
 * Deterministic contradiction pass over ALL content.
 *
 * Layer A — claim pairs: extracted first-person claims mapped into slots,
 * flagged when two items take opposite sides of a known-exclusive pair.
 *
 * Layer B — content-level pairs: real posts often drop the pronoun
 * ("Just destroyed a ribeye"), so claim extraction alone misses them.
 * When two items both read as first-person overall and land on opposite
 * sides of an exclusive pair, flag them. Transformation stories
 * ("I used to be vegan") are evolution, not contradiction — skipped.
 */
export function deterministicContradictions(items: ScanItem[]): Contradiction[] {
  const out: Contradiction[] = [];
  const claimIndex: { item: ScanItem; claim: ExtractedClaim }[] = [];

  for (const item of items) {
    for (const claim of extractClaims(item.content)) {
      claimIndex.push({ item, claim });
    }
  }

  const push = (A: { item: ScanItem; quote: string; slot: string }, B: { item: ScanItem; quote: string; slot: string }) => {
    out.push({
      a: { quote: A.quote.slice(0, 200), itemId: A.item.id, date: A.item.createdAt },
      b: { quote: B.quote.slice(0, 200), itemId: B.item.id, date: B.item.createdAt },
      why: `These two posts take opposite positions on the same fact (${A.slot}). Followers notice this first.`,
      severity: A.slot === "diet" || A.slot === "alcohol" ? "high" : "medium",
      resolution:
        "Pick the version that is actually true and keep it everywhere — or openly own the change (\"I used to X, here's what happened\").",
      source: "deterministic",
    });
  };

  // Layer A: sentence-level claim pairs.
  for (let i = 0; i < claimIndex.length; i++) {
    for (let j = i + 1; j < claimIndex.length; j++) {
      const A = claimIndex[i];
      const B = claimIndex[j];
      if (A.item.id === B.item.id) continue;

      const slotA = A.claim.slot;
      if (slotA && slotA === B.claim.slot) {
        const rules = OPPOSITES[slotA];
        if (rules && rules.length === 2) {
          const aVal = A.claim.value ?? "";
          const bVal = B.claim.value ?? "";
          const a0 = rules[0].test(aVal) || rules[0].test(A.claim.quote);
          const a1 = rules[1].test(aVal) || rules[1].test(A.claim.quote);
          const b0 = rules[0].test(bVal) || rules[0].test(B.claim.quote);
          const b1 = rules[1].test(bVal) || rules[1].test(B.claim.quote);
          if ((a0 && b1) || (a1 && b0)) {
            push(
              { item: A.item, quote: A.claim.quote, slot: slotA },
              { item: B.item, quote: B.claim.quote, slot: slotA }
            );
          }
        }
      }
    }
  }

  // Layer B: sentence-level opposite sides — real posts drop the pronoun
  // ("Just destroyed a ribeye"), so claim extraction alone misses them.
  // Sentences that are hypothetical/conditional ("I'd give up steak if...")
  // or transformational ("I used to be vegan") never count as claims.
  const CONDITIONAL = /\b(if|would|could|should|told me|gave up|give up|swear off)\b/i;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i];
      const B = items[j];
      if (A.id === B.id) continue;
      if (!FIRST_PERSON.test(A.content) || !FIRST_PERSON.test(B.content)) continue;

      for (const [slot, rules] of Object.entries(OPPOSITES)) {
        if (!rules || rules.length !== 2) continue;
        const sideA0 = claimSentences(A.content, rules[0]);
        const sideA1 = claimSentences(A.content, rules[1]);
        const sideB0 = claimSentences(B.content, rules[0]);
        const sideB1 = claimSentences(B.content, rules[1]);

        const opposed =
          (sideA0.length > 0 && sideB1.length > 0 && sideA1.length === 0 && sideB0.length === 0) ||
          (sideA1.length > 0 && sideB0.length > 0 && sideA0.length === 0 && sideB1.length === 0);
        if (opposed) {
          const aIs0 = sideA0.length > 0;
          const quoteA = (aIs0 ? sideA0 : sideA1).sort((x, y) => x.length - y.length)[0];
          const quoteB = (aIs0 ? sideB1 : sideB0).sort((x, y) => x.length - y.length)[0];
          push({ item: A, quote: quoteA, slot }, { item: B, quote: quoteB, slot });
        }
      }
    }
  }

  // Dedupe by quote pair (Layer B often re-finds Layer A's pair).
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = [c.a.quote, c.b.quote].sort().join("||");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

/**
 * Sentences that genuinely CLAIM the given pattern: first-person statement,
 * not hypothetical ("if you told me I'd give up steak"), not a
 * transformation reference ("I used to be vegan", "I quit").
 */
function claimSentences(content: string, pattern: RegExp): string[] {
  const CONDITIONAL = /\b(if|would|could|should|told me|gave up|give up|swear off)\b/i;
  const EVOLUTION = /\b(used to|no longer|back then|i quit|i stopped)\b/i;
  return splitSentences(content).filter(
    (s) => FIRST_PERSON.test(s) && pattern.test(s) && !CONDITIONAL.test(s) && !EVOLUTION.test(s)
  );
}

/* ------------------------------------------------------------------ */
/* Consistency health score                                            */
/* ------------------------------------------------------------------ */

/**
 * 100 = no contradictions. Each high-severity contradiction costs 20,
 * medium 12, low 6. Floor of 10 so a messy archive still reads as a number.
 */
export function consistencyScore(contradictions: Contradiction[]): number {
  const cost = contradictions.reduce(
    (sum, c) => sum + (c.severity === "high" ? 20 : c.severity === "medium" ? 12 : 6),
    0
  );
  return Math.max(10, 100 - cost);
}

/* ------------------------------------------------------------------ */
/* LLM scan input compression                                          */
/* ------------------------------------------------------------------ */

export const MAX_SCAN_ITEMS = 30;
export const MAX_CHARS_PER_ITEM = 400;

/**
 * Compress drafts into a numbered evidence pack for the LLM:
 * [#3 · posted · Mar 12] first 400 chars — enough signal, tiny payload.
 */
export function buildEvidencePack(items: ScanItem[]): string {
  return items
    .slice(0, MAX_SCAN_ITEMS)
    .map((item, i) => {
      const date = new Date(item.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const body =
        item.content.length > MAX_CHARS_PER_ITEM
          ? `${item.content.slice(0, MAX_CHARS_PER_ITEM)}…`
          : item.content;
      return `[#${i + 1} · ${item.posted ? "posted" : "draft"} · ${date} · ${item.type}]\n${body}`;
    })
    .join("\n\n");
}

export function itemIdFromEvidence(items: ScanItem[], n: number): string | undefined {
  return items[n - 1]?.id;
}
