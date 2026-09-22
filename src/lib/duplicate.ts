/**
 * Lightweight duplicate-topic detection.
 *
 * Compares a topic (or generated result) against content the user has
 * already marked as Posted, using word-set similarity (Jaccard) with a
 * stop-word filter. Runs fully client-side so the warning feels live.
 */

export type Sensitivity = "low" | "medium" | "high";

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for",
  "with", "is", "are", "was", "were", "be", "been", "being", "it", "its",
  "this", "that", "these", "those", "i", "im", "my", "me", "mine", "we",
  "our", "us", "you", "your", "yours", "they", "their", "them", "he", "she",
  "his", "her", "at", "as", "by", "from", "about", "into", "over", "under",
  "after", "before", "how", "why", "what", "when", "where", "who", "not",
  "no", "yes", "do", "does", "did", "done", "so", "just", "can", "cant",
  "will", "would", "should", "could", "have", "has", "had", "get", "got",
  "out", "up", "down", "all", "more", "most", "some", "any", "than", "then",
  "them", "there", "here", "now", "very", "too", "also", "because", "while",
]);

const THRESHOLDS: Record<Sensitivity, number> = {
  low: 0.5,
  medium: 0.35,
  high: 0.2,
};

export interface PostedPost {
  id: string;
  content: string;
  created_at: string;
}

export interface SimilarPost {
  post: PostedPost;
  score: number;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

export function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;

  return intersection / (ta.size + tb.size - intersection);
}

/** Returns posted posts that are too close to the given text, best match first. */
export function findSimilarPosts(
  text: string,
  posted: PostedPost[],
  sensitivity: Sensitivity
): SimilarPost[] {
  const threshold = THRESHOLDS[sensitivity];
  const trimmed = text.trim();
  if (trimmed.length < 4) return [];

  return posted
    .map((post) => ({ post, score: similarity(trimmed, post.content) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export function formatPostedDate(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString();
}

export function sensitivityLabel(s: Sensitivity): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
