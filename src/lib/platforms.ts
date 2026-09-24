/**
 * Persona OS — Engine v2
 * Platform specs: hard limits, fold positions, and native formatting rules.
 *
 * Fold numbers and craft notes reflect 2025–2026 feed behavior research:
 * first-line survival, hashtag dilution, and platform-native tone.
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
      "X rewards density and opinion. One sharp idea. Front-load the hook in the first ~70 characters. Punchy lines. At most 1 hashtag if it earns its place. Links often hurt reach — never invent URLs. Threads (1/ 2/) only when the idea truly needs space.",
    formatRules: [
      "Hook in the first line — no warm-up",
      "One idea per line; line breaks between beats",
      "If over 280 chars, numbered thread (1/, 2/, …) each under 280",
      "End on a takeaway or sharp close, not a summary",
      "Contrarian, specific-number, and curiosity-gap hooks perform best",
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
      "LinkedIn truncates around ~210 characters — the first 1–2 lines decide the click. Short paragraphs (1–2 lines) separated by blank lines. Professional but human; no press-release voice. No links in the first paragraph. End with one comment-inviting question. Max 3 hashtags at the very end.",
    formatRules: [
      "First 2 lines = standalone hook (everything before 'see more')",
      "Blank line between every 1–2 sentence paragraph",
      "Prefer frameworks, specific results, and lessons over vague inspiration",
      "End with one question that invites a real comment",
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
      "Instagram truncates captions around ~125 characters. First line must work with the image. Short lines, natural line breaks. Emoji as sparse punctuation if on-brand. 3–5 relevant hashtags at the end (not 30). Carousel energy: clear, saveable idea.",
    formatRules: [
      "First line pairs with the image and survives the fold",
      "Hook → body → one CTA (save / comment a word / try this)",
      "Scannable in 3 seconds; short lines",
      "3–5 relevant hashtags on the last line only",
    ],
    hashtags: { max: 5, placement: "end" },
    aspectRatios: ["4:5", "1:1", "9:16"],
    composeUrl: "https://www.instagram.com/",
  },
  threads: {
    id: "threads",
    name: "Threads",
    limit: 500,
    fold: 100,
    promptHint:
      "Threads is conversational — talking, not publishing. One thought. Low formality. At most 1 hashtag. First ~100 characters matter most.",
    formatRules: [
      "Conversational first-person",
      "One clear thought under 500 characters",
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

  const room = limit - 5;
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
      pushCurrent();
      let pieces: string[] =
        p.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g) || [p];
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
