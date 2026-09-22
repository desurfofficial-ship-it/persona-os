"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

const MODELS = [
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini (Fast & Cheap)" },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
  { id: "google/gemini-flash-1.5", name: "Gemini Flash" },
  { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
];

function GenerateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("persona");

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [type, setType] = useState<"caption" | "script" | "story_arc" | "image_prompt">("caption");
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [result, setResult] = useState("");
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
      if (preselectedId) setSelectedId(preselectedId);
      else if (data && data.length > 0) setSelectedId(data[0].id);
    };
    load();
  }, [router, preselectedId]);

  const selectedPersona = personas.find((p) => p.id === selectedId);

  const handleGenerate = async () => {
    if (!selectedPersona) return;
    setLoading(true);
    setError(null);
    setResult("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          type,
          topic,
          model,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Generation failed");
      }

      setResult(data.content);

      // Save draft
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("content_drafts").insert({
          persona_id: selectedPersona.id,
          user_id: user.id,
          type,
          content: data.content,
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Back to Dashboard
          </a>
          <h1 className="text-2xl font-bold">Generate Content</h1>
        </div>

        <div className="space-y-6">
          {/* Persona */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Persona</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            >
              {personas.length === 0 && (
                <option value="">No personas yet</option>
              )}
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
              {selectedPersona.tone_of_voice && (
                <p className="mt-2">Tone: {selectedPersona.tone_of_voice}</p>
              )}
            </div>
          )}

          {/* Type */}
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

          {/* Model */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Model (OpenRouter)</label>
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

          {/* Topic */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Topic / Context (optional)
            </label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. launching a new product, morning routine, mindset shift"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !selectedPersona}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate"}
          </button>

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              <p className="font-medium mb-1">Error</p>
              <p>{error}</p>
              {error.toLowerCase().includes("key") || error.toLowerCase().includes("auth") ? (
                <p className="mt-2 text-red-300">
                  Make sure OPENROUTER_API_KEY is set in your .env.local and you restarted the server.
                </p>
              ) : null}
            </div>
          )}

          {result && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium">Result</h3>
                <button
                  onClick={() => navigator.clipboard.writeText(result)}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Copy
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

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400">
          Loading...
        </div>
      }
    >
      <GenerateContent />
    </Suspense>
  );
}
