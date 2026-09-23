"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabase, authedFetch } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

interface CheckResult {
  score: number;
  verdict: "Safe to post" | "Needs changes" | "Major rewrite needed";
  matches: string[];
  breaks: { quote: string; why: string; fix: string }[];
  rewrites: { original: string; rewrite: string }[];
  meta?: {
    cliches?: string[];
    aiTells?: string[];
    forbidden?: string[];
    voiceScore?: number | null;
    voiceSamples?: number;
  };
}

const VERDICT_STYLES: Record<CheckResult["verdict"], string> = {
  "Safe to post": "bg-emerald-950 border-emerald-700 text-emerald-300",
  "Needs changes": "bg-amber-950 border-amber-700 text-amber-300",
  "Major rewrite needed": "bg-red-950 border-red-700 text-red-300",
};

function CheckContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("persona");
  const prefillText = searchParams.get("text");

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [text, setText] = useState(prefillText || "");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (preselectedId && data?.some((p) => p.id === preselectedId)) {
        setSelectedId(preselectedId);
      } else if (data && data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
      }
    };
    load();
  }, [router, preselectedId]);

  const selectedPersona = personas.find((p) => p.id === selectedId);

  const handleCheck = async () => {
    if (!selectedPersona || !text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Voice samples: the persona's real drafts, so the checker can
      // measure voice match, not just guess from adjectives.
      const { data: drafts } = await supabase
        .from("content_drafts")
        .select("content")
        .eq("persona_id", selectedPersona.id)
        .order("created_at", { ascending: false })
        .limit(30);

      const res = await authedFetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          text,
          voiceSamples: (drafts || []).map((d: { content: string }) => d.content),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed");

      setResult(data as CheckResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Consistency Checker</h1>
        </div>

        <p className="text-xs text-zinc-500 -mt-4 mb-6">
          This checks ONE piece of content. To find contradictions{" "}
          <span className="text-zinc-300">across</span> all your posts and scripts, open a persona
          and run the{" "}
          <a href="/dashboard" className="underline text-zinc-300 hover:text-white">
            Consistency Engine scan
          </a>
          .
        </p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Persona</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-4 py-3 min-h-[48px] bg-zinc-900 border border-zinc-700 rounded-lg"
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
            </div>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Paste content to check
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Paste a caption, script, post, or any text you want to verify against this persona..."
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            />
          </div>

          <button
            onClick={handleCheck}
            disabled={loading || !selectedPersona || !text.trim()}
            className="w-full py-3 min-h-[48px] bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Check Consistency"}
          </button>

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Score + verdict header */}
              <div className={`${VERDICT_STYLES[result.verdict]} border rounded-xl p-5 flex items-center gap-5`}>
                <div className="shrink-0">
                  <div className="text-4xl font-bold">{result.score}</div>
                  <div className="text-[11px] opacity-70">/ 100</div>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{result.verdict}</p>
                  <p className="text-xs opacity-80 mt-0.5">
                    {result.meta?.voiceScore !== null && result.meta?.voiceScore !== undefined
                      ? `Voice match ${result.meta.voiceScore}% (measured from ${result.meta.voiceSamples} real samples)`
                      : "Add drafts to this persona for voice-match scoring"}
                  </p>
                </div>
              </div>

              {/* What matches */}
              {result.matches.length > 0 && (
                <div className="bg-zinc-900 border border-emerald-800/50 rounded-xl p-5">
                  <p className="text-sm font-medium text-emerald-300 mb-2">
                    What sounds like them
                  </p>
                  <ul className="space-y-1.5">
                    {result.matches.map((m, i) => (
                      <li key={i} className="text-sm text-zinc-300">✓ {m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Breaks */}
              {result.breaks.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                  <p className="text-sm font-medium text-amber-300 mb-3">
                    Breaks character ({result.breaks.length})
                  </p>
                  <div className="space-y-3">
                    {result.breaks.map((b, i) => (
                      <div key={i} className="border-l-2 border-amber-700/60 pl-3">
                        <p className="text-sm text-zinc-200">
                          <span className="text-amber-300">“{b.quote}”</span>
                        </p>
                        <p className="text-xs text-zinc-500 mt-0.5">{b.why}</p>
                        {b.fix && (
                          <p className="text-xs text-emerald-400/90 mt-0.5">Fix: {b.fix}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rewrites */}
              {result.rewrites.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                  <p className="text-sm font-medium text-zinc-300 mb-3">
                    Suggested rewrites
                  </p>
                  <div className="space-y-4">
                    {result.rewrites.map((r, i) => (
                      <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                        <p className="text-xs text-red-400/80 line-through mb-2">{r.original}</p>
                        <pre className="whitespace-pre-wrap text-sm text-emerald-200 leading-relaxed">
                          {r.rewrite}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Clean bill of health */}
              {result.breaks.length === 0 && result.verdict === "Safe to post" && (
                <div className="bg-zinc-900 border border-emerald-800/50 rounded-xl p-5">
                  <p className="text-sm text-emerald-300">
                    No character breaks found. This reads like {selectedPersona?.name} wrote it.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConsistencyCheckPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400">Loading...</div>
      }
    >
      <CheckContent />
    </Suspense>
  );
}
