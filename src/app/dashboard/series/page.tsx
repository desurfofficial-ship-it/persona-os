"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, authedFetch } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

function SeriesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("persona");

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [theme, setTheme] = useState("");
  const [days, setDays] = useState(5);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avoidContent, setAvoidContent] = useState<string[]>([]);
  const [workedContent, setWorkedContent] = useState<string[]>([]);
  const [floppedContent, setFloppedContent] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data } = await supabase
        .from("personas")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      setPersonas(data || []);
      if (preselectedId) setSelectedId(preselectedId);
      else if (data && data.length > 0) setSelectedId(data[0].id);
    };
    load();
  }, [router, preselectedId]);

  useEffect(() => {
    const loadSignals = async () => {
      if (!selectedId) {
        setAvoidContent([]);
        setWorkedContent([]);
        setFloppedContent([]);
        return;
      }

      const [postedRes, workedRes, floppedRes] = await Promise.all([
        supabase
          .from("content_drafts")
          .select("content")
          .eq("persona_id", selectedId)
          .eq("posted", true)
          .order("created_at", { ascending: false })
          .limit(15),
        supabase
          .from("content_drafts")
          .select("content")
          .eq("persona_id", selectedId)
          .eq("performance", "worked")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("content_drafts")
          .select("content")
          .eq("persona_id", selectedId)
          .eq("performance", "flopped")
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      setAvoidContent((postedRes.data || []).map((d) => d.content));
      setWorkedContent((workedRes.data || []).map((d) => d.content));
      setFloppedContent((floppedRes.data || []).map((d) => d.content));
    };
    loadSignals();
  }, [selectedId]);

  const selectedPersona = personas.find((p) => p.id === selectedId);

  const handleGenerate = async () => {
    if (!selectedPersona) return;
    setLoading(true);
    setError(null);
    setResult("");

    try {
      const res = await authedFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          type: "story_arc",
          topic: `Create a ${days}-day content series${theme ? ` around the theme: ${theme}` : ""}. 
For each day provide:
- Day number
- Post type (caption / short script / carousel idea)
- Full post content or script
- Why it fits the persona

Make the series feel cohesive and progressive. Stay 100% in character.
${workedContent.length > 0 ? "Lean into themes and hooks from posts that WORKED." : ""}
${floppedContent.length > 0 ? "Avoid patterns from posts that FLOPPED." : ""}`,
          model: "meta-llama/llama-3.3-70b-instruct",
          avoidContent,
          workedContent,
          floppedContent,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || "Generation failed";
        if (msg.toLowerCase().includes("key") || msg.toLowerCase().includes("auth")) {
          throw new Error(
            "AI key missing or invalid. Add OPENROUTER_API_KEY to .env.local and restart the server."
          );
        }
        throw new Error(msg);
      }

      setResult(data.content);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("content_drafts").insert({
          persona_id: selectedPersona.id,
          user_id: user.id,
          type: "story_arc",
          content: data.content,
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (personas.length === 0 && !loading) {
    return (
      <div className="min-h-screen p-6 sm:p-8 flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-zinc-400 mb-4">Create a persona first to plan a series.</p>
          <a
            href="/dashboard/personas/from-posts"
            className="inline-block px-5 py-2.5 bg-white text-black rounded-lg text-sm font-medium"
          >
            Build from posts
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Series Planner</h1>
        </div>

        <p className="text-zinc-400 text-sm mb-8">
          Multi-day series in character — steered by what worked and what flopped.
        </p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Persona</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {selectedPersona && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-400">
              <p className="font-medium text-zinc-200">{selectedPersona.name}</p>
              <p className="line-clamp-2 mt-1">{selectedPersona.backstory}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {workedContent.length > 0 && (
                  <span className="text-emerald-400">
                    Doubling down on {workedContent.length} that worked
                  </span>
                )}
                {floppedContent.length > 0 && (
                  <span className="text-red-400">Avoiding {floppedContent.length} that flopped</span>
                )}
                {avoidContent.length > 0 && (
                  <span className="text-green-400">
                    Skipping {avoidContent.length} already posted
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Number of days</label>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              >
                <option value={3}>3 days</option>
                <option value={5}>5 days</option>
                <option value={7}>7 days</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Theme (optional)</label>
              <input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="e.g. launching, mindset, behind the scenes"
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !selectedPersona}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Planning series..." : `Generate ${days}-Day Series`}
          </button>

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-medium">Your Series</h3>
                <button
                  onClick={() => navigator.clipboard.writeText(result)}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Copy All
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-zinc-200 text-sm leading-relaxed">
                {result}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SeriesPlannerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400">Loading...</div>
      }
    >
      <SeriesContent />
    </Suspense>
  );
}
