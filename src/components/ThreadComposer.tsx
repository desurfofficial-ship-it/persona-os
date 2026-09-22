"use client";

import { useMemo, useState } from "react";
import { splitThread, PLATFORMS, type PlatformId } from "@/lib/platforms";
import {
  stripAllNumbering,
  stripNumbering,
  mergePosts,
  renumber,
  postStatus,
} from "@/lib/threads";
import { copyAndOpen, copyToClipboard } from "@/lib/share";

/**
 * Platform-aware thread composer: an over-limit draft becomes editable
 * per-post cards with live char counts, merge control, and one-tap copy.
 * The user ships the thread straight from here — no external text surgery.
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
  const spec = PLATFORMS[platform];
  const limit = Math.min(spec.limit, platform === "x" ? 280 : 500);

  const initial = useMemo(
    () => stripAllNumbering(splitThread(content, limit)),
    [content, limit]
  );
  const [posts, setPosts] = useState<string[]>(initial);
  const [copied, setCopied] = useState<string | null>(null);

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const setPost = (i: number, text: string) =>
    setPosts((prev) => prev.map((p, idx) => (idx === i ? text : p)));

  const doMerge = (i: number) =>
    setPosts((prev) => mergePosts(prev, i, limit) || prev);

  const finalText = renumber(posts, limit);

  const copyAll = async () => {
    const text = finalText.map((p, i) => `${i + 1}/${finalText.length}\n${stripNumbering(p)}`).join("\n\n");
    if (await copyToClipboard(text)) flash("all");
  };

  const copyOne = async (i: number) => {
    if (await copyToClipboard(finalText[i])) flash(String(i));
  };

  const copyFirstOpen = async (i: number) => {
    if (await copyToClipboard(finalText[i])) flash(String(i));
    copyAndOpen(finalText[i], sharePlatform);
  };

  const overCount = posts.filter((p, i) => !postStatus(p, limit).ok && p.trim()).length;

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-medium text-zinc-300">
          {spec.name} thread — {posts.length} post{posts.length === 1 ? "" : "s"}, edit each part
          before posting
        </p>
        {overCount > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-950 border border-red-800 text-red-300">
            {overCount} over the {limit}-char limit
          </span>
        )}
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
                rows={Math.min(10, Math.max(2, Math.ceil(post.length / 60) + 1))}
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
          Copy 1 &amp; open {spec.name}
        </button>
        <button
          onClick={copyAll}
          className="min-h-[40px] px-4 border border-zinc-600 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800"
        >
          {copied === "all" ? "Copied ✓" : "Copy whole thread"}
        </button>
        <span className="text-[11px] text-zinc-600">
          Posts 2…{posts.length} copy from their own buttons — platforms don&apos;t take multi-post
          paste.
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
