"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Dead-simple first-run flow:
 *   1. Paste 3-10 of your best posts
 *   2. Review the extracted persona
 *   3. Generate your first post (redirects to /dashboard/generate?first=1)
 */

interface AnalyzeResult {
  name?: string;
  backstory?: string;
  tone_of_voice?: string;
  lifestyle_pillars?: string[];
  content_rules?: string[];
  forbidden_topics?: string[];
}

const STEPS = ["Paste posts", "Review persona", "First post"] as const;

export default function StartPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [posts, setPosts] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const postCount = useMemo(
    () =>
      posts
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 20).length,
    [posts]
  );

  const countColor =
    postCount >= 3 ? "text-green-400" : postCount > 0 ? "text-amber-400" : "text-zinc-500";

  const handleAnalyze = async () => {
    if (!posts.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");

      setPreview(data);
      if (data.name && !name) setName(data.name);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: created, error: insertError } = await supabase
        .from("personas")
        .insert({
          user_id: user.id,
          name: name || preview.name || "My Persona",
          backstory: preview.backstory || "",
          tone_of_voice: preview.tone_of_voice || "",
          lifestyle_pillars: preview.lifestyle_pillars || [],
          content_rules: preview.content_rules || [],
          forbidden_topics: preview.forbidden_topics || [],
        });

      if (insertError) throw insertError;

      const newId = (created as any)?.[0]?.id;
      // Step 3 of the loop: straight into the first generation.
      router.push(
        newId ? `/dashboard/generate?persona=${newId}&first=1` : "/dashboard/generate?first=1"
      );
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8" aria-label="Progress">
          {STEPS.map((label, i) => {
            const num = i + 1;
            const active = num === step;
            const done = num < step;
            return (
              <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                      done
                        ? "bg-green-500/20 text-green-300 border border-green-600"
                        : active
                        ? "bg-white text-black"
                        : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                    }`}
                  >
                    {done ? "✓" : num}
                  </span>
                  <span
                    className={`text-sm hidden sm:inline ${
                      active ? "text-white font-medium" : "text-zinc-500"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {num < STEPS.length && (
                  <div
                    className={`h-px flex-1 min-w-4 ${done ? "bg-green-600" : "bg-zinc-800"}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <>
            <h1 className="text-3xl font-bold mb-2">Paste your best posts</h1>
            <p className="text-zinc-400 text-sm mb-8">
              Drop in 3–10 posts that sound like you. We&apos;ll extract your voice, tone,
              rules, and pillars — no forms to fill.
            </p>

            <div className="space-y-5">
              <textarea
                value={posts}
                onChange={(e) => setPosts(e.target.value)}
                rows={12}
                autoFocus
                placeholder={"Paste post 1 here...\n\nPaste post 2 here...\n\nPaste post 3 here..."}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-sm leading-relaxed"
              />

              <div className="flex items-center justify-between text-sm gap-3">
                <span className={countColor}>
                  {postCount === 0
                    ? "Separate each post with a blank line"
                    : `${postCount} post${postCount === 1 ? "" : "s"} detected${
                        postCount < 3 ? " — 3–10 works best" : " — looking good"
                      }`}
                </span>
                <button
                  onClick={() => router.push("/dashboard/personas/new")}
                  className="text-zinc-500 hover:text-zinc-300 text-xs underline underline-offset-2 shrink-0"
                >
                  Prefer a template?
                </button>
              </div>

              {error && (
                <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleAnalyze}
                disabled={loading || !posts.trim()}
                className="w-full min-h-[52px] bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 text-base"
              >
                {loading ? "Analyzing your voice..." : "Build my persona →"}
              </button>
            </div>
          </>
        )}

        {step === 2 && preview && (
          <>
            <h1 className="text-3xl font-bold mb-2">This sounds like you?</h1>
            <p className="text-zinc-400 text-sm mb-8">
              Extracted from your posts. You can fine-tune everything later.
            </p>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg"
                  placeholder="Give it a name"
                />
              </div>

              <div>
                <p className="text-sm text-zinc-400 mb-1">Backstory</p>
                <p className="text-sm text-zinc-200 whitespace-pre-wrap">{preview.backstory}</p>
              </div>

              {preview.tone_of_voice && (
                <div>
                  <p className="text-sm text-zinc-400 mb-1">Tone of voice</p>
                  <p className="text-sm text-zinc-200">{preview.tone_of_voice}</p>
                </div>
              )}

              {preview.lifestyle_pillars && preview.lifestyle_pillars.length > 0 && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">Lifestyle pillars</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.lifestyle_pillars.map((p) => (
                      <span
                        key={p}
                        className="px-2.5 py-1 bg-zinc-800 rounded-full text-xs text-zinc-300"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {preview.content_rules && preview.content_rules.length > 0 && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">Content rules</p>
                  <ul className="list-disc list-inside text-sm text-zinc-200 space-y-1">
                    {preview.content_rules.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
                  {error}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={handleCreate}
                  disabled={loading}
                  className="flex-1 min-h-[52px] bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 text-base"
                >
                  {loading ? "Creating..." : "Create persona & write my first post →"}
                </button>
                <button
                  onClick={() => setStep(1)}
                  disabled={loading}
                  className="px-5 min-h-[52px] border border-zinc-700 rounded-lg text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Back
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
