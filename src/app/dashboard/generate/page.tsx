"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

const MODELS = [
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini (Fast)" },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
  { id: "google/gemini-flash-1.5", name: "Gemini Flash" },
  { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
];

interface ScoreInfo {
  score: number | null;
  verdict: string | null;
  note: string | null;
}

function GenerateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("persona");

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [type, setType] = useState<"caption" | "script" | "story_arc" | "image_prompt">("caption");
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [variations, setVariations] = useState(1);
  const [results, setResults] = useState<string[]>([]);
  const [scores, setScores] = useState<ScoreInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rewritingIndex, setRewritingIndex] = useState<number | null>(null);
  const [avoidContent, setAvoidContent] = useState<string[]>([]);
  const [nudgeIndex, setNudgeIndex] = useState<number | null>(null);

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
    const loadPosted = async () => {
      if (!selectedId) {
        setAvoidContent([]);
        return;
      }
      const { data } = await supabase
        .from("content_drafts")
        .select("content")
        .eq("persona_id", selectedId)
        .eq("posted", true)
        .order("created_at", { ascending: false })
        .limit(15);

      setAvoidContent((data || []).map((d) => d.content));
    };
    loadPosted();
  }, [selectedId]);

  const selectedPersona = personas.find((p) => p.id === selectedId);

  const saveDraft = async (content: string, contentType: string) => {
    if (!selectedPersona) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("content_drafts").insert({
        persona_id: selectedPersona.id,
        user_id: user.id,
        type: contentType,
        content,
      });
    }
  };

  const scoreResults = async (texts: string[], persona: Persona) => {
    const scorePromises = texts.map((text) =>
      fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, text, mode: "score" }),
      })
        .then((r) => r.json())
        .then((d) => ({
          score: d.score ?? null,
          verdict: d.verdict ?? null,
          note: d.note ?? null,
        }))
        .catch(() => ({ score: null, verdict: null, note: null }))
    );
    const scored = await Promise.all(scorePromises);
    setScores(scored);
  };

  const handleGenerate = async () => {
    if (!selectedPersona) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setScores([]);
    setNudgeIndex(null);

    try {
      const promises = Array.from({ length: variations }, () =>
        fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persona: selectedPersona,
            type,
            topic,
            model,
            avoidContent,
          }),
        }).then(async (res) => {
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
          return data.content as string;
        })
      );

      const allResults = await Promise.all(promises);
      setResults(allResults);
      await Promise.all(allResults.map((content) => saveDraft(content, type)));
      scoreResults(allResults, selectedPersona);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickRewrite = async (index: number, instruction: string) => {
    if (!selectedPersona) return;
    setRewritingIndex(index);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          type,
          topic: `${instruction}\n\nOriginal:\n${results[index]}`,
          model,
          avoidContent,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rewrite failed");

      const newResults = [...results];
      newResults[index] = data.content;
      setResults(newResults);
      await saveDraft(data.content, type);
      scoreResults(newResults, selectedPersona);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRewritingIndex(null);
    }
  };

  const handleTransform = async (index: number, newType: string, instruction: string) => {
    if (!selectedPersona) return;
    setRewritingIndex(index);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          type: newType,
          topic: `${instruction}\n\nOriginal content:\n${results[index]}`,
          model,
          avoidContent,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transform failed");

      const newResults = [...results];
      newResults[index] = data.content;
      setResults(newResults);
      await saveDraft(data.content, newType);
      scoreResults(newResults, selectedPersona);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRewritingIndex(null);
    }
  };

  const openPlatform = (text: string, platform: "x" | "linkedin", index: number) => {
    navigator.clipboard.writeText(text);
    if (platform === "x") {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      window.open("https://www.linkedin.com/feed/", "_blank");
    }
    setNudgeIndex(index);
  };

  if (personas.length === 0) {
    return (
      <div className="min-h-screen p-6 sm:p-8 flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-zinc-400 mb-4">Create a persona first to generate content.</p>
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
    <div className="min-h-screen p-6 sm:p-8 pb-28">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Generate Content</h1>
        </div>

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
              <p className="font-medium text-zinc-200 mb-1">{selectedPersona.name}</p>
              <p className="line-clamp-2">{selectedPersona.backstory}</p>
              {avoidContent.length > 0 ? (
                <p className="mt-2 text-xs text-green-400">
                  Avoiding {avoidContent.length} already-posted draft
                  {avoidContent.length > 1 ? "s" : ""}
                </p>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">
                  Mark drafts as Posted so we stop repeating topics.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Content Type</label>
            <div className="flex flex-wrap gap-2">
              {(["caption", "script", "story_arc", "image_prompt"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-4 py-2 rounded-lg text-sm capitalize ${
                    type === t
                      ? "bg-white text-black"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {t.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Variations</label>
              <select
                value={variations}
                onChange={(e) => setVariations(Number(e.target.value))}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              >
                <option value={1}>1 variation</option>
                <option value={2}>2 variations</option>
                <option value={3}>3 variations</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Topic / Context (optional)</label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. launching a new product, morning routine, mindset"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !selectedPersona}
            className="hidden sm:block w-full py-3.5 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 text-base"
          >
            {loading
              ? `Generating ${variations > 1 ? variations + " variations" : "..."}`
              : "Generate"}
          </button>

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {results.map((result, idx) => (
            <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium">
                    {results.length > 1 ? `Variation ${idx + 1}` : "Result"}
                  </h3>
                  {scores[idx]?.score != null && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        (scores[idx].score ?? 0) >= 80
                          ? "bg-green-900/50 text-green-300"
                          : (scores[idx].score ?? 0) >= 60
                            ? "bg-yellow-900/50 text-yellow-300"
                            : "bg-red-900/50 text-red-300"
                      }`}
                    >
                      {scores[idx].score}/100
                      {scores[idx].verdict ? ` · ${scores[idx].verdict}` : ""}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(result)}
                    className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => openPlatform(result, "x", idx)}
                    className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800"
                  >
                    Copy + X
                  </button>
                  <button
                    onClick={() => openPlatform(result, "linkedin", idx)}
                    className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800"
                  >
                    Copy + LinkedIn
                  </button>
                </div>
              </div>

              <pre className="whitespace-pre-wrap text-zinc-200 text-sm leading-relaxed mb-4">
                {rewritingIndex === idx ? "Working..." : result}
              </pre>

              {scores[idx]?.note && (
                <p className="text-xs text-zinc-500 mb-3">{scores[idx].note}</p>
              )}

              {nudgeIndex === idx && (
                <div className="mb-4 p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-sm flex flex-wrap items-center justify-between gap-2">
                  <span className="text-zinc-300">
                    Shipped it? Mark as Posted so we don’t repeat it.
                  </span>
                  <a
                    href="/dashboard/drafts"
                    className="text-xs px-3 py-1.5 bg-white text-black rounded-lg font-medium"
                  >
                    Open Drafts →
                  </a>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-3 border-t border-zinc-800">
                <button
                  onClick={() => handleQuickRewrite(idx, "Make this shorter and punchier")}
                  disabled={rewritingIndex === idx}
                  className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  Shorter
                </button>
                <button
                  onClick={() => handleQuickRewrite(idx, "Make this longer and more detailed")}
                  disabled={rewritingIndex === idx}
                  className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  Longer
                </button>
                <button
                  onClick={() =>
                    handleQuickRewrite(idx, "Make this more aggressive and high-energy")
                  }
                  disabled={rewritingIndex === idx}
                  className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  More Punch
                </button>
                <button
                  onClick={() =>
                    handleTransform(
                      idx,
                      "script",
                      "Turn this into a short video script (30-45 seconds) while keeping the exact same voice and message"
                    )
                  }
                  disabled={rewritingIndex === idx}
                  className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Script
                </button>
                <button
                  onClick={() =>
                    handleTransform(
                      idx,
                      "caption",
                      "Turn this into a strong social media caption while keeping the exact same voice and message"
                    )
                  }
                  disabled={rewritingIndex === idx}
                  className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Caption
                </button>
                <button
                  onClick={() =>
                    handleTransform(
                      idx,
                      "image_prompt",
                      "Turn this into a detailed image generation prompt that matches the persona's world and the content"
                    )
                  }
                  disabled={rewritingIndex === idx}
                  className="text-xs px-2.5 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Image Prompt
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sm:hidden fixed bottom-0 left-0 right-0 p-4 bg-zinc-950/95 border-t border-zinc-800 backdrop-blur">
        <button
          onClick={handleGenerate}
          disabled={loading || !selectedPersona}
          className="w-full py-3.5 bg-white text-black font-medium rounded-lg disabled:opacity-50"
        >
          {loading
            ? `Generating ${variations > 1 ? variations + " variations" : "..."}`
            : "Generate"}
        </button>
      </div>
    </div>
  );
}

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400">Loading...</div>
      }
    >
      <GenerateContent />
    </Suspense>
  );
}
