"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const TEMPLATES = [
  {
    name: "Ambitious Founder",
    backstory:
      "Early-stage founder building in public. Obsessed with speed, clarity, and results. Shares the real journey — wins, losses, and lessons — without the corporate fluff.",
    tone: "Direct, confident, slightly irreverent, no-nonsense",
    pillars: "Building in public, high agency, shipping fast, mental toughness",
    rules: "Always speak in first person\nKeep it short and punchy\nNever sound corporate\nShare real numbers when possible",
    forbidden: "politics, personal drama, empty motivation",
  },
  {
    name: "Fitness Creator",
    backstory:
      "Dedicated to progressive training, recovery, and sustainable performance. Focuses on evidence-based methods and long-term consistency over quick fixes.",
    tone: "Motivational but realistic, knowledgeable, encouraging",
    pillars: "Strength training, recovery, nutrition, consistency",
    rules: "Never promote extreme diets\nFocus on sustainable habits\nBe encouraging without toxic positivity",
    forbidden: "steroids, extreme cuts, body shaming",
  },
  {
    name: "Luxury Lifestyle",
    backstory:
      "Curates a high-end but intentional lifestyle. Values quality, experiences, and refined taste. Content feels aspirational yet grounded.",
    tone: "Calm, sophisticated, understated confidence",
    pillars: "Quality over quantity, travel, design, personal standards",
    rules: "Never flex excessively\nFocus on taste and intention\nKeep language elegant and minimal",
    forbidden: "cheap promotions, desperation, oversharing finances",
  },
  {
    name: "Tech Operator",
    backstory:
      "Operator who has scaled products and teams. Shares practical systems, decision frameworks, and hard-earned lessons from the trenches.",
    tone: "Precise, analytical, experienced, low-ego",
    pillars: "Systems thinking, execution, product, leadership",
    rules: "Prefer frameworks over opinions\nBe specific\nAvoid buzzwords",
    forbidden: "hype, vague advice, guru energy",
  },
];

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

  const applyTemplate = (template: (typeof TEMPLATES)[0]) => {
    setName(template.name);
    setBackstory(template.backstory);
    setTone(template.tone);
    setPillars(template.pillars);
    setRules(template.rules);
    setForbidden(template.forbidden);
  };

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
        setError("You must be logged in.");
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

      const { data: inserted, error: insertError } = await supabase
        .from("personas")
        .insert({
          user_id: user.id,
          name,
          backstory,
          tone_of_voice: tone,
          lifestyle_pillars,
          content_rules,
          forbidden_topics,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      if (inserted?.id) {
        router.push(`/dashboard/generate?persona=${inserted.id}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError(err.message || "Failed to create persona");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-3xl font-bold">Create Persona</h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <a
            href="/dashboard/personas/from-posts"
            className="p-5 bg-white text-black rounded-xl hover:bg-zinc-200 transition"
          >
            <h3 className="font-semibold mb-1">Build from your posts</h3>
            <p className="text-sm text-zinc-600">
              Paste real posts → auto-extract voice, tone & rules
            </p>
          </a>
          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl">
            <h3 className="font-semibold mb-1">Start from template</h3>
            <p className="text-sm text-zinc-400">Pick a starting point below and customize</p>
          </div>
        </div>

        <div className="mb-8">
          <p className="text-sm text-zinc-400 mb-3">Quick start templates</p>
          <div className="grid grid-cols-2 gap-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => applyTemplate(t)}
                className="text-left p-3 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-600 transition"
              >
                <p className="font-medium text-sm">{t.name}</p>
                <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{t.tone}</p>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Backstory *</label>
            <textarea
              value={backstory}
              onChange={(e) => setBackstory(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Tone of Voice</label>
            <input
              type="text"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
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
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
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
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
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
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create & Generate First Content"}
          </button>
        </form>
      </div>
    </div>
  );
}
