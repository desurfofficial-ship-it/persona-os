"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function FromPostsPage() {
  const router = useRouter();
  const [posts, setPosts] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);

  const handleAnalyze = async () => {
    if (!posts.trim() && !url.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      const res = await fetch("/api/analyze-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posts: posts.trim() || undefined,
          url: url.trim() || undefined,
        }),
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

      // Gold examples: from AI extract, or split pasted posts
      let example_posts: string[] = preview.example_posts || [];
      if ((!example_posts || example_posts.length === 0) && posts.trim()) {
        example_posts = posts
          .split(/\n\s*\n/)
          .map((p: string) => p.trim())
          .filter((p: string) => p.length > 20)
          .slice(0, 8);
      }

      const { data: inserted, error: insertError } = await supabase
        .from("personas")
        .insert({
          user_id: user.id,
          name: name || preview.name || "My Persona",
          backstory: preview.backstory || "",
          tone_of_voice: preview.tone_of_voice || "",
          lifestyle_pillars: preview.lifestyle_pillars || [],
          content_rules: preview.content_rules || [],
          forbidden_topics: preview.forbidden_topics || [],
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
          Paste posts or a public profile/blog URL. We extract voice, tone, rules — and save gold
          examples — then take you to generate.
        </p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Profile or blog URL (optional)
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://linkedin.com/in/... or blog URL"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
            />
            <p className="text-xs text-zinc-500 mt-1">
              Public pages only. Some sites block scrapers — if it fails, paste text below.
            </p>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Or paste your posts (separate with blank lines)
            </label>
            <textarea
              value={posts}
              onChange={(e) => setPosts(e.target.value)}
              rows={10}
              placeholder="Paste real posts here...\n\nPost 1\n\nPost 2\n\nPost 3"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={loading || (!posts.trim() && !url.trim())}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading && !preview ? "Analyzing voice..." : "Analyze"}
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
                {loading ? "Creating..." : "Create & Generate First Content"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
