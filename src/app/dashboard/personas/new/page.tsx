"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  PERSONA_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type PersonaTemplate,
} from "@/lib/templates";

export default function NewPersonaPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [backstory, setBackstory] = useState("");
  const [tone, setTone] = useState("");
  const [pillars, setPillars] = useState("");
  const [rules, setRules] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [examples, setExamples] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (category === "All") return PERSONA_TEMPLATES;
    return PERSONA_TEMPLATES.filter((t) => t.category === category);
  }, [category]);

  const applyTemplate = (template: PersonaTemplate) => {
    setSelectedTemplateId(template.id);
    setName(template.name);
    setBackstory(template.backstory);
    setTone(template.tone);
    setPillars(template.pillars);
    setRules(template.rules);
    setForbidden(template.forbidden);
    setExamples(template.example_posts.join("\n\n---\n\n"));
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

      const example_posts = examples
        .split(/\n\s*---\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 10)
        .slice(0, 8);

      const { data: inserted, error: insertError } = await supabase
        .from("personas")
        .insert({
          user_id: user.id,
          name: name.trim().slice(0, 120),
          backstory: backstory.trim(),
          tone_of_voice: tone.trim(),
          lifestyle_pillars,
          content_rules,
          forbidden_topics,
          example_posts,
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
              Paste real posts or URL → auto-extract voice
            </p>
          </a>
          <a
            href="/dashboard/connect"
            className="p-5 bg-zinc-900 border border-zinc-700 rounded-xl hover:border-zinc-500 transition"
          >
            <h3 className="font-semibold mb-1">Connect account (optional)</h3>
            <p className="text-sm text-zinc-400">Link a public X handle</p>
          </a>
        </div>

        <div className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-sm text-zinc-400">Templates</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    category === c
                      ? "border-white bg-white text-black"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className={`text-left p-4 rounded-xl border transition ${
                  selectedTemplateId === t.id
                    ? "bg-zinc-800 border-white"
                    : "bg-zinc-900 border-zinc-800 hover:border-zinc-600"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="font-medium text-sm">{t.name}</p>
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                    {t.category}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 line-clamp-2">{t.tagline}</p>
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

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Gold example posts (separate with ---)
            </label>
            <textarea
              value={examples}
              onChange={(e) => setExamples(e.target.value)}
              rows={6}
              placeholder="Template fills these in — edit freely"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
            />
            <p className="text-xs text-zinc-500 mt-1">
              Generation matches the style of these examples.
            </p>
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
