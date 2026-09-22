"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function NewPersonaPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [backstory, setBackstory] = useState("");
  const [tone, setTone] = useState("");
  const [pillars, setPillars] = useState("");
  const [rules, setRules] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError("You must be logged in to create a persona.");
        setLoading(false);
        return;
      }

      const lifestyle_pillars = pillars
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      const content_rules = rules
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);

      const forbidden_topics = forbidden
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const { error: insertError } = await supabase.from("personas").insert({
        user_id: user.id,
        name,
        backstory,
        tone_of_voice: tone,
        lifestyle_pillars,
        content_rules,
        forbidden_topics,
      });

      if (insertError) throw insertError;

      router.push("/dashboard");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to create persona");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-3xl font-bold">Create New Persona</h1>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Persona Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
              placeholder="e.g. Alex Rivera — Founder"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Backstory *
            </label>
            <textarea
              value={backstory}
              onChange={(e) => setBackstory(e.target.value)}
              rows={5}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
              placeholder="Who is this persona? Background, current life, goals, personality..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Tone of Voice
            </label>
            <input
              type="text"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
              placeholder="e.g. Confident, slightly irreverent, direct, no fluff"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Lifestyle Pillars (comma separated)
            </label>
            <input
              type="text"
              value={pillars}
              onChange={(e) => setPillars(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
              placeholder="e.g. Building in public, fitness, high-agency living"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Content Rules (one per line)
            </label>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
              placeholder={"Always speak in first person\nNever apologize\nKeep sentences short and punchy"}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Forbidden Topics (comma separated)
            </label>
            <input
              type="text"
              value={forbidden}
              onChange={(e) => setForbidden(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
              placeholder="e.g. politics, crypto prices, personal relationships"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 transition disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Persona"}
          </button>
        </form>
      </div>
    </div>
  );
}
