"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { PERSONA_TEMPLATES, type PersonaTemplate } from "@/lib/personaTemplates";

const TEMPLATES = PERSONA_TEMPLATES;

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

  const applyTemplate = (template: PersonaTemplate) => {
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

        {/* Two paths */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <a
            href="/dashboard/personas/from-posts"
            className="p-5 bg-zinc-900 border border-zinc-700 rounded-xl hover:border-zinc-500 transition"
          >
            <h3 className="font-semibold mb-1">Build from your posts</h3>
            <p className="text-sm text-zinc-400">
              Paste real posts → auto-extract voice, tone & rules
            </p>
          </a>
          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl">
            <h3 className="font-semibold mb-1">Start from template</h3>
            <p className="text-sm text-zinc-400">Pick a starting point below and customize</p>
          </div>
        </div>

        <div className="mb-8">
          <p className="text-sm text-zinc-400 mb-3">
            Quick start templates
            <span className="text-zinc-600"> · {TEMPLATES.length} niches · click to fill the form</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TEMPLATES.map((t) => {
              const active = name === t.name;
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className={`text-left p-3 bg-zinc-900 rounded-lg transition ${
                    active ? "border border-white" : "border border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <p className="font-medium text-sm">{t.name}</p>
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{t.tagline}</p>
                </button>
              );
            })}
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
            {loading ? "Creating..." : "Create Persona"}
          </button>
        </form>
      </div>
    </div>
  );
}
