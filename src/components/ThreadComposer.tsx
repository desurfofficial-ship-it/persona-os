"use client";

import { useEffect, useMemo, useState } from "react";
import { splitThread, PLATFORMS, type PlatformId } from "@/lib/platforms";
import {
  stripAllNumbering,
  stripNumbering,
  mergePosts,
  renumber,
  postStatus,
} from "@/lib/threads";
import { copyAndOpen, copyToClipboard } from "@/lib/share";

type ComposerMode = "x" | "linkedin";

/**
 * Platform-aware thread composer: an over-limit draft becomes editable
 * per-post cards with live char counts, merge control, and one-tap copy.
 * The user ships the thread straight from here — no external text surgery.
 *
 * Two modes:
 *  - X: 280-char numbered thread (1/, 2/, …), the native format.
 *  - LinkedIn: 3000-char posts. A LinkedIn-length draft usually fits in ONE
 *    part — no fake "1/2" numbering on a platform that doesn't thread;
 *    anything over 3000 splits into clean parts to paste in sequence.
 */
export default function ThreadComposer({
  content,
  platform,
  sharePlatform = "twitter",
}: {
  content: string;
  platform: PlatformId;
  /** Where "Copy first & open" should navigate (X or LinkedIn intent URL). */
  sharePlatform?: "twitter" | "linkedin";
}) {
  const [mode, setMode] = useState<ComposerMode>(platform === "linkedin" ? "linkedin" : "x");
  const numbered = mode === "x";
  const limit = mode === "x" ? 280 : PLATFORMS.linkedin.limit;

  const initial = useMemo(
    () => stripAllNumbering(splitThread(content, limit)),
    [content, limit]
  );
  const [posts, setPosts] = useState<string[]>(initial);
  const [copied, setCopied] = useState<string | null>(null);

  // Switching platform recomputes the split (different limits, different
  // numbering) — same contract as a fresh open.
  useEffect(() => {
    setPosts(stripAllNumbering(splitThread(content, limit)));
  }, [content, limit]);

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const setPost = (i: number, text: string) =>
    setPosts((prev) => prev.map((p, idx) => (idx === i ? text : p)));

  const doMerge = (i: number) =>
    setPosts((prev) => mergePosts(prev, i, limit) || prev);

  const finalText = renumber(posts, limit, numbered);

  const copyAll = async () => {
    const text = numbered
      ? finalText.map((p, i) => `${i + 1}/${finalText.length}\n${stripNumbering(p)}`).join("\n\n")
      : finalText.join("\n\n");
    if (await copyToClipboard(text)) flash("all");
  };

  const copyOne = async (i: number) => {
    if (await copyToClipboard(finalText[i])) flash(String(i));
  };

  const copyFirstOpen = async (i: number) => {
    if (await copyToClipboard(finalText[i])) flash(String(i));
    copyAndOpen(finalText[i], mode === "linkedin" ? "linkedin" : sharePlatform);
  };

  const overCount = posts.filter((p, i) => !postStatus(p, limit).ok && p.trim()).length;

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-medium text-zinc-300">
          {mode === "x" ? "X / Twitter" : "LinkedIn"} — {posts.length}{" "}
          {posts.length === 1 ? (mode === "linkedin" ? "post (fits the limit)" : "post") : "posts"}
          , edit each part before posting
        </p>
        <div className="flex items-center gap-2">
          {overCount > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-950 border border-red-800 text-red-300">
              {overCount} over the {limit}-char limit
            </span>
          )}
          {/* Platform toggle: X threads are numbered; LinkedIn is not */}
          <div className="flex rounded-md border border-zinc-700 overflow-hidden" role="tablist" aria-label="Composer platform">
            {(["x", "linkedin"] as ComposerMode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`text-[10px] px-2.5 py-1 font-medium ${
                  mode === m ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {m === "x" ? "X · 280" : "LinkedIn · 3,000"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {posts.map((post, i) => {
          const st = postStatus(post, limit);
          const isEmpty = !post.trim();
          return (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {i + 1} of {posts.length}
                  {mode === "linkedin" && posts.length > 1 ? " — paste in order" : ""}
                </span>
                <div className="flex items-center gap-2">
                  {i < posts.length - 1 && (
                    <button
                      onClick={() => doMerge(i)}
                      title="Merge with the next post (only when it fits)"
                      className="text-[10px] px-2 py-0.5 border border-zinc-700 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
                    >
                      ⇩ merge next
                    </button>
                  )}
                  <span
                    className={`text-[10px] tabular-nums ${
                      isEmpty ? "text-zinc-600" : st.ok ? "text-zinc-500" : "text-red-400 font-medium"
                    }`}
                  >
                    {st.len}/{limit}
                    {st.over > 0 ? ` (+${st.over})` : ""}
                  </span>
                </div>
              </div>
              <textarea
                value={post}
                onChange={(e) => setPost(i, e.target.value)}
                rows={Math.min(12, Math.max(2, Math.ceil(post.length / (mode === "x" ? 60 : 90)) + 1))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 leading-relaxed focus:outline-none focus:border-zinc-500"
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={() => copyFirstOpen(0)}
          className="min-h-[40px] px-4 bg-white text-black rounded-lg text-xs font-semibold hover:bg-zinc-200"
        >
          Copy 1 &amp; open {mode === "x" ? "X" : "LinkedIn"}
        </button>
        <button
          onClick={copyAll}
          className="min-h-[40px] px-4 border border-zinc-600 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800"
        >
          {copied === "all" ? "Copied ✓" : numbered ? "Copy whole thread" : "Copy whole post"}
        </button>
        <span className="text-[11px] text-zinc-600">
          {mode === "x"
            ? `Posts 2…${posts.length} copy from their own buttons — platforms don't take multi-post paste.`
            : posts.length > 1
              ? "Over 3,000 characters — the parts below paste one after another, top to bottom."
              : "Long-form is LinkedIn native — the fold sits after ~2 lines, so keep the hook up top."}
        </span>
      </div>

      {/* Per-post copy row */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {posts.map((_, i) => (
          <button
            key={i}
            onClick={() => copyOne(i)}
            className={`text-[10px] px-2 py-1 rounded border ${
              copied === String(i)
                ? "border-green-700 text-green-400"
                : "border-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-800"
            }`}
          >
            {copied === String(i) ? `✓ ${i + 1}` : `Copy ${i + 1}`}
          </button>
        ))}
      </div>
    </div>
  );
}
