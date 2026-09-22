"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function FromPostsPage() {
  const router = useRouter();
  const [posts, setPosts] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);

  const handleAnalyze = async () => {
    if (!posts.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);

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
        setError("You must be logged in");
        setLoading(false);
        return;
      }

      const { data: created, error: insertError } = await supabase.from("personas").insert({
        user_id: user.id,
        name: name || preview.name || "My Persona",
        backstory: preview.backstory || "",
        tone_of_voice: preview.tone_of_voice || "",
        lifestyle_pillars: preview.lifestyle_pillars || [],
        content_rules: preview.content_rules || [],
        forbidden_topics: preview.forbidden_topics || [],
      });

      if (insertError) throw insertError;

      // Keep the loop going: persona created → first generation immediately.
      const newId = (created as any)?.[0]?.id;
      router.push(
        newId ? `/dashboard/generate?persona=${newId}&first=1` : "/dashboard/generate?first=1"
      );
    } catch (err: any) {
      setError(err.message);
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
          <h1 className="text-2xl font-bold">Build from Posts</h1>
        </div>

        <p className="text-zinc-400 text-sm mb-8">
          Paste 3–10 of your best posts. We’ll extract the voice, tone, rules, and pillars automatically.
        </p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Paste your posts (separate with blank lines)
            </label>
            <textarea
              value={posts}
              onChange={(e) => setPosts(e.target.value)}
              rows={12}
              placeholder="Paste real posts here...\n\nPost 1\n\nPost 2\n\nPost 3"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={loading || !posts.trim()}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Analyzing voice..." : "Analyze Posts"}
          </button>

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {preview && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
              <h2 className="font-semibold text-lg">Extracted Persona</h2>

              <div>
                <label className="block text-sm text-zinc-400 mb-2">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg"
                  placeholder="Give it a name"
                />
              </div>

              <div>
                <p className="text-sm text-zinc-400 mb-1">Backstory</p>
                <p className="text-sm text-zinc-200">{preview.backstory}</p>
              </div>

              <div>
                <p className="text-sm text-zinc-400 mb-1">Tone of Voice</p>
                <p className="text-sm text-zinc-200">{preview.tone_of_voice}</p>
              </div>

              {preview.lifestyle_pillars?.length > 0 && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">Lifestyle Pillars</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.lifestyle_pillars.map((p: string) => (
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

              {preview.content_rules?.length > 0 && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">Content Rules</p>
                  <ul className="list-disc list-inside text-sm text-zinc-200 space-y-1">
                    {preview.content_rules.map((r: string, i: number) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.forbidden_topics?.length > 0 && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">Forbidden Topics</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.forbidden_topics.map((t: string) => (
                      <span
                        key={t}
                        className="px-2.5 py-1 bg-red-900/40 border border-red-800 rounded-full text-xs text-red-200"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Persona"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
