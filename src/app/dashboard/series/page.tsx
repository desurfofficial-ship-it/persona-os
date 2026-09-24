"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, authedFetch } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";

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

      const variant = Array.isArray(data.variants) ? data.variants[0] : null;
      const content =
        (variant && typeof variant.content === "string" && variant.content) ||
        (typeof data.content === "string" && data.content) ||
        "";

      if (!content.trim()) throw new Error("Empty series returned — try again.");

      setRawResult(content);
      setHookType(variant?.hookType || arc.label);

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

  const savePostDraft = async (post: SeriesPost) => {
    if (!selectedPersona) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("content_drafts").insert({
      persona_id: selectedPersona.id,
      user_id: user.id,
      type: "caption",
      content: post.content,
    });
    setSavedDays((prev) => new Set(prev).add(post.day));
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
              <button
                onClick={() => navigator.clipboard.writeText(rawResult)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Copy all
              </button>
            </div>

            {posts.map((post) => (
              <div
                key={post.day}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wide text-emerald-400/90">
                    {post.label}
                  </span>
                  <div className="flex gap-2">
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
                  </div>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                  {post.content}
                </pre>
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
