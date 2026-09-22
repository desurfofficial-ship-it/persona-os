"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { fetchVoiceSamples } from "@/lib/voiceSamples";

export default function IdeasPage() {
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [count, setCount] = useState(10);
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
      if (data && data.length > 0) setSelectedId(data[0].id);
    };
    load();
  }, [router]);

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
          type: "story_arc",
          voiceSamples: await fetchVoiceSamples(selectedPersona.id),
          topic: `Generate ${count} high-quality content topic ideas that are perfect for this persona.
For each idea provide:
- A short punchy title
- One sentence explaining why it fits the persona
- Suggested format (caption / short video / carousel / thread)

Make the ideas specific, timely-feeling, and true to the persona's voice and lifestyle pillars. Avoid generic advice.`,
          model: "openai/gpt-4o-mini",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

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

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Topic Ideas</h1>
        </div>

        <p className="text-zinc-400 text-sm mb-8">
          Get a list of on-brand content ideas tailored to the persona.
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
            </div>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-2">How many ideas?</label>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            >
              <option value={5}>5 ideas</option>
              <option value={10}>10 ideas</option>
              <option value={15}>15 ideas</option>
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !selectedPersona}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Generating ideas..." : "Generate Topic Ideas"}
          </button>

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-medium">Ideas</h3>
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
