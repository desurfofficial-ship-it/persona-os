/**
 * Weekly momentum stats for the dashboard:
 * "This week: X drafts · Y posted" + a light daily streak + weekly goal.
 */

export interface MomentumDraft {
  id: string;
  created_at: string;
  posted?: boolean;
}

export interface MomentumStats {
  draftsThisWeek: number;
  postedThisWeek: number;
  streakDays: number;
  goal: number;
}

const GOAL_KEY = "persona-os-weekly-goal";
export const DEFAULT_WEEKLY_GOAL = 5;

export function getWeeklyGoal(): number {
  if (typeof window === "undefined") return DEFAULT_WEEKLY_GOAL;
  const raw = window.localStorage.getItem(GOAL_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WEEKLY_GOAL;
}

export function setWeeklyGoal(goal: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GOAL_KEY, String(goal));
}

/** Monday 00:00 of the week containing `ref` (local time). */
export function startOfWeek(ref: Date = new Date()): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function computeMomentum(drafts: MomentumDraft[]): MomentumStats {
  const now = new Date();
  const weekStart = startOfWeek(now);

  let draftsThisWeek = 0;
  let postedThisWeek = 0;
  const activeDays = new Set<string>();

  for (const d of drafts) {
    const created = new Date(d.created_at);
    if (created >= weekStart) {
      draftsThisWeek++;
      if (d.posted) postedThisWeek++;
    }
    activeDays.add(dayKey(created));
  }

  // Streak: consecutive days with at least one draft, ending today.
  // Today not yet active is fine — the streak survives if yesterday was.
  let streakDays = 0;
  const cursor = new Date(now);
  if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(dayKey(cursor))) {
    streakDays++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { draftsThisWeek, postedThisWeek, streakDays, goal: getWeeklyGoal() };
}
