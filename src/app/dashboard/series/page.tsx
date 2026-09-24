"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, authedFetch } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { extractGenerateContent } from "@/lib/generateResponse";

const ARC_TYPES = [
  {
    id: "arc",
    label: "Setup → tension → payoff",
    hint: "4-beat story. Plant tension, escalate, turn, pay off.",
    offset: 0,
  },
  {
    id: "myth-proof-frame",
    label: "Myth → proof → framework",
    hint: "Kill a common belief, then hand a simple system.",
    offset: 2,
  },
  {
    id: "before-turn-after",
    label: "Before → turn → after",
    hint: "Confession arc: who they were, the moment, the new habit.",
    offset: 3,
  },
  {
    id: "list-deep-dives",
    label: "List tease → deep dives",
    hint: "Promise N items, then one post per item.",
    offset: 4,
  },
  {
    id: "segments",
    label: "Standalone cluster",
    hint: "Same theme, each post works alone, escalating order.",
    offset: 1,
  },
] as const;

type ArcId = (typeof ARC_TYPES)[number]["id"];

interface SeriesPost {
  day: number;
  label: string;
  content: string;
}

/** Split engine output labeled POST 1: / Day 1: into cards. */
export function parseSeriesPosts(raw: string): SeriesPost[] {
  const text = raw.trim();
  if (!text) return [];

  const re =
    /(?:^|\n)\s*(?:POST|DAY|Day|Post)\s*(\d+)\s*[:.\-–—)]\s*/gi;
  const matches = [...text.matchAll(re)];
  if (matches.length < 2) {
    // Single blob fallback
    return [{ day: 1, label: "Full series", content: text }];
  }

  const posts: SeriesPost[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const day = Number(m[1]) || i + 1;
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    const content = text.slice(start, end).trim();
    if (content.length > 10) {
      posts.push({ day, label: `Day ${day}`, content });
    }
  }
  return posts.length ? posts : [{ day: 1, label: "Full series", content: text }];
}


function scheduleDates(count: number, start: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString());
  }
  return out;
}

function SeriesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("persona");

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [theme, setTheme] = useState("");
  const [days, setDays] = useState(4);
  const [arcId, setArcId] = useState<ArcId>("arc");
  const [platform, setPlatform] = useState<PlatformId>("x");
  const [rawResult, setRawResult] = useState("");
  const [hookType, setHookType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedDay, setCopiedDay] = useState<number | null>(null);
  const [savedDays, setSavedDays] = useState<Set<number>>(new Set());
  const [imagePrompts, setImagePrompts] = useState<Record<number, string>>({});
  const [loadingImageDay, setLoadingImageDay] = useState<number | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [loadingAllImages, setLoadingAllImages] = useState(false);
  const [exported, setExported] = useState(false);
  const [postedContent, setPostedContent] = useState<string[]>([]);
  const [workedContent, setWorkedContent] = useState<string[]>([]);

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
    const loadSignals = async () => {
      if (!selectedId) {
        setPostedContent([]);
        setWorkedContent([]);
        return;
      }
      const [postedRes, workedRes] = await Promise.all([
        supabase
          .from("content_drafts")
          .select("content")
          .eq("persona_id", selectedId)
          .eq("posted", true)
          .order("created_at", { ascending: false })
          .limit(12),
        supabase
          .from("content_drafts")
          .select("content")
          .eq("persona_id", selectedId)
          .eq("performance", "worked")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      setPostedContent((postedRes.data || []).map((d) => d.content).filter(Boolean));
      setWorkedContent((workedRes.data || []).map((d) => d.content).filter(Boolean));
    };
    loadSignals();
  }, [selectedId]);

  const selectedPersona = personas.find((p) => p.id === selectedId);
  const arc = ARC_TYPES.find((a) => a.id === arcId) || ARC_TYPES[0];

  const goldSamples = useMemo(() => {
    const raw = selectedPersona?.voice_samples || [];
    return (Array.isArray(raw) ? raw : [])
      .filter((s) => s && s.enabled !== false && typeof s.text === "string" && s.text.length > 20)
      .map((s) => s.text);
  }, [selectedPersona]);

  const posts = useMemo(() => parseSeriesPosts(rawResult), [rawResult]);

  const handleGenerate = async () => {
    if (!selectedPersona) return;
    setLoading(true);
    setError(null);
    setRawResult("");
    setHookType("");
    setSavedDays(new Set());

    const topic = [
      `Build a ${days}-post series`,
      theme ? `on theme: ${theme}` : "from this persona's lifestyle pillars",
      `using the "${arc.label}" arc structure.`,
      `Exactly ${days} posts labeled POST 1: through POST ${days}:.`,
      "Each post is a complete standalone caption (or short script if the day calls for it).",
      "Progressive arc — not the same tip restated.",
      workedContent.length ? "Lean into energy from posts that WORKED for this persona." : "",
    ]
      .filter(Boolean)
      .join(" ");

    try {
      const res = await authedFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          type: "story_arc",
          topic,
          platform,
          variants: 1,
          strategyOffset: arc.offset,
          model: "meta-llama/llama-3.3-70b-instruct",
          polish: true,
          goldSamples: goldSamples.length ? goldSamples : undefined,
          voiceSamples: goldSamples.length ? undefined : workedContent.slice(0, 5),
          postedContext: postedContent.map((c) => ({ content: c })),
        }),
      });

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

      const content = extractGenerateContent(data);
      if (!content.trim()) throw new Error("Empty series returned — try again.");
      const variant = Array.isArray(data.variants) ? data.variants[0] : null;

      setRawResult(content);
      setHookType((variant && variant.hookType) || arc.label);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("content_drafts").insert({
          persona_id: selectedPersona.id,
          user_id: user.id,
          type: "story_arc",
          content,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const copyPost = async (post: SeriesPost) => {
    await navigator.clipboard.writeText(post.content);
    setCopiedDay(post.day);
    setTimeout(() => setCopiedDay(null), 1500);
  };

  const savePostDraft = async (post: SeriesPost, plannedFor?: string | null) => {
    if (!selectedPersona) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const row: Record<string, unknown> = {
      persona_id: selectedPersona.id,
      user_id: user.id,
      type: "caption",
      content: post.content,
    };
    if (plannedFor) row.planned_for = plannedFor;
    await supabase.from("content_drafts").insert(row);
    setSavedDays((prev) => new Set(prev).add(post.day));
  };

  const scheduleSeries = async () => {
    if (!selectedPersona || !posts.length || scheduling) return;
    setScheduling(true);
    setError(null);
    try {
      const dates = scheduleDates(posts.length);
      for (let i = 0; i < posts.length; i++) {
        await savePostDraft(posts[i], dates[i]);
      }
      setScheduled(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not schedule series");
    } finally {
      setScheduling(false);
    }
  };

  const generateImageForDay = async (post: SeriesPost) => {
    if (!selectedPersona || loadingImageDay !== null) return;
    setLoadingImageDay(post.day);
    setError(null);
    try {
      const res = await authedFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          type: "image_prompt",
          topic: `Visual for this series post (day ${post.day}): ${post.content.slice(0, 400)}`,
          platform,
          variants: 1,
          polish: true,
          goldSamples: goldSamples.length ? goldSamples : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Image prompt failed");
      const variant = Array.isArray(data.variants) ? data.variants[0] : null;
      const content =
        (variant && typeof variant.content === "string" && variant.content) ||
        (typeof data.content === "string" && data.content) ||
        "";
      if (!content.trim()) throw new Error("Empty image prompt");
      setImagePrompts((prev) => ({ ...prev, [post.day]: content }));
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("content_drafts").insert({
          persona_id: selectedPersona.id,
          user_id: user.id,
          type: "image_prompt",
          content,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Image prompt failed");
    } finally {
      setLoadingImageDay(null);
    }
  };

  const generateAllImages = async () => {
    if (!selectedPersona || !posts.length || loadingAllImages || loadingImageDay !== null) return;
    setLoadingAllImages(true);
    setError(null);
    try {
      for (const post of posts) {
        if (imagePrompts[post.day]) continue;
        setLoadingImageDay(post.day);
        const res = await authedFetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persona: selectedPersona,
            type: "image_prompt",
            topic: `Visual for this series post (day ${post.day}): ${post.content.slice(0, 400)}`,
            platform,
            variants: 1,
            polish: true,
            goldSamples: goldSamples.length ? goldSamples : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Image prompt failed for day ${post.day}`);
        const variant = Array.isArray(data.variants) ? data.variants[0] : null;
        const content =
          (variant && typeof variant.content === "string" && variant.content) ||
          (typeof data.content === "string" && data.content) ||
          "";
        if (!content.trim()) throw new Error(`Empty image prompt for day ${post.day}`);
        setImagePrompts((prev) => ({ ...prev, [post.day]: content }));
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("content_drafts").insert({
            persona_id: selectedPersona.id,
            user_id: user.id,
            type: "image_prompt",
            content,
          });
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bulk image prompts failed");
    } finally {
      setLoadingImageDay(null);
      setLoadingAllImages(false);
    }
  };

  const exportWeekPlan = async () => {
    if (!posts.length) return;
    const dates = scheduleDates(posts.length);
    const lines: string[] = [
      `# Series week plan — ${selectedPersona?.name || "persona"}`,
      theme ? `Theme: ${theme}` : null,
      hookType ? `Arc: ${hookType}` : null,
      `Platform: ${PLATFORMS[platform].name}`,
      "",
    ].filter((x): x is string => Boolean(x));

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const d = new Date(dates[i]);
      const dateLabel = d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      lines.push(`## ${post.label} — ${dateLabel}`);
      lines.push("");
      lines.push(post.content);
      lines.push("");
      if (imagePrompts[post.day]) {
        lines.push("### Image prompt");
        lines.push(imagePrompts[post.day]);
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    }

    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch {
      // Fallback download
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `series-week-plan-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    }
  };

  if (personas.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-zinc-400">Create a persona first to plan a series.</p>
        <a
          href="/dashboard/personas/new"
          className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium"
        >
          Create persona
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl sm:text-3xl font-bold mt-3 mb-2">Story arc / series</h1>
          <p className="text-zinc-400 text-sm">
            Multi-day posts that feel planned — each one works alone, together they form one arc.
          </p>
        </div>

        <div className="space-y-5 mb-10">
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

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Theme (optional)</label>
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="e.g. morning systems, quiet luxury, travel logistics"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Arc structure</label>
            <div className="grid gap-2">
              {ARC_TYPES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setArcId(a.id)}
                  className={`text-left px-4 py-3 rounded-xl border transition ${
                    arcId === a.id
                      ? "border-emerald-600 bg-emerald-950/30"
                      : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                  }`}
                >
                  <div className="font-medium text-sm">{a.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{a.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Posts in series</label>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              >
                {[3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} posts
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Platform packaging</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as PlatformId)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              >
                {(Object.keys(PLATFORMS) as PlatformId[]).map((id) => (
                  <option key={id} value={id}>
                    {PLATFORMS[id].name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !selectedPersona}
            className="w-full min-h-[52px] bg-white text-black font-medium rounded-xl hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Building series…" : `Generate ${days}-post series`}
          </button>

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}
        </div>

        {rawResult && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium">Your series</h2>
                {hookType && (
                  <p className="text-xs text-zinc-500 mt-0.5">Structure: {hookType}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(rawResult)}
                  className="text-xs text-zinc-400 hover:text-white px-2 py-1"
                >
                  Copy all
                </button>
                <button
                  onClick={scheduleSeries}
                  disabled={scheduling || scheduled}
                  className="text-xs px-3 py-1.5 rounded-lg border border-emerald-700/60 text-emerald-400 hover:bg-emerald-950/40 disabled:opacity-50"
                  title="Save each post as a draft planned across the next days"
                >
                  {scheduled
                    ? "Scheduled ✓"
                    : scheduling
                      ? "Scheduling…"
                      : `Schedule over ${posts.length} days`}
                </button>
                <button
                  onClick={generateAllImages}
                  disabled={loadingAllImages || loadingImageDay !== null}
                  className="text-xs px-3 py-1.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  title="Generate a matching image prompt for every day"
                >
                  {loadingAllImages
                    ? `Images day ${loadingImageDay ?? "…"}…`
                    : Object.keys(imagePrompts).length >= posts.length
                      ? "All images ✓"
                      : "All image prompts"}
                </button>
                <button
                  onClick={exportWeekPlan}
                  className="text-xs px-3 py-1.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800"
                  title="Copy a full week plan (posts + image prompts) to clipboard"
                >
                  {exported ? "Plan copied ✓" : "Export week plan"}
                </button>
              </div>
            </div>
            {scheduled && (
              <p className="text-xs text-emerald-500/90">
                Saved as drafts with plan dates starting today. Check Dashboard calendar / due list.
              </p>
            )}

            {posts.map((post) => (
              <div
                key={post.day}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wide text-emerald-400/90">
                    {post.label}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => copyPost(post)}
                      className="text-xs px-2 py-1 border border-zinc-700 rounded hover:bg-zinc-800"
                    >
                      {copiedDay === post.day ? "Copied ✓" : "Copy"}
                    </button>
                    <button
                      onClick={() => savePostDraft(post)}
                      className="text-xs px-2 py-1 border border-zinc-700 rounded hover:bg-zinc-800"
                    >
                      {savedDays.has(post.day) ? "Saved ✓" : "Save draft"}
                    </button>
                    <button
                      onClick={() => generateImageForDay(post)}
                      disabled={loadingImageDay !== null}
                      className="text-xs px-2 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {loadingImageDay === post.day
                        ? "Image…"
                        : imagePrompts[post.day]
                          ? "Regen image"
                          : "Image prompt"}
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                  {post.content}
                </pre>
                {imagePrompts[post.day] && (
                  <div className="mt-4 pt-4 border-t border-zinc-800">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-zinc-500">Matching image prompt</p>
                      <button
                        onClick={() => navigator.clipboard.writeText(imagePrompts[post.day])}
                        className="text-xs text-zinc-400 hover:text-white"
                      >
                        Copy prompt
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap text-xs text-zinc-400 leading-relaxed">
                      {imagePrompts[post.day]}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SeriesPlannerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400">
          Loading...
        </div>
      }
    >
      <SeriesContent />
    </Suspense>
  );
}
