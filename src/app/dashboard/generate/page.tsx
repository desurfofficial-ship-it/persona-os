"use client";

import { useEffect, useState, useRef, Suspense, type RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { copyAndOpen, copyToClipboard } from "@/lib/share";
import { getActivePersonaId, setActivePersonaId } from "@/lib/activePersona";
import {
  findSimilarPosts,
  formatPostedDate,
  sensitivityLabel,
  type PostedPost,
  type Sensitivity,
  type SimilarPost,
} from "@/lib/duplicate";

const MODELS = [
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini (Fast)" },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
  { id: "google/gemini-flash-1.5", name: "Gemini Flash" },
  { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
];

const SENSITIVITY_KEY = "persona-os-dup-sensitivity";

type ContentType = "caption" | "script" | "story_arc" | "image_prompt";

interface AssetCtx {
  id: string;
  persona_id: string;
  type: string;
  url: string | null;
  content: string | null;
  tags: string[];
}

interface FormatResult {
  label: string;
  type: ContentType;
  content: string;
}

function GenerateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("persona");
  const isFirstRun = searchParams.get("first") === "1";
  const assetParam = searchParams.get("asset");
  const isWelcomeBack = searchParams.get("welcome") === "1";

  const WELCOME_PROMPT =
    "I've been quiet for a few days — write an honest come-back post about where I've been and what I learned in the gap. No apology theater, just real.";

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [type, setType] = useState<ContentType>("caption");
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [variations, setVariations] = useState(1);
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rewritingIndex, setRewritingIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Posted-aware state
  const [postedPosts, setPostedPosts] = useState<PostedPost[]>([]);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("medium");

  // Vault asset context (write-for-this-asset loop)
  const [assetCtx, setAssetCtx] = useState<AssetCtx | null>(null);

  // Make all formats state: per result index → generated formats
  const [allFormats, setAllFormats] = useState<Record<number, FormatResult[]>>({});
  const [makingAll, setMakingAll] = useState<number | null>(null);

  // Sticky mobile generate bar
  const generateBtnRef = useRef<HTMLButtonElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SENSITIVITY_KEY);
    if (stored === "low" || stored === "medium" || stored === "high") {
      setSensitivity(stored);
    }
  }, []);

  const changeSensitivity = (s: Sensitivity) => {
    setSensitivity(s);
    window.localStorage.setItem(SENSITIVITY_KEY, s);
  };

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
      if (preselectedId) {
        setSelectedId(preselectedId);
        setActivePersonaId(preselectedId);
      } else {
        // Default to the user's active voice when there is one.
        const active = getActivePersonaId();
        if (active && data?.some((p) => p.id === active)) setSelectedId(active);
        else if (data && data.length > 0) setSelectedId(data[0].id);
      }
    };
    load();
  }, [router, preselectedId]);

  // Load already-posted content for the selected persona (for repeat-avoidance)
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    const loadPosted = async () => {
      const { data } = await supabase
        .from("content_drafts")
        .select("id, content, created_at")
        .eq("persona_id", selectedId)
        .eq("posted", true)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!cancelled) setPostedPosts((data || []) as PostedPost[]);
    };
    loadPosted();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Welcome-back prefill: absence as content.
  useEffect(() => {
    if (isWelcomeBack) setTopic(WELCOME_PROMPT);
  }, [isWelcomeBack]);

  // Load vault asset context when arriving from "Write for this".
  useEffect(() => {
    if (!assetParam) return;
    let cancelled = false;

    const loadAsset = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("assets")
        .select("id, persona_id, type, url, content, tags")
        .eq("id", assetParam)
        .eq("user_id", user.id)
        .limit(1);

      const asset = (data || [])[0] as AssetCtx | undefined;
      if (!cancelled && asset) {
        setAssetCtx(asset);
        if (asset.persona_id) setSelectedId(asset.persona_id);
      }
    };
    loadAsset();

    return () => {
      cancelled = true;
    };
  }, [assetParam]);

  // Sticky bar: show when the main Generate button scrolls out of view
  useEffect(() => {
    const el = generateBtnRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selectedPersona = personas.find((p) => p.id === selectedId);

  // Live duplicate warning (debounced)
  const [similarPosts, setSimilarPosts] = useState<SimilarPost[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      setSimilarPosts(findSimilarPosts(topic, postedPosts, sensitivity));
    }, 350);
    return () => clearTimeout(t);
  }, [topic, postedPosts, sensitivity]);

  const saveDraft = async (content: string, contentType: string) => {
    if (!selectedPersona) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("content_drafts").insert({
        persona_id: selectedPersona.id,
        user_id: user.id,
        type: contentType,
        content,
      });
    }
  };

  const callGenerate = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Generation failed");
    return data.content as string;
  };

  const handleGenerate = async () => {
    if (!selectedPersona) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setAllFormats({});

    try {
      const allResults: string[] = [];

      for (let i = 0; i < variations; i++) {
        const content = await callGenerate({
          persona: selectedPersona,
          type,
          topic,
          model,
          postedContext: postedPosts,
          assetContext: assetCtx
            ? {
                type: assetCtx.type,
                tags: assetCtx.tags || [],
                content: assetCtx.content || "",
              }
            : undefined,
        });
        allResults.push(content);
        await saveDraft(content, type);
      }

      setResults(allResults);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickRewrite = async (index: number, instruction: string) => {
    if (!selectedPersona) return;
    setRewritingIndex(index);

    try {
      const content = await callGenerate({
        persona: selectedPersona,
        type,
        topic: `${instruction}\n\nOriginal:\n${results[index]}`,
        model,
      });

      const newResults = [...results];
      newResults[index] = content;
      setResults(newResults);
      await saveDraft(content, type);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRewritingIndex(null);
    }
  };

  const handleTransform = async (index: number, newType: string, instruction: string) => {
    if (!selectedPersona) return;
    setRewritingIndex(index);

    try {
      const content = await callGenerate({
        persona: selectedPersona,
        type: newType,
        topic: `${instruction}\n\nOriginal content:\n${results[index]}`,
        model,
      });

      const newResults = [...results];
      newResults[index] = content;
      setResults(newResults);
      await saveDraft(content, newType);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRewritingIndex(null);
    }
  };

  // One click → script + caption + image prompt, all in persona voice
  const handleMakeAllFormats = async (index: number) => {
    if (!selectedPersona || makingAll !== null) return;
    setMakingAll(index);
    setError(null);

    const jobs: { label: string; type: ContentType; instruction: string }[] = [
      {
        label: "Script",
        type: "script",
        instruction:
          "Turn this into a short video script (30-45 seconds) while keeping the exact same voice and message",
      },
      {
        label: "Caption",
        type: "caption",
        instruction:
          "Turn this into a strong social media caption while keeping the exact same voice and message",
      },
      {
        label: "Image prompt",
        type: "image_prompt",
        instruction:
          "Turn this into a detailed image generation prompt that matches the persona's world and the content",
      },
    ];

    try {
      const formats: FormatResult[] = [];
      // Sequential (not parallel): keeps preview LLM within rate limits and
      // gives users a stable order Script → Caption → Image prompt.
      for (const j of jobs) {
        try {
          const content = await callGenerate({
            persona: selectedPersona,
            type: j.type,
            topic: `${j.instruction}\n\nOriginal content:\n${results[index]}`,
            model,
          });
          formats.push({ label: j.label, type: j.type, content });
          await saveDraft(content, j.type);
        } catch {
          // One format failing shouldn't kill the others
        }
      }

      if (formats.length === 0) throw new Error("All transforms failed");
      setAllFormats((prev) => ({ ...prev, [index]: formats }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMakingAll(null);
    }
  };

  const handleCopyOnly = async (content: string, index: number) => {
    const ok = await copyToClipboard(content);
    if (ok) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 1500);
    }
  };

  const generateButton = (
    extraClass: string = "",
    ref?: RefObject<HTMLButtonElement | null>
  ) => (
    <button
      ref={ref}
      onClick={handleGenerate}
      disabled={loading || !selectedPersona}
      className={`w-full min-h-[52px] bg-white text-black font-medium rounded-xl hover:bg-zinc-200 disabled:opacity-50 text-base ${extraClass}`}
    >
      {loading
        ? `Generating ${variations > 1 ? variations + " variations" : "..."}`
        : "Generate"}
    </button>
  );

  return (
    <div className="min-h-screen p-4 sm:p-8 pb-28 sm:pb-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Generate Content</h1>
        </div>

        {/* First-run progress banner */}
        {isFirstRun && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 sm:p-5 mb-6">
            <p className="text-sm font-medium text-white mb-3">Your first post, in 3 steps</p>
            <ol className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-green-300">
                <span className="w-5 h-5 rounded-full bg-green-500/20 border border-green-600 flex items-center justify-center text-[10px]">✓</span>
                Persona created
              </li>
              <li className="flex items-center gap-2 text-white font-medium">
                <span className="w-5 h-5 rounded-full bg-white text-black flex items-center justify-center text-[10px]">2</span>
                Generate your first post ← you are here
              </li>
              <li className="flex items-center gap-2 text-zinc-400">
                <span className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px]">3</span>
                Copy &amp; open X or LinkedIn
              </li>
            </ol>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Persona</label>
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setActivePersonaId(e.target.value);
              }}
              className="w-full px-4 py-3 min-h-[48px] bg-zinc-900 border border-zinc-700 rounded-lg"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {selectedPersona && getActivePersonaId() === selectedPersona.id && (
              <p className="mt-2 text-xs text-green-400">● Active voice</p>
            )}
          </div>

          {/* Vault asset chip: the words will match this asset */}
          {assetCtx && (
            <div className="bg-zinc-900 border border-zinc-600 rounded-xl p-4 flex items-center gap-4">
              {assetCtx.type === "image" && assetCtx.url ? (
                <img src={assetCtx.url} alt="Vault asset" className="w-14 h-14 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 text-xl">
                  {assetCtx.type === "video" ? "🎬" : "📄"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">Writing for your vault asset</p>
                <p className="text-xs text-zinc-500 truncate">
                  {(assetCtx.tags || []).length > 0
                    ? `Tags: ${assetCtx.tags.map((t) => `#${t}`).join(" ")}`
                    : "Generation will pair the words with this asset"}
                </p>
              </div>
              <button
                onClick={() => setAssetCtx(null)}
                className="text-xs text-zinc-500 hover:text-white shrink-0"
              >
                Remove
              </button>
            </div>
          )}

          {/* Welcome-back chip */}
          {isWelcomeBack && !assetCtx && (
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
              <p className="text-sm font-medium text-amber-200">Come-back angle loaded</p>
              <p className="text-xs text-zinc-400 mt-1">
                The gap is the content. Topic is prefilled — edit it to match your actual week, then
                generate.
              </p>
            </div>
          )}

          {selectedPersona && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-400">
              <p className="font-medium text-zinc-200 mb-1">{selectedPersona.name}</p>
              <p className="line-clamp-2">{selectedPersona.backstory}</p>
            </div>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Content Type</label>
            <div className="flex flex-wrap gap-2">
              {(["caption", "script", "story_arc", "image_prompt"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-4 py-2 min-h-[40px] rounded-lg text-sm capitalize ${
                    type === t
                      ? "bg-white text-black"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {t.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-4 py-3 min-h-[48px] bg-zinc-900 border border-zinc-700 rounded-lg"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Variations</label>
              <select
                value={variations}
                onChange={(e) => setVariations(Number(e.target.value))}
                className="w-full px-4 py-3 min-h-[48px] bg-zinc-900 border border-zinc-700 rounded-lg"
              >
                <option value={1}>1 variation</option>
                <option value={2}>2 variations</option>
                <option value={3}>3 variations</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Topic / Context (optional)</label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. launching a new product, morning routine, mindset"
              className="w-full px-4 py-3 min-h-[48px] bg-zinc-900 border border-zinc-700 rounded-lg"
            />
          </div>

          {/* Live duplicate warning */}
          {similarPosts.length > 0 && (
            <div className="bg-amber-950/40 border border-amber-700/60 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-sm font-medium text-amber-300">
                  ⚠ Heads up — this is close to something you already posted
                </p>
                <div className="flex gap-1 shrink-0">
                  {(["low", "medium", "high"] as Sensitivity[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => changeSensitivity(s)}
                      title={`${sensitivityLabel(s)} sensitivity`}
                      className={`text-[10px] px-2 py-1 rounded border ${
                        sensitivity === s
                          ? "bg-amber-300 text-black border-amber-300"
                          : "border-amber-800 text-amber-400 hover:bg-amber-900/40"
                      }`}
                    >
                      {sensitivityLabel(s)}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="space-y-1.5">
                {similarPosts.map(({ post, score }) => (
                  <li key={post.id} className="text-xs text-amber-200/90 leading-relaxed">
                    <span className="text-amber-400">
                      {formatPostedDate(post.created_at)} ({Math.round(score * 100)}% match):
                    </span>{" "}
                    “{post.content.replace(/\s+/g, " ").slice(0, 110)}
                    {post.content.length > 110 ? "…" : ""}”
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-500/80 mt-2">
                Generation will automatically steer toward a fresh angle.
              </p>
            </div>
          )}

          {postedPosts.length > 0 && similarPosts.length === 0 && (
            <p className="text-xs text-zinc-500">
              Posted-aware mode: generation avoids repeating your {postedPosts.length} posted{" "}
              {postedPosts.length === 1 ? "item" : "items"}.
            </p>
          )}

          {generateButton("", generateBtnRef)}

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {results.map((result, idx) => (
            <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 sm:p-6">
              <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                <h3 className="font-medium">
                  {results.length > 1 ? `Variation ${idx + 1}` : "Result"}
                  {isFirstRun && idx === 0 && (
                    <span className="ml-2 text-xs text-green-400 font-normal">
                      Draft saved — last step: post it
                    </span>
                  )}
                </h3>
                {copiedIndex === idx && (
                  <span className="text-xs text-green-400">Copied ✓</span>
                )}
              </div>

              <pre className="whitespace-pre-wrap text-zinc-200 text-sm leading-relaxed mb-4">
                {rewritingIndex === idx ? "Working..." : result}
              </pre>

              {/* Copy & open platform — the one-tap handoff */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                <button
                  onClick={() => copyAndOpen(result, "twitter")}
                  className="min-h-[46px] px-4 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
                >
                  Copy &amp; open X
                </button>
                <button
                  onClick={() => copyAndOpen(result, "linkedin")}
                  className="min-h-[46px] px-4 bg-[#0a66c2] text-white rounded-lg text-sm font-medium hover:bg-[#004182]"
                >
                  Copy &amp; open LinkedIn
                </button>
                <button
                  onClick={() => handleCopyOnly(result, idx)}
                  className="min-h-[46px] px-4 border border-zinc-600 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {copiedIndex === idx ? "Copied ✓" : "Copy only"}
                </button>
              </div>

              {/* Quick actions */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-zinc-800">
                <button
                  onClick={() => handleMakeAllFormats(idx)}
                  disabled={makingAll === idx || rewritingIndex === idx}
                  className="text-xs px-3 py-2 min-h-[38px] bg-zinc-800 border border-zinc-600 rounded-lg font-medium hover:bg-zinc-700 disabled:opacity-50"
                >
                  {makingAll === idx ? "Making all formats..." : "⚡ Make all formats"}
                </button>
                <button
                  onClick={() => handleQuickRewrite(idx, "Make this shorter and punchier")}
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  Shorter
                </button>
                <button
                  onClick={() => handleQuickRewrite(idx, "Make this longer and more detailed")}
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  Longer
                </button>
                <button
                  onClick={() =>
                    handleQuickRewrite(idx, "Make this more aggressive and high-energy")
                  }
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  More Punch
                </button>
                <button
                  onClick={() =>
                    handleTransform(
                      idx,
                      "script",
                      "Turn this into a short video script (30-45 seconds) while keeping the exact same voice and message"
                    )
                  }
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Script
                </button>
                <button
                  onClick={() =>
                    handleTransform(
                      idx,
                      "caption",
                      "Turn this into a strong social media caption while keeping the exact same voice and message"
                    )
                  }
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Caption
                </button>
                <button
                  onClick={() =>
                    handleTransform(
                      idx,
                      "image_prompt",
                      "Turn this into a detailed image generation prompt that matches the persona's world and the content"
                    )
                  }
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Image Prompt
                </button>
              </div>

              {/* Make-all-formats results */}
              {allFormats[idx] && (
                <div className="mt-4 pt-4 border-t border-zinc-800 space-y-4">
                  <p className="text-xs text-green-400 font-medium">
                    All formats ready — each one is saved to Drafts
                  </p>
                  {allFormats[idx].map((f) => (
                    <div key={f.label} className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wide text-zinc-400 font-medium">
                          {f.label}
                        </span>
                        <div className="flex gap-3">
                          <button
                            onClick={() => copyAndOpen(f.content, "twitter")}
                            className="text-xs text-white font-medium hover:text-zinc-300"
                          >
                            Copy &amp; open X
                          </button>
                          <button
                            onClick={() => copyAndOpen(f.content, "linkedin")}
                            className="text-xs text-[#4a9ede] hover:text-[#7db8e8]"
                          >
                            LinkedIn
                          </button>
                        </div>
                      </div>
                      <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                        {f.content}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Sticky mobile generate bar */}
      {showStickyBar && (
        <div
          className="fixed bottom-0 inset-x-0 sm:hidden bg-zinc-950/95 backdrop-blur border-t border-zinc-800 p-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          {generateButton("shadow-lg")}
        </div>
      )}
    </div>
  );
}

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400">Loading...</div>
      }
    >
      <GenerateContent />
    </Suspense>
  );
}
