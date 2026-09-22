"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { computeMomentum, type MomentumStats } from "@/lib/momentum";
import { buildWeek, dueQueue, isOverdue, type DayCell, type CalendarDraft } from "@/lib/calendar";
import { computeInsights, daysSinceLastPost, type InsightDraft, type Insights } from "@/lib/insights";
import { getActivePersonaId, setActivePersonaId } from "@/lib/activePersona";

interface Draft {
  id: string;
  type: string;
  content: string;
  created_at: string;
  posted?: boolean;
  planned_for?: string | null;
  personas?: { name: string };
}

export default function DashboardPage() {
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [recentDrafts, setRecentDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [momentum, setMomentum] = useState<MomentumStats | null>(null);
  const [allDrafts, setAllDrafts] = useState<Draft[]>([]);
  const [week, setWeek] = useState<DayCell[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [activePersonaId, setActiveId] = useState<string | null>(null);
  const [daysSince, setDaysSince] = useState<number | null>(null);
  const [showPatterns, setShowPatterns] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const due = dueQueue(allDrafts as CalendarDraft[]);

  const markPostedFromQueue = async (draft: Draft) => {
    setAllDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, posted: true } : d)));
    setRecentDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, posted: true } : d)));
    const { error } = await supabase
      .from("content_drafts")
      .update({ posted: true })
      .eq("id", draft.id);
    if (error) {
      setAllDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, posted: false } : d)));
      alert(error.message);
    }
  };

  const snoozeFromQueue = async (draft: Draft) => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    const iso = next.toISOString();
    setAllDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, planned_for: iso } : d)));
    const { error } = await supabase
      .from("content_drafts")
      .update({ planned_for: iso })
      .eq("id", draft.id);
    if (error) {
      setAllDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, planned_for: draft.planned_for } : d))
      );
      alert(error.message);
    }
  };

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUserEmail(user.email ?? null);

      const [personasRes, draftsRes] = await Promise.all([
        supabase
          .from("personas")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("content_drafts")
          .select("id, type, content, created_at, posted, planned_for, personas(name)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(90),
      ]);

      const drafts = (draftsRes.data || []) as Draft[];
      setPersonas(personasRes.data || []);
      setAllDrafts(drafts);
      setRecentDrafts(drafts.slice(0, 5));
      setMomentum(computeMomentum(drafts));
      setWeek(buildWeek(drafts as CalendarDraft[]));
      setInsights(computeInsights(drafts as InsightDraft[]));
      setDaysSince(daysSinceLastPost(drafts as InsightDraft[]));
      setActiveId(getActivePersonaId());
      setLoading(false);
    };

    load();
  }, [router]);

  // Close "More" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleSetActive = (id: string) => {
    setActivePersonaId(id);
    setActiveId(id);
  };

  const handleDeletePersona = async (id: string, name: string) => {
    if (!confirm(`Delete persona "${name}"? This cannot be undone.`)) return;

    const { error } = await supabase.from("personas").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    setPersonas((prev) => prev.filter((p) => p.id !== id));
  };

  const handleDuplicate = async (persona: Persona) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("personas").insert({
      user_id: user.id,
      name: `${persona.name} (Copy)`,
      backstory: persona.backstory,
      tone_of_voice: persona.tone_of_voice,
      lifestyle_pillars: persona.lifestyle_pillars,
      content_rules: persona.content_rules,
      forbidden_topics: persona.forbidden_topics,
    });

    if (error) {
      alert(error.message);
      return;
    }

    const { data } = await supabase
      .from("personas")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    setPersonas(data || []);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  const firstRun = personas.length === 0;
  const goalPct = momentum && momentum.goal > 0
    ? Math.min(100, Math.round((momentum.draftsThisWeek / momentum.goal) * 100))
    : 0;

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 sm:mb-10">
          <div>
            <h1 className="text-3xl font-bold">Persona OS</h1>
            {userEmail && <p className="text-sm text-zinc-500 mt-1">{userEmail}</p>}
          </div>
          <nav className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm">
            <a href="/dashboard" className="text-white font-medium">
              Dashboard
            </a>
            <a href="/dashboard/generate" className="text-zinc-400 hover:text-white">
              Generate
            </a>
            <a href="/dashboard/drafts" className="text-zinc-400 hover:text-white">
              Drafts
            </a>

            {/* Everything else lives under More — one obvious home base */}
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setMoreOpen((o) => !o)}
                className="text-zinc-400 hover:text-white flex items-center gap-1"
                aria-expanded={moreOpen}
                aria-haspopup="true"
              >
                More <span className="text-[10px]">▼</span>
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl py-2 z-50">
                  {[
                    ["Series", "/dashboard/series"],
                    ["Ideas", "/dashboard/ideas"],
                    ["Check", "/dashboard/check"],
                    ["Vault", "/dashboard/vault"],
                    ["New Persona", "/dashboard/personas/new"],
                    ["Trust & Data", "/dashboard/trust"],
                  ].map(([label, href]) => (
                    <a
                      key={href}
                      href={href}
                      onClick={() => setMoreOpen(false)}
                      className="block px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
                    >
                      {label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <button onClick={handleLogout} className="text-zinc-400 hover:text-white">
              Logout
            </button>
          </nav>
        </header>

        {/* First-run: one obvious "Start here" */}
        {firstRun && (
          <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-700 rounded-2xl p-8 sm:p-12 text-center mb-12">
            <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Start here</p>
            <h2 className="text-2xl sm:text-3xl font-bold mb-3 max-w-xl mx-auto">
              Paste a few of your best posts. Get a persona that sounds exactly like you.
            </h2>
            <p className="text-zinc-400 text-sm mb-8 max-w-md mx-auto">
              Three steps, about a minute: paste posts → persona created → generate your
              first content.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
              {[
                "Paste your posts",
                "Persona created",
                "First content generated",
              ].map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex items-center gap-2 text-sm text-zinc-300">
                    <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center text-xs">
                      {i + 1}
                    </span>
                    {step}
                  </span>
                  {i < 2 && <span className="hidden sm:inline text-zinc-600">→</span>}
                </div>
              ))}
            </div>
            <a
              href="/dashboard/start"
              className="inline-block px-8 py-3.5 min-h-[52px] bg-white text-black rounded-xl font-semibold text-base hover:bg-zinc-200"
            >
              Start here →
            </a>
            <div className="mt-6">
              <a
                href="/dashboard/personas/new"
                className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
              >
                or build a persona from scratch
              </a>
            </div>
          </div>
        )}

        {/* Weekly momentum */}
        {!firstRun && momentum && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-zinc-300">
                  <span className="font-semibold text-white">This week:</span>{" "}
                  {momentum.draftsThisWeek} draft{momentum.draftsThisWeek === 1 ? "" : "s"} ·{" "}
                  {momentum.postedThisWeek} posted
                  {momentum.streakDays > 0 && (
                    <span className="ml-3 text-amber-400" title={`${momentum.streakDays}-day streak`}>
                      🔥 {momentum.streakDays}-day streak
                    </span>
                  )}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Weekly goal: {momentum.draftsThisWeek}/{momentum.goal} drafts
                </p>
              </div>
              <div className="flex items-center gap-3 flex-1 min-w-[180px] max-w-xs">
                <div className="h-2 flex-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      goalPct >= 100 ? "bg-green-500" : "bg-white"
                    }`}
                    style={{ width: `${goalPct}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-400 w-10 text-right">{goalPct}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Welcome back: absence as content, not guilt */}
        {!firstRun && personas.length > 0 && daysSince !== null && daysSince >= 4 && (
          <div className="bg-gradient-to-r from-amber-950/40 to-zinc-900 border border-amber-800/50 rounded-xl p-5 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="font-medium text-amber-200">
                  Welcome back — {daysSince} days since your last post
                </p>
                <p className="text-sm text-zinc-400 mt-1">
                  The gap IS the content. Your audience relates to real cadence, not a machine.
                </p>
              </div>
              <a
                href={`/dashboard/generate?persona=${activePersonaId || personas[0].id}&welcome=1`}
                className="shrink-0 min-h-[48px] px-5 flex items-center bg-amber-200 text-amber-950 rounded-lg text-sm font-semibold hover:bg-amber-100"
              >
                Write the come-back post →
              </a>
            </div>
          </div>
        )}

        {/* Posting queue: due today + overdue planned drafts */}
        {!firstRun && due.length > 0 && (
          <div className="bg-zinc-900 border border-amber-700/50 rounded-xl p-5 mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">
                Due today
                {due.some((d) => isOverdue(d.planned_for)) && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-red-400">
                    includes overdue
                  </span>
                )}
              </h2>
              <span className="text-xs text-zinc-500">{due.length} queued</span>
            </div>
            <div className="space-y-3">
              {due.slice(0, 4).map((d) => {
                const draft = d as unknown as Draft;
                return (
                  <div
                    key={d.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 bg-zinc-950/60 border border-zinc-800 rounded-lg p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-500 mb-0.5">
                        {(draft.personas as any)?.name || "Persona"} ·{" "}
                        {isOverdue(d.planned_for) ? (
                          <span className="text-red-400">
                            was planned {new Date(d.planned_for!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                          </span>
                        ) : (
                          <span className="text-amber-300">planned for today</span>
                        )}
                      </p>
                      <p className="text-sm text-zinc-200 line-clamp-1">{d.content}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => markPostedFromQueue(draft)}
                        className="min-h-[40px] px-4 bg-white text-black rounded-lg text-xs font-semibold hover:bg-zinc-200"
                      >
                        ✓ Mark posted
                      </button>
                      <button
                        onClick={() => snoozeFromQueue(draft)}
                        title="Push to tomorrow"
                        className="min-h-[40px] px-3 border border-zinc-700 rounded-lg text-xs hover:bg-zinc-800"
                      >
                        Tomorrow
                      </button>
                    </div>
                  </div>
                );
              })}
              {due.length > 4 && (
                <p className="text-xs text-zinc-500">
                  +{due.length - 4} more in the queue —{" "}
                  <a href="/dashboard/drafts" className="underline hover:text-white">
                    open Drafts
                  </a>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Week calendar: this week at a glance, Mon–Sun */}
        {!firstRun && week.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium">This week</h2>
              <p className="text-xs text-zinc-500">
                <span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1 align-middle" />
                posted
                <span className="inline-block w-2 h-2 rounded-full bg-white ml-3 mr-1 align-middle" />
                drafted
                <span className="inline-block w-2 h-2 border border-amber-400 rounded-full ml-3 mr-1 align-middle" />
                planned
              </p>
            </div>
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {week.map((day) => (
                <div
                  key={day.key}
                  title={
                    [
                      ...day.planned.map((d) => `Planned: ${d.content.slice(0, 60)}`),
                      ...day.posted.map((d) => `Posted: ${d.content.slice(0, 60)}`),
                      ...day.drafts
                        .filter((d) => !d.posted)
                        .map((d) => `Draft: ${d.content.slice(0, 60)}`),
                    ].join("\n") || undefined
                  }
                  className={`rounded-lg border p-1.5 sm:p-2.5 text-center ${
                    day.isToday ? "border-zinc-500 bg-zinc-800/60" : "border-zinc-800"
                  }`}
                >
                  <p className="text-[10px] text-zinc-500 uppercase hidden sm:block">{day.label}</p>
                  <p className={`text-xs sm:text-sm ${day.isToday ? "text-white font-semibold" : "text-zinc-400"}`}>
                    {day.dayNum}
                  </p>
                  <div className="flex items-center justify-center gap-1 mt-1.5 h-2">
                    {day.planned.length > 0 && (
                      <span className="w-2 h-2 rounded-full border border-amber-400" title={`${day.planned.length} planned`} />
                    )}
                    {day.posted.length > 0 && (
                      <span className="w-2 h-2 rounded-full bg-green-400" title={`${day.posted.length} posted`} />
                    )}
                    {day.drafts.length - day.posted.length > 0 && (
                      <span className="w-2 h-2 rounded-full bg-white" title={`${day.drafts.length - day.posted.length} drafted`} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!firstRun && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-12">
              <a
                href="/dashboard/generate"
                className="bg-white text-black rounded-xl p-4 hover:bg-zinc-200 transition"
              >
                <h2 className="font-semibold mb-1 text-sm sm:text-base">Generate</h2>
                <p className="text-zinc-500 text-xs">AI content</p>
              </a>
              <a
                href="/dashboard/series"
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition"
              >
                <h2 className="font-semibold mb-1 text-sm sm:text-base">Series</h2>
                <p className="text-zinc-400 text-xs">Multi-day plans</p>
              </a>
              <a
                href="/dashboard/ideas"
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition"
              >
                <h2 className="font-semibold mb-1 text-sm sm:text-base">Ideas</h2>
                <p className="text-zinc-400 text-xs">Topic lists</p>
              </a>
              <a
                href="/dashboard/check"
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition"
              >
                <h2 className="font-semibold mb-1 text-sm sm:text-base">Check</h2>
                <p className="text-zinc-400 text-xs">Consistency</p>
              </a>
              <a
                href="/dashboard/personas/new"
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition"
              >
                <h2 className="font-semibold mb-1 text-sm sm:text-base">New Persona</h2>
                <p className="text-zinc-400 text-xs">Create</p>
              </a>
            </div>

            <div className="mb-12">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <h2 className="text-xl font-semibold">Your Personas</h2>
                {personas.length > 1 && (
                  <label className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="hidden sm:inline">Active voice:</span>
                    <select
                      value={activePersonaId || ""}
                      onChange={(e) => handleSetActive(e.target.value)}
                      className="px-3 py-1.5 min-h-[40px] bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
                    >
                      {!activePersonaId && <option value="">Choose…</option>}
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <a
                  href="/dashboard/personas/new"
                  className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
                >
                  + New
                </a>
              </div>

              {personas.length > 3 && (
                <p className="text-xs text-amber-400/80 mb-4">
                  Heads up: you have {personas.length} personas. The most consistent creators run
                  one to three — more voices means more drift.
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {personas.map((persona) => (
                  <div
                    key={persona.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition group relative"
                  >
                    <a href={`/dashboard/personas/${persona.id}`} className="block">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          onClick={(e) => {
                            if (activePersonaId !== persona.id) {
                              e.preventDefault();
                              e.stopPropagation();
                              handleSetActive(persona.id);
                            }
                          }}
                          role={activePersonaId === persona.id ? undefined : "button"}
                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                            activePersonaId === persona.id
                              ? "bg-green-500/15 text-green-300 border border-green-700/60"
                              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-white cursor-pointer"
                          }`}
                        >
                          {activePersonaId === persona.id ? "● Active voice" : "Set active"}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold mb-2 pr-20">{persona.name}</h3>
                      <p className="text-sm text-zinc-400 line-clamp-3 mb-3">
                        {persona.backstory || "No backstory."}
                      </p>
                      {persona.tone_of_voice && (
                        <p className="text-xs text-zinc-500 mb-2">Tone: {persona.tone_of_voice}</p>
                      )}
                      {persona.lifestyle_pillars?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {persona.lifestyle_pillars.slice(0, 3).map((pillar) => (
                            <span
                              key={pillar}
                              className="text-xs px-2 py-0.5 bg-zinc-800 rounded-full text-zinc-300"
                            >
                              {pillar}
                            </span>
                          ))}
                        </div>
                      )}
                    </a>
                    <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => handleDuplicate(persona)}
                        className="text-xs text-zinc-400 hover:text-white"
                      >
                        Duplicate
                      </button>
                      <button
                        onClick={() => handleDeletePersona(persona.id, persona.name)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {recentDrafts.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold">Patterns (from your real activity)</h2>
              <button
                onClick={() => setShowPatterns((s) => !s)}
                className="text-sm text-zinc-400 hover:text-white"
              >
                {showPatterns ? "Hide" : "Show"} →
              </button>
            </div>

            {showPatterns && insights && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                  <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Follow-through</p>
                  {insights.postedRatio ? (
                    <p className="text-sm text-zinc-300">
                      <span className="text-2xl font-bold text-white">
                        {Math.round((insights.postedRatio.posted / insights.postedRatio.total) * 100)}%
                      </span>{" "}
                      of your {insights.postedRatio.total} recent drafts got posted
                      ({insights.postedRatio.posted}). Drafting is easy — posting is the habit
                      that pays.
                    </p>
                  ) : (
                    <p className="text-sm text-zinc-500">No drafts yet.</p>
                  )}
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                  <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Cadence</p>
                  <p className="text-sm text-zinc-300">
                    {insights.thisWeekDrafts} drafts this week vs {insights.lastWeekDrafts} last
                    week
                    {insights.thisWeekDrafts > insights.lastWeekDrafts
                      ? " — trending up."
                      : insights.thisWeekDrafts < insights.lastWeekDrafts
                        ? " — dip week. Normal, restart today."
                        : " — steady."}
                  </p>
                  {insights.longestStreak > 1 && (
                    <p className="text-xs text-zinc-500 mt-2">
                      Longest daily run: {insights.longestStreak} days.
                    </p>
                  )}
                </div>

                {insights.bestDay && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                    <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Best day</p>
                    <p className="text-sm text-zinc-300">
                      You post most on{" "}
                      <span className="text-white font-semibold">{insights.bestDay.day}s</span> (
                      {insights.bestDay.count} posts). Worth protecting that slot.
                    </p>
                  </div>
                )}

                {insights.topThemes.length > 0 && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                    <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
                      What you keep coming back to
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {insights.topThemes.map((t) => (
                        <span
                          key={t.label}
                          className="text-xs px-2.5 py-1 bg-zinc-800 rounded-full text-zinc-300"
                          title={t.example.slice(0, 120)}
                        >
                          {t.label} ×{t.count}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500 mt-3">
                      Recurring themes in your POSTED content — your audience shows up for these.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {recentDrafts.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold">Recent Drafts</h2>
              <a href="/dashboard/drafts" className="text-sm text-zinc-400 hover:text-white">
                View all →
              </a>
            </div>
            <div className="space-y-3">
              {recentDrafts.map((draft) => (
                <div key={draft.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="uppercase text-xs tracking-wide text-zinc-500">
                        {draft.type.replace("_", " ")}
                      </span>
                      <span className="text-zinc-600">•</span>
                      <span className="text-zinc-400">
                        {(draft.personas as any)?.name || "Unknown"}
                      </span>
                      {draft.posted && (
                        <span className="text-xs px-1.5 py-0.5 bg-green-900/40 text-green-300 rounded">
                          Posted
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-600">
                      {new Date(draft.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 line-clamp-2">{draft.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
