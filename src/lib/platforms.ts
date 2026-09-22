/**
 * Persona OS — Engine v2
 * Platform specs: hard limits, fold positions, and native formatting rules.
 *
 * Every generated draft is checked against these specs before it reaches
 * the user, so "does this fit where I'm posting?" is answered before the
 * user ever has to ask.
 */

export type PlatformId = "x" | "linkedin" | "instagram" | "threads";

export interface PlatformSpec {
  id: PlatformId;
  name: string;
  /** Hard character limit enforced by the platform. */
  limit: number;
  /** Characters visible before "…more" truncation (the "fold"). */
  fold: number;
  /** Practical guidance baked into generation prompts. */
  promptHint: string;
  /** Platform-native formatting the generator should apply. */
  formatRules: string[];
  /** Hashtag policy: max count and placement. */
  hashtags: { max: number; placement: "inline" | "end" | "none" };
  /** Suggested image aspect ratios when the post carries media. */
  aspectRatios: string[];
  /** URL for copy-and-open. */
  composeUrl: string;
}

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  x: {
    id: "x",
    name: "X / Twitter",
    limit: 280,
    fold: 280,
    promptHint:
      "X rewards one sharp idea per post. Front-load the hook in the first 70 characters. Short lines. No hashtag spam — at most 1, and only if it earns its place. Links kill reach: never invent URLs.",
    formatRules: [
      "Hook in the first line — no warm-up sentences",
      "Line breaks between each idea; one idea per line",
      "If the content exceeds 280 characters, structure it as a numbered thread (1/, 2/, …) with each post under 280 characters",
      "End with a punchline or a clear takeaway, not a summary",
    ],
    hashtags: { max: 1, placement: "inline" },
    aspectRatios: ["16:9", "1:1"],
    composeUrl: "https://twitter.com/intent/tweet",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    limit: 3000,
    fold: 210,
    promptHint:
      "LinkedIn truncates after ~210 characters, so the first two lines decide everything. Use short paragraphs (1-2 lines) separated by blank lines. No external links in the first paragraph. End with a question or invitation to comment. Max 3 hashtags, at the very end.",
    formatRules: [
      "First 2 lines must work as a standalone hook (that is all anyone sees before '…see more')",
      "Blank line between every 1-2 sentence paragraph — whitespace is the formatting",
      "Professional but human; no corporate press-release voice",
      "End with one question or invitation that invites comments",
      "3 hashtags maximum, last line only",
    ],
    hashtags: { max: 3, placement: "end" },
    aspectRatios: ["1:1", "4:5"],
    composeUrl: "https://www.linkedin.com/feed/?shareActive=true",
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    limit: 2200,
    fold: 125,
    promptHint:
      "Instagram captions live next to an image, so the first line must make the image and the words click together. Emoji are punctuation here. Line breaks often. Hashtags go at the end, 3-8 of them, small and relevant.",
    formatRules: [
      "First line must connect to the accompanying image",
      "Use emoji as natural punctuation (not decoration spam)",
      "Short lines with breaks; scannable in 3 seconds",
      "3-8 relevant hashtags on the last line",
    ],
    hashtags: { max: 8, placement: "end" },
    aspectRatios: ["4:5", "1:1", "9:16"],
    composeUrl: "https://www.instagram.com/",
  },
  threads: {
    id: "threads",
    name: "Threads",
    limit: 500,
    fold: 100,
    promptHint:
      "Threads is casual and conversational — more like talking than publishing. One thought per post. Emoji welcome but not required. Hashtags barely matter: at most 1.",
    formatRules: [
      "Conversational, first-person, low-formality",
      "One clear thought; under 500 characters",
      "No hashtag blocks; at most 1 if any",
    ],
    hashtags: { max: 1, placement: "inline" },
    aspectRatios: ["1:1", "4:5"],
    composeUrl: "https://www.threads.net/",
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

/** Detect hashtags in text. */
export function countHashtags(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) || []).length;
}

/** Character count the way the platform counts it (URLs, emoji nuance approximated). */
export function effectiveLength(text: string): number {
  return [...text].length;
}

/** Word-safe chunking for text with no usable breaks. */
function chunkByWords(text: string, limit: number): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const t of tokens) {
    const cand = cur ? cur + " " + t : t;
    if ([...cand].length <= limit) cur = cand;
    else {
      if (cur) out.push(cur);
      cur = t;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Split long text into numbered thread posts, each within `limit`. */
export function splitThread(text: string, limit: number): string[] {
  const clean = text.trim();
  if (effectiveLength(clean) <= limit) return [clean];

  const room = limit - 5; // leave space for "1/ " numbering
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  const addPiece = (piece: string) => {
    const p = piece.trim();
    if (!p) return;
    const candidate = current ? current + "\n\n" + p : p;
    if (effectiveLength(candidate) <= room) {
      current = candidate;
    } else if (effectiveLength(p) <= room) {
      pushCurrent();
      current = p;
    } else {
      // Piece itself over the limit: try sentences, then hard word-chunking.
      pushCurrent();
      let pieces: string[] =
        p.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g) || [p];
      // Safety net: if the split lost text (regex edge cases), chunk by words.
      const rejoined = pieces.join(" ").length;
      if (rejoined < p.length - 10) pieces = chunkByWords(p, room);
      for (const s of pieces) {
        const st = s.trim();
        if (!st) continue;
        if (effectiveLength(st) > room) {
          pushCurrent();
          for (const piece2 of chunkByWords(st, room)) chunks.push(piece2);
          continue;
        }
        const c2 = current ? current + " " + st : st;
        if (effectiveLength(c2) <= room) {
          current = c2;
        } else {
          pushCurrent();
          current = st;
        }
      }
    }
  };

  for (const para of clean.split(/\n{2,}|\n/)) addPiece(para);
  pushCurrent();

  if (chunks.length > 1) {
    return chunks.map((c, i) => {
      const tag = `${i + 1}/${chunks.length}`;
      return effectiveLength(c) + effectiveLength(tag) + 2 <= limit ? `${tag} ${c}` : c;
    });
  }
  return chunks.length ? chunks : [clean];
}
