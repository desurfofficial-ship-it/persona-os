"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Draft {
  id: string;
  type: string;
  content: string;
  posted: boolean | null;
  created_at: string;
  planned_for?: string | null;
  persona_id: string;
  personas?: { name: string } | null;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Prefer planned_for for placement; fall back to created_at. */
function placementDate(d: Draft): Date {
  if (d.planned_for) {
    const p = new Date(d.planned_for);
    if (!Number.isNaN(p.getTime())) return p;
  }
  return new Date(d.created_at);
}

export default function CalendarPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(() => {
    const s = startOfWeek(new Date());
    return addDays(s, weekOffset * 7);
  }, [weekOffset]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const from = addDays(weekStart, -1);
      const to = addDays(weekStart, 8);
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      // Pull anything created or planned in this window (series uses planned_for).
      const [createdRes, plannedRes] = await Promise.all([
        supabase
          .from("content_drafts")
          .select("id, type, content, posted, created_at, planned_for, persona_id, personas(name)")
          .eq("user_id", user.id)
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: true }),
        supabase
          .from("content_drafts")
          .select("id, type, content, posted, created_at, planned_for, persona_id, personas(name)")
          .eq("user_id", user.id)
          .not("planned_for", "is", null)
          .gte("planned_for", fromIso)
          .lte("planned_for", toIso)
          .order("planned_for", { ascending: true }),
      ]);

      const byId = new Map<string, Draft>();
      for (const row of [...(createdRes.data || []), ...(plannedRes.data || [])]) {
        byId.set(row.id, row as Draft);
      }
      setDrafts([...byId.values()]);
      setLoading(false);
    };
    load();
  }, [router, weekStart]);

  const togglePosted = async (id: string, current: boolean | null) => {
    const next = !current;
    const { error } = await supabase.from("content_drafts").update({ posted: next }).eq("id", id);
    if (!error) {
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, posted: next } : d)));
    }
  };

  const byDay = (day: Date) =>
    drafts
      .filter((d) => sameDay(placementDate(d), day))
      .sort((a, b) => placementDate(a).getTime() - placementDate(b).getTime());

  const weekLabel = `${weekStart.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-400">Loading...</div>
    );
  }

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
            <div>
              <h1 className="text-2xl font-bold">Calendar</h1>
              <p className="text-zinc-400 text-sm mt-1">
                Drafts and series posts by plan date (or created date).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWeekOffset((w) => w - 1)}
                className="text-xs px-3 py-1.5 border border-zinc-700 rounded-lg hover:bg-zinc-800"
              >
                ← Prev
              </button>
              <span className="text-sm text-zinc-300 min-w-[140px] text-center">{weekLabel}</span>
              <button
                onClick={() => setWeekOffset((w) => w + 1)}
                className="text-xs px-3 py-1.5 border border-zinc-700 rounded-lg hover:bg-zinc-800"
              >
                Next →
              </button>
              {weekOffset !== 0 && (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="text-xs px-3 py-1.5 border border-zinc-700 rounded-lg hover:bg-zinc-800"
                >
                  This week
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-[10px] text-zinc-500 mb-4">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500/80" /> Planned
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-zinc-400" /> Draft
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500/80" /> Posted
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {days.map((day) => {
            const items = byDay(day);
            const isToday = sameDay(day, new Date());
            return (
              <div
                key={dayKey(day)}
                className={`rounded-xl border p-3 min-h-[140px] ${
                  isToday ? "border-white/40 bg-zinc-900/80" : "border-zinc-800 bg-zinc-950"
                }`}
              >
                <div className="text-xs text-zinc-500 mb-2">
                  {day.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                  {isToday && (
                    <span className="ml-1 text-emerald-400/90">· today</span>
                  )}
                </div>
                <div className="space-y-2">
                  {items.length === 0 && <p className="text-xs text-zinc-600">—</p>}
                  {items.map((d) => {
                    const planned = Boolean(d.planned_for);
                    return (
                      <div
                        key={d.id}
                        className={`rounded-lg p-2 text-xs border ${
                          d.posted
                            ? "bg-green-950/30 border-green-800/50"
                            : planned
                              ? "bg-amber-950/25 border-amber-800/40"
                              : "bg-zinc-800/80 border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="uppercase text-[10px] text-zinc-500">
                            {d.type.replace("_", " ")}
                            {planned && !d.posted ? " · plan" : ""}
                          </span>
                          <button
                            onClick={() => togglePosted(d.id, d.posted)}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              d.posted
                                ? "bg-green-900/50 text-green-300"
                                : "bg-zinc-700 text-zinc-400"
                            }`}
                          >
                            {d.posted ? "Posted" : "Draft"}
                          </button>
                        </div>
                        <p className="text-zinc-300 line-clamp-3">{d.content}</p>
                        <p className="text-zinc-600 mt-1">
                          {(d.personas as { name?: string } | null)?.name || ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/dashboard/generate"
            className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium"
          >
            Generate
          </a>
          <a
            href="/dashboard/series"
            className="px-4 py-2 border border-zinc-700 rounded-lg text-sm"
          >
            Series planner
          </a>
          <a
            href="/dashboard/drafts"
            className="px-4 py-2 border border-zinc-700 rounded-lg text-sm"
          >
            All drafts
          </a>
        </div>
      </div>
    </div>
  );
}
