/**
 * Thread composer helpers — pure, testable string surgery for turning one
 * long draft into platform-native thread posts the user can edit per-post.
 *
 * splitThread() (platforms.ts) produces posts possibly prefixed "1/ ", "2/ ".
 * The composer strips those prefixes so edits never fight the numbering,
 * then re-numbers on copy with overflow-safe tags.
 */

import { effectiveLength } from "./platforms";

/** Remove leading thread numbering like "1/ ", "12/40 " from a post. */
export function stripNumbering(post: string): string {
  return post.replace(/^\s*\d{1,3}\s*\/\s*\d{0,3}\s+/, "");
}

export function stripAllNumbering(posts: string[]): string[] {
  return posts.map(stripNumbering);
}

/**
 * Re-apply "i/N " numbering only when it still fits inside `limit`, and only
 * when the platform actually numbers its threads (`numbered`): X threads are
 * numbered 1/, 2/, …; LinkedIn has no native threading, so long posts split
 * into clean unnumbered parts the user pastes one after another.
 * Mirrors splitThread's overflow rule: if the tag would push a post over
 * the limit, that post ships untagged rather than truncated.
 */
export function renumber(posts: string[], limit: number, numbered = true): string[] {
  if (posts.length <= 1) return posts.map(stripNumbering);
  if (!numbered) return posts.map(stripNumbering);
  const n = posts.length;
  return posts.map((p, i) => {
    const clean = stripNumbering(p);
    const tag = `${i + 1}/${n}`;
    const candidate = `${tag} ${clean}`;
    return effectiveLength(candidate) <= limit ? candidate : clean;
  });
}

/** Live per-post status for the composer UI. */
export function postStatus(
  text: string,
  limit: number
): { len: number; over: number; ok: boolean } {
  const len = effectiveLength(text);
  const over = Math.max(0, len - limit);
  return { len, over, ok: over === 0 };
}

/**
 * Merge post[i] and post[i+1] with a blank line, word-safe: if the merged
 * text exceeds `limit` the merge is refused (caller keeps both posts).
 * Returns null when the merge is impossible.
 */
export function mergePosts(posts: string[], i: number, limit: number): string[] | null {
  if (i < 0 || i >= posts.length - 1) return null;
  const merged = `${stripNumbering(posts[i])}\n\n${stripNumbering(posts[i + 1])}`;
  if (effectiveLength(merged) > limit) return null;
  return [...posts.slice(0, i), merged, ...posts.slice(i + 2)];
}

/** Join edited posts into the final thread text, renumbered where it fits. */
export function composeThread(posts: string[], limit: number): string {
  return renumber(posts, limit).join("\n\n---\n\n");
}
