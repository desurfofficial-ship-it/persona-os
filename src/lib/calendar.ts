/**
 * Week calendar for the dashboard: one row, Mon–Sun, showing planned
 * (amber), drafted (white) and posted (green) activity per day, plus the
 * planning helpers used by the drafts page.
 */

import { startOfWeek } from "@/lib/momentum";

export interface CalendarDraft {
  id: string;
  content: string;
  posted?: boolean;
  created_at: string;
  planned_for?: string | null;
}

export interface DayCell {
  date: Date;
  key: string; // yyyy-mm-dd (local)
  label: string; // Mon, Tue...
  dayNum: number;
  isToday: boolean;
  isFuture: boolean;
  drafts: CalendarDraft[]; // created this day
  posted: CalendarDraft[]; // created this day AND marked posted
  planned: CalendarDraft[]; // planned_for this day
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function keyFor(d: Date): string {
  return dayKey(d);
}

export function buildWeek(drafts: CalendarDraft[], ref: Date = new Date()): DayCell[] {
  const monday = startOfWeek(ref);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cells: DayCell[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const key = dayKey(date);

    const dayDrafts = drafts.filter((d) => dayKey(new Date(d.created_at)) === key);
    const planned = drafts.filter((d) => d.planned_for && dayKey(new Date(d.planned_for)) === key);

    cells.push({
      date,
      key,
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      dayNum: date.getDate(),
      isToday: date.getTime() === today.getTime(),
      isFuture: date.getTime() > today.getTime(),
      drafts: dayDrafts,
      posted: dayDrafts.filter((d) => d.posted),
      planned,
    });
  }
  return cells;
}

/** Next 7 days (starting today) for the "plan for a day" picker. */
export function nextSevenDays(ref: Date = new Date()): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ref);
    d.setDate(ref.getDate() + i);
    out.push({
      key: dayKey(d),
      label:
        i === 0
          ? "Today"
          : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    });
  }
  return out;
}

/**
 * The posting queue: planned-but-unposted drafts that are due today or
 * overdue. Sorted oldest deadline first — overdue items lead the list.
 */
export function dueQueue(drafts: CalendarDraft[], ref: Date = new Date()): CalendarDraft[] {
  const today = new Date(ref);
  today.setHours(23, 59, 59, 999);
  return drafts
    .filter((d) => !d.posted && d.planned_for && new Date(d.planned_for) <= today)
    .sort((a, b) => new Date(a.planned_for!).getTime() - new Date(b.planned_for!).getTime());
}

/** True when the planned day is strictly before today (missed). */
export function isOverdue(plannedFor: string | null | undefined, ref: Date = new Date()): boolean {
  if (!plannedFor) return false;
  const start = new Date(ref);
  start.setHours(0, 0, 0, 0);
  return new Date(plannedFor) < start;
}
