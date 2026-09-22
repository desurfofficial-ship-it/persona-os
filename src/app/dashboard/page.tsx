"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { computeMomentum, type MomentumStats } from "@/lib/momentum";

interface Draft {
  id: string;
  type: string;
  content: string;
  created_at: string;
  posted?: boolean;
  personas?: { name: string };
}

export default function DashboardPage() {
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [recentDrafts, setRecentDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [momentum, setMomentum] = useState<MomentumStats | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

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
          .select("id, type, content, created_at, posted, personas(name)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(90),
      ]);

      const drafts = (draftsRes.data || []) as Draft[];
      setPersonas(personasRes.data || []);
      setRecentDrafts(drafts.slice(0, 5));
      setMomentum(computeMomentum(drafts));
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
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-semibold">Your Personas</h2>
                <a
                  href="/dashboard/personas/new"
                  className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
                >
                  + New
                </a>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {personas.map((persona) => (
                  <div
                    key={persona.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition group relative"
                  >
                    <a href={`/dashboard/personas/${persona.id}`} className="block">
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
