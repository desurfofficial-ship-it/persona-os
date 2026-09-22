/**
 * Performance metrics v2 — honest manual performance tracking.
 *
 * We do NOT have platform API access yet, so numbers are what the user
 * logs per posted item. A post can now be logged on MULTIPLE platforms
 * (same caption on X and LinkedIn performs differently), stored as
 * { entries: [...] }. Legacy single-object rows still parse.
 * Every function is pure and typed for unit testing.
 *
 * The metrics shapes on ContentDraft.metrics:
 *   v1: { platform, views, likes, comments, loggedAt }
 *   v2: { entries: [ { platform, views, likes, comments, loggedAt }, ... ] }
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

/**
 * Lenient count parser — creators paste numbers the way platforms show them:
 * "12,500", "1.2K", "3.4M", " 980 " all parse. Returns null when the string
 * holds no digits at all (so an untouched field can stay untouched).
 */
export function parseCount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^([\d.,]+)\s*(k|m|b)?$/);
  if (!m) return null;
  const numericPart = m[1].replace(/,/g, "");
  const n = Number(numericPart);
  if (!Number.isFinite(n) || n < 0) return null;
  const mult = m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : m[2] === "b" ? 1_000_000_000 : 1;
  return Math.round(n * mult);
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

/** Every logged platform entry for a draft — v2 rows, or v1 wrapped. */
export function metricEntries(raw: unknown): DraftMetrics[] {
  if (!raw || typeof raw !== "object") return [];
  const m = raw as Record<string, unknown>;
  if (Array.isArray(m.entries)) {
    return m.entries
      .map((e) => parseMetrics(e))
      .filter((e): e is DraftMetrics => e !== null);
  }
  const legacy = parseMetrics(m);
  return legacy ? [legacy] : [];
}

/** Does this draft have at least one logged entry? */
export function hasMetrics(raw: unknown): boolean {
  return metricEntries(raw).length > 0;
}

/**
 * Append (or replace same-platform) an entry, returning the v2 storage
 * shape. Replacing same-platform keeps one truth per platform per post.
 */
export function appendEntry(
  raw: unknown,
  entry: DraftMetrics
): { entries: DraftMetrics[] } {
  const rest = metricEntries(raw).filter((e) => e.platform !== entry.platform);
  return { entries: [...rest, entry].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)) };
}

export function computePerformance(
  drafts: MetricsDraft[],
  postedCount?: number
): PerformanceSummary {
  // Each (draft, platform-entry) pair is one observation: the same post
  // logged on X and LinkedIn counts once per platform.
  const observations = drafts
    .map((d) => metricEntries(d.metrics).map((metrics) => ({ draft: d, metrics })))
    .flat();

  const totalViews = observations.reduce((s, x) => s + x.metrics.views, 0);
  const totalLikes = observations.reduce((s, x) => s + x.metrics.likes, 0);
  const totalComments = observations.reduce((s, x) => s + x.metrics.comments, 0);

  const bestEntry = observations
    .filter((x) => x.metrics.views > 0)
    .sort((a, b) => b.metrics.views - a.metrics.views)[0];

  // Per-platform rollup, strongest first.
  const byPlatform = new Map<string, PlatformRollup>();
  for (const { metrics } of observations) {
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

  // loggedPosts counts drafts with at least one entry (not raw observations).
  const loggedDraftCount = drafts.filter((d) => metricEntries(d.metrics).length > 0).length;
  const knownPosted = typeof postedCount === "number" ? postedCount : drafts.length;

  return {
    loggedPosts: loggedDraftCount,
    unloggedPosted: Math.max(0, knownPosted - loggedDraftCount),
    totalViews,
    totalLikes,
    totalComments,
    avgViews: observations.length ? Math.round(totalViews / observations.length) : 0,
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
