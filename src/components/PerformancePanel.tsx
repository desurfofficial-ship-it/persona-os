"use client";

import { computePerformance, compactNumber, type MetricsDraft } from "@/lib/metrics";

interface PersonaStats {
  draftCount: number;
  postedCount: number;
}

export default function PerformancePanel({
  drafts,
  stats,
}: {
  drafts: MetricsDraft[];
  stats: PersonaStats;
}) {
  const perf = computePerformance(drafts, stats.postedCount);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-10">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-medium text-zinc-400">Performance</h2>
        {perf.loggedPosts > 0 && (
          <span className="text-xs text-zinc-500">
            {perf.loggedPosts} logged · avg {compactNumber(perf.avgViews)} views
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        You log the numbers, we do the math. Log views/likes on posted items from the Drafts page —
        platform auto-import comes later.
      </p>

      {perf.loggedPosts === 0 ? (
        <div className="text-sm text-zinc-500 bg-zinc-950/50 border border-zinc-800 rounded-lg p-4">
          {perf.unloggedPosted > 0 ? (
            <>
              <span className="text-zinc-300">{perf.unloggedPosted} posted item{perf.unloggedPosted === 1 ? "" : "s"}</span>{" "}
              with no numbers yet. Open <a href="/dashboard/drafts" className="underline hover:text-white">Drafts</a> →
              &quot;Log performance&quot; on a posted item to start tracking.
            </>
          ) : (
            <>
              Nothing logged yet. Mark content as Posted, then use &quot;Log performance&quot; to
              record how it did — this panel turns those numbers into patterns.
            </>
          )}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Total views</p>
              <p className="text-xl font-semibold text-white mt-0.5">
                {compactNumber(perf.totalViews)}
              </p>
            </div>
            <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Total likes</p>
              <p className="text-xl font-semibold text-white mt-0.5">
                {compactNumber(perf.totalLikes)}
              </p>
            </div>
            <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Engagement</p>
              <p className="text-xl font-semibold text-white mt-0.5">
                {perf.avgEngagement}%
              </p>
            </div>
            <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Avg views/post</p>
              <p className="text-xl font-semibold text-white mt-0.5">
                {compactNumber(perf.avgViews)}
              </p>
            </div>
          </div>

          {perf.platforms.length > 1 && (
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">
                By platform
              </p>
              <div className="flex flex-wrap gap-2">
                {perf.platforms.map((p) => (
                  <span
                    key={p.platform}
                    className="text-xs px-2.5 py-1 bg-zinc-800 border border-zinc-700 rounded-full text-zinc-300"
                  >
                    {p.platform}: {compactNumber(p.views)} views · {p.posts} post
                    {p.posts === 1 ? "" : "s"}
                  </span>
                ))}
              </div>
            </div>
          )}

          {perf.best && (
            <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-green-400 mb-1">
                Best performer · {compactNumber(perf.best.views)} views
              </p>
              <p className="text-sm text-green-100 line-clamp-2">{perf.best.content}</p>
            </div>
          )}

          {perf.unloggedPosted > 0 && (
            <p className="text-xs text-zinc-500 mt-3">
              {perf.unloggedPosted} posted item{perf.unloggedPosted === 1 ? " has" : "s have"} no
              numbers yet — log them in Drafts to sharpen these patterns.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
