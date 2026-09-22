/**
 * Pattern insights v1 — honest, small, computed entirely from drafts the
 * user already has. No fake engagement numbers: everything here is derived
 * from what the user actually wrote and marked posted.
 *
 *  - topThemes: recurring words/phrases across POSTED content
 *  - bestDay: weekday with the most posts marked "Posted"
 *  - postedRatio: posted / total drafts (the follow-through metric)
 *  - thisWeekVsLast: cadence trend
 *  - longestStreak: best consecutive-day run
 */

import { startOfWeek } from "@/lib/momentum";

export interface InsightDraft {
  id: string;
  content: string;
  posted?: boolean;
  created_at: string;
}

export interface Theme {
  label: string;
  count: number;
  example: string;
}

export interface Insights {
  topThemes: Theme[];
  bestDay: { day: string; count: number } | null;
  postedRatio: { posted: number; total: number } | null;
  thisWeekDrafts: number;
  lastWeekDrafts: number;
  longestStreak: number;
}

const STOP = new Set(
  ("a about after all also am an and any are as at be because been being but by can cant come could day did do does doing dont down even every first for from get go going good got had has have he her here him his how i if in into is it its just keep know like ll make me more most much my need never new no not now of off on one only or other our out over own people re say see she should so some still such take than that the their them then there these they thing things think this those time to too two up us use very want was way we well went were what when where which while who why will with without work would yes yet you your youre").split(
    /\s+/
  )
);

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractThemes(posted: InsightDraft[]): Theme[] {
  const freq = new Map<string, { count: number; example: string }>();

  for (const d of posted) {
    const words = d.content
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w));

    const uniq = new Set(words);
    for (const w of uniq) {
      const cur = freq.get(w);
      if (cur) cur.count++;
      else freq.set(w, { count: 1, example: d.content });
    }
  }

  return Array.from(freq.entries())
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([label, v]) => ({ label, count: v.count, example: v.example }));
}

function longestStreakOf(drafts: InsightDraft[]): number {
  const days = new Set(drafts.map((d) => dayKey(new Date(d.created_at))));
  const sorted = Array.from(days).sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;

  for (const k of sorted) {
    const d = new Date(`${k}T00:00:00`);
    if (prev && (d.getTime() - prev.getTime()) / 86400000 === 1) run++;
    else run = 1;
    prev = d;
    best = Math.max(best, run);
  }
  return best;
}

export function computeInsights(drafts: InsightDraft[]): Insights {
  const posted = drafts.filter((d) => d.posted);

  const now = new Date();
  const weekStart = startOfWeek(now);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);

  let thisWeekDrafts = 0;
  let lastWeekDrafts = 0;
  for (const d of drafts) {
    const c = new Date(d.created_at);
    if (c >= weekStart) thisWeekDrafts++;
    else if (c >= lastWeekStart) lastWeekDrafts++;
  }

  // Best weekday by posted count
  const byWeekday = new Map<number, number>();
  for (const d of posted) {
    const wd = new Date(d.created_at).getDay();
    byWeekday.set(wd, (byWeekday.get(wd) || 0) + 1);
  }
  let bestDay: { day: string; count: number } | null = null;
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (const [wd, count] of byWeekday) {
    if (!bestDay || count > bestDay.count) bestDay = { day: dayNames[wd], count };
  }

  return {
    topThemes: extractThemes(posted),
    bestDay: posted.length >= 2 ? bestDay : null,
    postedRatio: drafts.length > 0 ? { posted: posted.length, total: drafts.length } : null,
    thisWeekDrafts,
    lastWeekDrafts,
    longestStreak: longestStreakOf(drafts),
  };
}

/** Days since the user last marked something posted (null = never posted). */
export function daysSinceLastPost(drafts: InsightDraft[]): number | null {
  const postedDates = drafts
    .filter((d) => d.posted)
    .map((d) => new Date(d.created_at).getTime());
  if (postedDates.length === 0) return null;
  const last = Math.max(...postedDates);
  const diffMs = Date.now() - last;
  return Math.floor(diffMs / 86400000);
}
