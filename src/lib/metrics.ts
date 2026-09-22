/**
 * Performance metrics v1 — honest manual performance tracking.
 *
 * We do NOT have platform API access yet, so numbers are what the user
 * logs per posted item. This module does the math: totals, averages,
 * best/worst posts, per-platform breakdown. Every function is pure and
 * typed for unit testing.
 *
 * The metrics shape on ContentDraft.metrics:
 *   { platform: string, views: number, likes: number, comments: number, loggedAt: string }
 */

export interface DraftMetrics {
  platform: string;
  views: number;
  likes: number;
  comments: number;
  loggedAt: string;
}

export interface MetricsDraft {
  id: string;
  content: string;
  type: string;
  /** Raw JSON from the DB row — validated by parseMetrics. */
  metrics?: unknown;
}

export interface PlatformRollup {
  platform: string;
  posts: number;
  views: number;
  likes: number;
  avgViews: number;
}

export interface PerformanceSummary {
  loggedPosts: number;
  unloggedPosted: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  avgViews: number;
  avgEngagement: number; // (likes + comments) / views, as a percentage
  best: { id: string; content: string; views: number } | null;
  platforms: PlatformRollup[];
}

export function parseMetrics(raw: unknown): DraftMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const platform = String(m.platform || "").trim();
  if (!platform) return null;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };
  return {
    platform,
    views: num(m.views),
    likes: num(m.likes),
    comments: num(m.comments),
    loggedAt: String(m.loggedAt || new Date().toISOString()),
  };
}

export function computePerformance(
  drafts: MetricsDraft[],
  postedCount?: number
): PerformanceSummary {
  const logged = drafts
    .map((d) => ({ draft: d, metrics: parseMetrics(d.metrics) }))
    .filter((x): x is { draft: MetricsDraft; metrics: DraftMetrics } => x.metrics !== null);

  const totalViews = logged.reduce((s, x) => s + x.metrics.views, 0);
  const totalLikes = logged.reduce((s, x) => s + x.metrics.likes, 0);
  const totalComments = logged.reduce((s, x) => s + x.metrics.comments, 0);

  const bestEntry = logged
    .filter((x) => x.metrics.views > 0)
    .sort((a, b) => b.metrics.views - a.metrics.views)[0];

  // Per-platform rollup, strongest first.
  const byPlatform = new Map<string, PlatformRollup>();
  for (const { metrics } of logged) {
    const cur = byPlatform.get(metrics.platform) || {
      platform: metrics.platform,
      posts: 0,
      views: 0,
      likes: 0,
      avgViews: 0,
    };
    cur.posts++;
    cur.views += metrics.views;
    cur.likes += metrics.likes;
    byPlatform.set(metrics.platform, cur);
  }
  const platforms = Array.from(byPlatform.values())
    .map((p) => ({ ...p, avgViews: p.posts ? Math.round(p.views / p.posts) : 0 }))
    .sort((a, b) => b.views - a.views);

  const knownPosted = typeof postedCount === "number" ? postedCount : drafts.length;

  return {
    loggedPosts: logged.length,
    unloggedPosted: Math.max(0, knownPosted - logged.length),
    totalViews,
    totalLikes,
    totalComments,
    avgViews: logged.length ? Math.round(totalViews / logged.length) : 0,
    avgEngagement:
      totalViews > 0 ? Math.round(((totalLikes + totalComments) / totalViews) * 1000) / 10 : 0,
    best: bestEntry
      ? {
          id: bestEntry.draft.id,
          content: bestEntry.draft.content.slice(0, 140),
          views: bestEntry.metrics.views,
        }
      : null,
    platforms,
  };
}

/** Compact display: 1234 -> 1.2K, 2711000 -> 2.7M. */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}
