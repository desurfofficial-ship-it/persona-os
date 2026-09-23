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

      const from = addDays(weekStart, -1).toISOString();
      const to = addDays(weekStart, 8).toISOString();

      const { data } = await supabase
        .from("content_drafts")
        .select("id, type, content, posted, created_at, persona_id, personas(name)")
        .eq("user_id", user.id)
        .gte("created_at", from)
        .lte("created_at", to)
        .order("created_at", { ascending: true });

      setDrafts((data as Draft[]) || []);
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
    drafts.filter((d) => sameDay(new Date(d.created_at), day));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-400">Loading...</div>
    );
  }

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
              ← Dashboard
            </a>
            <h1 className="text-2xl font-bold">Week</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              className="px-3 py-1.5 border border-zinc-700 rounded-lg text-sm hover:bg-zinc-800"
            >
              ← Prev
            </button>
            <button
              onClick={() => setWeekOffset(0)}
              className="px-3 py-1.5 border border-zinc-700 rounded-lg text-sm hover:bg-zinc-800"
            >
              This week
            </button>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              className="px-3 py-1.5 border border-zinc-700 rounded-lg text-sm hover:bg-zinc-800"
            >
              Next →
            </button>
          </div>
        </div>

        <p className="text-sm text-zinc-500 mb-6">
          Drafts by day created. Toggle Posted so generation avoids them next time.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {days.map((day) => {
            const items = byDay(day);
            const isToday = sameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                className={`bg-zinc-900 border rounded-xl p-3 min-h-[160px] ${
                  isToday ? "border-white/40" : "border-zinc-800"
                }`}
              >
                <div className="text-xs text-zinc-500 mb-2">
                  {day.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div className="space-y-2">
                  {items.length === 0 && (
                    <p className="text-xs text-zinc-600">—</p>
                  )}
                  {items.map((d) => (
                    <div
                      key={d.id}
                      className="bg-zinc-800/80 rounded-lg p-2 text-xs border border-zinc-700"
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="uppercase text-[10px] text-zinc-500">
                          {d.type.replace("_", " ")}
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
                        {(d.personas as any)?.name || ""}
                      </p>
                    </div>
                  ))}
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
