"use client";

import { useEffect, useMemo, useState, useRef, Suspense, type RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, authedFetch } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { copyAndOpen, copyToClipboard, type Platform } from "@/lib/share";
import { getActivePersonaId, setActivePersonaId } from "@/lib/activePersona";
import {
  findSimilarPosts,
  formatPostedDate,
  sensitivityLabel,
  type PostedPost,
  type Sensitivity,
  type SimilarPost,
} from "@/lib/duplicate";
import { extractVoiceFingerprint } from "@/lib/voice";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import type { VariantResult } from "@/lib/generation";
import ThreadComposer from "@/components/ThreadComposer";

/**
 * Models VERIFIED against the live OpenRouter catalog (2026-09).
 * The old pills (openai/gpt-4o-mini, anthropic/claude-3.5-haiku,
 * google/gemini-flash-1.5) 404 or are region-blocked — every request
 * burned two retries then degraded to the built-in model (rate-limited),
 * which is what made Generate return junk or nothing.
 */
const MODELS = [
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B (Best)" },
  { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3 (Smart)" },
  { id: "mistralai/mistral-small-24b-instruct-2501", name: "Mistral Small 24B" },
  { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B (Fast)" },
];

const SENSITIVITY_KEY = "persona-os-dup-sensitivity";

type ContentType = "caption" | "script" | "story_arc" | "image_prompt";

const PLATFORM_TABS: { id: PlatformId; label: string; hint: string }[] = [
  { id: "x", label: "X", hint: "280 chars, thread-aware" },
  { id: "linkedin", label: "LinkedIn", hint: "first 210 chars decide it" },
  { id: "instagram", label: "Instagram", hint: "caption + Reels" },
  { id: "threads", label: "Threads", hint: "casual, 500 chars" },
  { id: "tiktok", label: "TikTok", hint: "15–30s scripts + SEO captions" },
  { id: "youtube_shorts", label: "Shorts", hint: "30–45s + title ≤100" },
];

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
    "I've been away from posting for a while. Write a come-back post that owns the gap honestly and turns it into the point of the post.";

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [type, setType] = useState<ContentType>("caption");
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState("meta-llama/llama-3.3-70b-instruct");
  const [variantCount, setVariantCount] = useState(3);
  const [platform, setPlatform] = useState<PlatformId>("x");
  const [results, setResults] = useState<VariantResult[]>([]);
  const [fingerprintMeta, setFingerprintMeta] = useState<{ used: boolean; samples: number; summary: string; source?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadStage, setLoadStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rewritingIndex, setRewritingIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  // High polish: editor pass that tightens hooks and cuts flab (default ON)
  const [highPolish, setHighPolish] = useState(true);
  // "3 more of this one": grouped follow-up variants per result card
  const [moreResults, setMoreResults] = useState<Record<number, VariantResult[]>>({});
  const [goldSavedIdx, setGoldSavedIdx] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState<number | null>(null);
  // One idea -> every platform
  const [platformResults, setPlatformResults] = useState<{ platform: PlatformId; variant: VariantResult }[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  // Image prompt -> rendered image (preview + save to vault)
  const [renderedImages, setRenderedImages] = useState<Record<number, string>>({});
  const [loadingRender, setLoadingRender] = useState<number | null>(null);
  const [savedToVault, setSavedToVault] = useState<Record<number, boolean>>({});

  // Posted-aware state
  const [postedPosts, setPostedPosts] = useState<PostedPost[]>([]);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("medium");

  // Voice DNA samples: this persona's real drafts + posted writing
  const [voiceSamples, setVoiceSamples] = useState<string[]>([]);

  // Vault asset context (write-for-this-asset loop)
  const [assetCtx, setAssetCtx] = useState<AssetCtx | null>(null);

  // Make all formats state: per result index → generated formats
  const [allFormats, setAllFormats] = useState<Record<number, FormatResult[]>>({});
  const [makingAll, setMakingAll] = useState<number | null>(null);

  // Inline character check: verdict chip on the card, no navigation needed.
  const [checkingIdx, setCheckingIdx] = useState<number | null>(null);
  const [checkResults, setCheckResults] = useState<
    Record<
      string,
      { score: number; verdict: string; breaks: { quote: string; why: string; fix: string }[] }
    >
  >({});

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
        const active = getActivePersonaId();
        if (active && data?.some((p) => p.id === active)) setSelectedId(active);
        else if (data && data.length > 0) setSelectedId(data[0].id);
      }
    };
    load();
  }, [router, preselectedId]);

  // Load posted content (repeat-avoidance) AND all drafts (voice samples)
  // for the selected persona in one go.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    const load = async () => {
      const [{ data: posted }, { data: drafts }] = await Promise.all([
        supabase
          .from("content_drafts")
          .select("id, content, created_at")
          .eq("persona_id", selectedId)
          .eq("posted", true)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("content_drafts")
          .select("content")
          .eq("persona_id", selectedId)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      if (cancelled) return;
      setPostedPosts((posted || []) as PostedPost[]);
      setVoiceSamples((drafts || []).map((d: { content: string }) => d.content).filter(Boolean));
    };
    load();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedPersona = personas.find((p) => p.id === selectedId);

  // Curated gold set takes priority; drafts are the fallback voice source.
  const goldSamples = useMemo(
    () =>
      (selectedPersona?.voice_samples || ([] as unknown[])).filter(
        (s): s is { id: string; text: string; enabled: boolean } =>
          !!s && typeof s === "object" && typeof (s as { text?: unknown }).text === "string"
      ).filter((s) => s.enabled && s.text.trim().length > 20).map((s) => s.text),
    [selectedPersona]
  );
  const voiceSource = useMemo(
    () => (goldSamples.length ? goldSamples : voiceSamples),
    [goldSamples, voiceSamples]
  );

  // Client-side Voice DNA preview — instant, before any generation.
  const localFingerprint = useMemo(
    () => extractVoiceFingerprint(voiceSource),
    [voiceSource]
  );

  // Welcome-back prefill
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

  // Loading stage rotation
  useEffect(() => {
    if (!loading) {
      setLoadStage(0);
      return;
    }
    const stages = [
      "Reading their voice…",
      `Writing ${variantCount > 1 ? `${variantCount} variants` : "your draft"}…`,
      "Quality pass — scrubbing clichés, checking platform fit…",
      "Ranking by voice match…",
    ];
    const t = setInterval(() => setLoadStage((s) => (s + 1) % stages.length), 1800);
    return () => clearInterval(t);
  }, [loading, variantCount]);

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

  
  const handleSaveToGold = async (index: number) => {
    if (!selectedPersona) return;
    const content = results[index]?.content?.trim();
    if (!content || content.length < 20) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const existing = Array.isArray(selectedPersona.voice_samples)
      ? selectedPersona.voice_samples
      : [];
    // Dedupe by near-exact text
    if (existing.some((s) => (s.text || "").trim() === content)) {
      setGoldSavedIdx(index);
      return;
    }
    const sample = {
      id: `gold-${Date.now()}`,
      text: content.slice(0, 2000),
      source: "curated" as const,
      enabled: true,
      addedAt: new Date().toISOString(),
    };
    const next = [...existing, sample].slice(-40);
    const { error } = await supabase
      .from("personas")
      .update({ voice_samples: next })
      .eq("id", selectedPersona.id)
      .eq("user_id", user.id);
    if (error) {
      setError(error.message || "Could not save to gold set");
      return;
    }
    setPersonas((prev) =>
      prev.map((p) =>
        p.id === selectedPersona.id ? { ...p, voice_samples: next } : p
      )
    );
    setGoldSavedIdx(index);
  };

const buildBody = (extra: Record<string, unknown> = {}) => ({
    persona: selectedPersona,
    type,
    topic,
    model,
    platform,
    voiceSamples,
    goldSamples: goldSamples.length ? goldSamples : undefined,
    postedContext: postedPosts,
    polish: highPolish,
    assetContext: assetCtx
      ? { type: assetCtx.type, tags: assetCtx.tags || [], content: assetCtx.content || "" }
      : undefined,
    ...extra,
  });

  const postGenerate = async (body: Record<string, unknown>) => {
    const res = await authedFetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Generation failed");
    return data;
  };

  const handleGenerate = async () => {
    if (!selectedPersona) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setAllFormats({});
    setMoreResults({});
    setPlatformResults([]);

    try {
      const data = await postGenerate(buildBody({ variants: variantCount }));
      setFingerprintMeta(data.fingerprint || null);
      setResults(data.variants as VariantResult[]);
      for (const v of data.variants as VariantResult[]) {
        await saveDraft(v.content, type);
      }
      if (data.degraded) {
        setError(`${data.failed} of ${variantCount} variants failed to generate — showing the ones that made it.`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  // "3 more of this one": the user flagged a winner — generate 3 fresh
  // variations of THAT post, avoiding the original and each other.
  const handleMoreLike = async (index: number) => {
    if (!selectedPersona || !results[index] || loadingMore !== null) return;
    setLoadingMore(index);
    setError(null);
    const winner = results[index].content;
    const avoid = [
      ...results.map((r) => r.content),
      ...(moreResults[index] || []).map((r) => r.content),
    ].filter((c) => c !== winner);
    try {
      const data = await postGenerate(
        buildBody({ variants: 3, moreLike: { original: winner, avoid } })
      );
      const fresh = (data.variants as VariantResult[]).filter(
        (v) => v.content !== winner
      );
      setMoreResults((prev) => ({ ...prev, [index]: [...(prev[index] || []), ...fresh] }));
      for (const v of fresh) {
        await saveDraft(v.content, type);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't generate more like this");
    } finally {
      setLoadingMore(null);
    }
  };

  // One idea -> every platform, formatted natively for each.
  const handleAllPlatforms = async () => {
    if (!selectedPersona || loadingPlatforms) return;
    setLoadingPlatforms(true);
    setError(null);
    try {
      const jobs: PlatformId[] = ["x", "linkedin", "instagram", "threads", "tiktok", "youtube_shorts"];
      const settled = await Promise.allSettled(
        jobs.map((p) => postGenerate(buildBody({ platform: p, variants: 1 })))
      );
      const out: { platform: PlatformId; variant: VariantResult }[] = [];
      for (let i = 0; i < jobs.length; i++) {
        const s = settled[i];
        if (s.status === "fulfilled") {
          const v = (s.value.variants as VariantResult[])[0];
          if (v) {
            out.push({ platform: jobs[i], variant: v });
            await saveDraft(v.content, type);
          }
        }
      }
      if (!out.length) throw new Error("Couldn't generate for any platform");
      setPlatformResults(out);
      const failedCount = jobs.length - out.length;
      if (failedCount) setError(`${failedCount} platform${failedCount > 1 ? "s" : ""} failed — showing the ones that made it.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "All-platforms generation failed");
    } finally {
      setLoadingPlatforms(false);
    }
  };

  // Undo a quality-gate scrub: restore the author's original wording.
  const handleUndoScrub = (index: number) => {
    const v = results[index];
    if (!v?.original) return;
    const next = [...results];
    next[index] = { ...v, content: v.original, original: undefined };
    setResults(next);
  };

  // "Does this break character?" — inline on the card, same engine as
  // the /check page (deterministic quality pre-passes + LLM judgment).
  const handleInlineCheck = async (index: number, text: string, key: string) => {
    if (!selectedPersona || checkingIdx !== null) return;
    setCheckingIdx(index);
    try {
      const res = await authedFetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          text: text.slice(0, 2000),
          voiceSamples: voiceSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed");
      setCheckResults((prev) => ({
        ...prev,
        [key]: {
          score: data.score,
          verdict: data.verdict,
          breaks: (data.breaks || []).slice(0, 3),
        },
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setCheckingIdx(null);
    }
  };

  // Render an image prompt into an actual image.
  const handleRenderImage = async (index: number) => {
    if (!results[index] || loadingRender !== null) return;
    setLoadingRender(index);
    setError(null);
    try {
      const res = await authedFetch("/api/render-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: results[index].content,
          visualStyle: selectedPersona?.visual_style || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Image render failed");
      setRenderedImages((prev) => ({ ...prev, [index]: data.image }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Image render failed");
    } finally {
      setLoadingRender(null);
    }
  };

  // Save a rendered image into the Asset Vault.
  const handleSaveToVault = async (index: number) => {
    const dataUrl = renderedImages[index];
    if (!dataUrl || !selectedPersona) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `rendered-${Date.now()}.png`, { type: "image/png" });
      // Storage is tenant-scoped server-side: keys MUST live under
      // assets/<user-id>/ — persona ids are not user ids.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const fileName = `${user.id}/rendered-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from("assets")
        .upload(fileName, file);
      if (uploadError) throw new Error(uploadError.message);
      const { data: urlData } = supabase.storage.from("assets").getPublicUrl(fileName);
      await supabase.from("assets").insert({
        persona_id: selectedPersona.id,
        user_id: user.id,
        type: "image",
        url: urlData.publicUrl,
        content: topic || "",
        tags: ["rendered", "generated"],
      });
      setSavedToVault((prev) => ({ ...prev, [index]: true }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't save to Vault");
    }
  };

  // Regenerate ONE card in place (keeps the others). Rotates the structural
  // strategy so "regenerate" never repeats the same architecture twice.
  const handleRegenerate = async (index: number) => {
    if (!selectedPersona) return;
    setRewritingIndex(index);
    try {
      const data = await postGenerate(
        buildBody({ variants: 1, strategyOffset: Math.floor(Math.random() * 4) })
      );
      const fresh = (data.variants as VariantResult[])[0];
      if (fresh) {
        const next = [...results];
        next[index] = fresh;
        setResults(next);
        await saveDraft(fresh.content, type);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setRewritingIndex(null);
    }
  };

  const handleQuickRewrite = async (index: number, instruction: string) => {
    if (!selectedPersona || !results[index]) return;
    setRewritingIndex(index);
    try {
      const data = await postGenerate(
        buildBody({ variants: 1, rewrite: { original: results[index].content, instruction } })
      );
      const fresh = (data.variants as VariantResult[])[0];
      if (fresh) {
        const next = [...results];
        next[index] = fresh;
        setResults(next);
        await saveDraft(fresh.content, type);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setRewritingIndex(null);
    }
  };

  const handleTransform = async (index: number, newType: ContentType, instruction: string) => {
    if (!selectedPersona || !results[index]) return;
    setRewritingIndex(index);
    try {
      const res = await authedFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          type: newType,
          model,
          platform,
          voiceSamples,
          variants: 1,
          rewrite: { original: results[index].content, instruction },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transform failed");
      const fresh = (data.variants as VariantResult[])[0];
      if (fresh) {
        const next = [...results];
        next[index] = { ...fresh, hookType: `→ ${newType.replace("_", " ")}` };
        setResults(next);
        await saveDraft(fresh.content, newType);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Transform failed");
    } finally {
      setRewritingIndex(null);
    }
  };

  const handleMakeAllFormats = async (index: number) => {
    if (!selectedPersona || makingAll !== null || !results[index]) return;
    setMakingAll(index);
    setError(null);

    const jobs: { label: string; type: ContentType; instruction: string }[] = [
      { label: "Script", type: "script", instruction: "Turn this into a short video script (30-45 seconds) keeping the exact same voice and message" },
      { label: "Caption", type: "caption", instruction: "Turn this into a strong social media caption keeping the exact same voice and message" },
      { label: "Image prompt", type: "image_prompt", instruction: "Turn this into a detailed image generation prompt that matches the persona's world and this content" },
    ];

    try {
      const formats: FormatResult[] = [];
      for (const j of jobs) {
        try {
          const data = await postGenerate(
            buildBody({ type: j.type, variants: 1, rewrite: { original: results[index].content, instruction: j.instruction } })
          );
          const fresh = (data.variants as VariantResult[])[0];
          if (fresh) {
            formats.push({ label: j.label, type: j.type, content: fresh.content });
            await saveDraft(fresh.content, j.type);
          }
        } catch {
          // one format failing shouldn't kill the others
        }
      }
      if (formats.length === 0) throw new Error("All transforms failed");
      setAllFormats((prev) => ({ ...prev, [index]: formats }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Transform failed");
    } finally {
      setMakingAll(null);
    }
  };

  const handleCopyOnly = async (content: string, key: string) => {
    const ok = await copyToClipboard(content);
    if (ok) {
      setCopiedIndex(key);
      setTimeout(() => setCopiedIndex((c) => (c === key ? null : c)), 1500);
    }
  };

  const sharePlatform: Record<PlatformId, Platform> = {
    x: "twitter",
    linkedin: "linkedin",
    instagram: "instagram",
    threads: "threads",
    tiktok: "tiktok",
    youtube_shorts: "youtube_shorts",
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
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          {["Reading their voice…", "Writing…", "Quality pass…", "Ranking…"][loadStage % 4]}
        </span>
      ) : (
        `Generate ${variantCount > 1 ? `${variantCount} variants` : ""}`
      )}
    </button>
  );

  return (
    <div className="min-h-screen p-4 sm:p-8 pb-28 sm:pb-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <a href="/dashboard/posts" className="text-sm text-zinc-400 hover:text-white ml-3">
            Posts
          </a>
          <div className="flex items-center gap-3">
            <a
              href="/dashboard/generate"
              className="text-xs px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
              title="Chat with the autonomous agent (research + schedule + vault)"
            >
              ✦ Agent mode
            </a>
            <h1 className="text-2xl font-bold">Studio</h1>
          </div>
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

          {/* Voice DNA preview — measured from their real drafts */}
          {selectedPersona && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-200">{selectedPersona.name}</p>
                  <p className="text-xs text-zinc-500 line-clamp-1">{selectedPersona.backstory}</p>
                </div>
                <span
                  className={`shrink-0 text-[10px] px-2 py-1 rounded-full border ${
                    goldSamples.length >= 3
                      ? "border-emerald-500 text-emerald-300 bg-emerald-950/40"
                      : localFingerprint.samples >= 3
                        ? "border-emerald-700 text-emerald-400 bg-emerald-950/40"
                        : "border-zinc-700 text-zinc-500"
                  }`}
                  title={
                    goldSamples.length >= 3
                      ? "Learning from the curated Gold Set"
                      : localFingerprint.samples >= 3
                        ? "Learned from this persona's drafts — curate a Gold Set to lock it"
                        : "Add 3+ samples to lock the voice"
                  }
                >
                  {goldSamples.length >= 3
                    ? `GOLD SET ✓ ${goldSamples.length}`
                    : localFingerprint.samples >= 3
                      ? "VOICE DNA ✓"
                      : "VOICE DNA: LEARNING"}
                </span>
              </div>
              {localFingerprint.samples > 0 && (
                <p className="mt-2 text-[11px] text-zinc-500">
                  {localFingerprint.sentenceSpread} rhythm · ~{localFingerprint.avgSentenceWords} words/sentence ·{" "}
                  {localFingerprint.emojiPer100 >= 0.5 ? "uses emoji" : "no emoji"} · {localFingerprint.casing} casing
                  {localFingerprint.topEmojis.length ? ` · ${localFingerprint.topEmojis.join("")}` : ""}
                </p>
              )}
            </div>
          )}

          {/* Vault asset chip */}
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

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Where is this going?</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PLATFORM_TABS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  title={p.hint}
                  className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium ${
                    platform === p.id
                      ? "bg-white text-black"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {PLATFORMS[platform].name}: {PLATFORMS[platform].limit} char limit · formatted natively ·
              over-limit posts become ready-to-paste threads
            </p>
          </div>

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

            {type === "story_arc" && (
              <p className="text-xs text-zinc-500 mt-2">
                For full arc structures (setup/payoff, confession, list deep-dives), use the{" "}
                <a href={`/dashboard/series?persona=${selectedId}`} className="text-emerald-400 underline">
                  Series planner
                </a>
                .
              </p>
            )}

            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <label className="block text-sm text-zinc-400 mb-2">Variants</label>
              <select
                value={variantCount}
                onChange={(e) => setVariantCount(Number(e.target.value))}
                className="w-full px-4 py-3 min-h-[48px] bg-zinc-900 border border-zinc-700 rounded-lg"
              >
                <option value={1}>1 variant (fastest)</option>
                <option value={2}>2 variants</option>
                <option value={3}>3 variants — different structures</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Quality</label>
              <button
                onClick={() => setHighPolish(!highPolish)}
                title="An editor pass re-checks every draft: tighter hooks, less flab, zero generic lines"
                className={`w-full px-4 py-3 min-h-[48px] rounded-lg text-sm font-medium border flex items-center justify-between ${
                  highPolish
                    ? "bg-emerald-950/40 border-emerald-700 text-emerald-300"
                    : "bg-zinc-900 border-zinc-700 text-zinc-400"
                }`}
              >
                <span>High polish</span>
                <span
                  className={`w-10 h-6 rounded-full relative transition shrink-0 ${highPolish ? "bg-emerald-600" : "bg-zinc-700"}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${highPolish ? "left-[18px]" : "left-0.5"}`}
                  />
                </span>
              </button>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {generateButton("", generateBtnRef)}
            <button
              onClick={handleAllPlatforms}
              disabled={loadingPlatforms || loading || !selectedPersona || !topic.trim()}
              title="Generate this idea for X, LinkedIn, Instagram and Threads — each formatted natively"
              className="min-h-[52px] px-4 border border-zinc-600 text-zinc-200 font-medium rounded-xl hover:bg-zinc-800 disabled:opacity-50 text-sm"
            >
              {loadingPlatforms ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
                  Writing for all platforms…
                </span>
              ) : (
                "⇄ All platforms"
              )}
            </button>
            <a
              href={`/dashboard/personas/${selectedId}`}
              className="min-h-[52px] px-4 border border-zinc-800 text-zinc-400 rounded-xl hover:bg-zinc-900 text-sm flex items-center justify-center"
            >
              Tune their voice →
            </a>
          </div>

          {error && (
            <div className="p-4 bg-amber-950/40 border border-amber-700 rounded-lg text-amber-200 text-sm">
              {error}
            </div>
          )}

          {/* Ranked variant cards */}
          {results.map((variant, idx) => (
            <div
              key={idx}
              className={`bg-zinc-900 border rounded-xl p-5 sm:p-6 ${
                variant.rank === 1 && results.length > 1 ? "border-emerald-700/60" : "border-zinc-800"
              }`}
            >
              <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium">
                    {results.length > 1 ? `#${variant.rank} · ${variant.hookType}` : variant.hookType}
                  </h3>
                  {variant.rank === 1 && results.length > 1 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-400">
                      BEST MATCH
                    </span>
                  )}
                  {variant.polished && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full bg-sky-950 border border-sky-800 text-sky-400"
                      title="The editor pass tightened this draft"
                    >
                      POLISHED
                    </span>
                  )}
                  {isFirstRun && idx === 0 && (
                    <span className="text-xs text-green-400 font-normal">
                      Draft saved — last step: post it
                    </span>
                  )}
                </div>
                {copiedIndex === String(idx) && <span className="text-xs text-green-400">Copied ✓</span>}
              </div>

              {/* Quality strip: voice match · length · fit */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 mb-3">
                {fingerprintMeta?.used && (
                  <span
                    className={
                      variant.voiceMatch >= 70
                        ? "text-emerald-400"
                        : variant.voiceMatch >= 55
                          ? "text-zinc-400"
                          : "text-amber-400"
                    }
                    title={variant.voiceNote}
                  >
                    Voice match {variant.voiceMatch}%
                  </span>
                )}
                <span>{variant.wordCount} words</span>
                <span className={variant.fit.fits ? "" : "text-amber-400"}>
                  {variant.fit.length}/{variant.fit.limit} chars{variant.fit.fits ? "" : ` (${variant.fit.overBy} over)`}
                </span>
                {variant.repetition.score >= 35 && (
                  <span className="text-amber-400" title={variant.repetition.against || ""}>
                    {variant.repetition.score}% similar to a posted post
                  </span>
                )}
                {variant.packaging && (
                  <span
                    className={
                      variant.packaging.score >= 75
                        ? "text-emerald-400"
                        : variant.packaging.score >= 55
                          ? "text-zinc-400"
                          : "text-amber-400"
                    }
                    title={(variant.packaging.notes || []).join(" · ") || "First-line packaging strength"}
                  >
                    Packaging {variant.packaging.score}%
                  </span>
                )}
              </div>

              {variant.flags.length > 0 && (
                <div className="mb-3 space-y-1">
                  {variant.flags.map((f, i) => (
                    <p key={i} className="text-[11px] text-amber-500/90">⚑ {f}</p>
                  ))}
                </div>
              )}

              
              {variant.packaging && variant.packaging.score < 55 && (
                <p className="text-[11px] text-amber-500/90 mb-3">
                  Packaging tip: {(variant.packaging.notes && variant.packaging.notes[0])
                    ? variant.packaging.notes[0].replace("slop:", "").replace(/-/g, " ")
                    : "sharpen the first line — it has to work alone before the fold"}. Try{" "}
                  <button
                    type="button"
                    className="underline hover:text-amber-300"
                    onClick={() => handleMoreLike(idx)}
                  >
                    3 packaging remixes
                  </button>
                  .
                </p>
              )}

              <pre className="whitespace-pre-wrap text-zinc-200 text-sm leading-relaxed mb-1">
                {rewritingIndex === idx ? "Working…" : variant.content}
              </pre>
              <p className="text-[11px] text-zinc-600 mb-4">{variant.why}</p>

              {/* Over-limit: platform-aware thread composer (editable per-post) */}
              {!variant.fit.fits && (
                <div className="mb-4">
                  <ThreadComposer
                    key={`${idx}-${variant.content.slice(0, 64)}`}
                    content={variant.content}
                    platform={platform}
                  />
                </div>
              )}

              {/* Copy & open — matched to the selected platform */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                <button
                  onClick={() => copyAndOpen(variant.content, sharePlatform[platform])}
                  className="min-h-[46px] px-4 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
                >
                  Copy &amp; open {PLATFORMS[platform].name}
                </button>
                <button
                  onClick={() => copyAndOpen(variant.content, platform === "linkedin" ? "twitter" : "linkedin")}
                  className="min-h-[46px] px-4 border border-zinc-600 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Open {platform === "linkedin" ? "X" : "LinkedIn"} instead
                </button>
                <button
                  onClick={() => handleCopyOnly(variant.content, String(idx))}
                  className="min-h-[46px] px-4 border border-zinc-600 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {copiedIndex === String(idx) ? "Copied ✓" : "Copy only"}
                </button>
              </div>

              {/* Quick actions */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-zinc-800">
                <button
                  onClick={() => handleMoreLike(idx)}
                  disabled={loadingMore !== null || rewritingIndex === idx || makingAll === idx}
                  title="3 fresh variations of THIS post — same idea, new angles"
                  className="text-xs px-3 py-2 min-h-[38px] bg-white text-black rounded-lg font-medium hover:bg-zinc-200 disabled:opacity-50"
                >
                  {loadingMore === idx ? "Writing 3 more…" : "⊕ 3 more of this one"}
                </button>
                <button
                  onClick={() => handleSaveToGold(idx)}
                  className="min-h-[46px] px-4 border border-emerald-800/60 rounded-lg text-sm text-emerald-400 hover:bg-emerald-950/40"
                  title="Add this draft to the persona gold voice set so future posts match this energy"
                >
                  {goldSavedIdx === idx ? "Saved to gold ✓" : "Save to gold voice"}
                </button>
                <button
                  onClick={() => handleRegenerate(idx)}
                  disabled={rewritingIndex === idx || makingAll === idx || loadingMore === idx}
                  className="text-xs px-3 py-2 min-h-[38px] bg-zinc-800 border border-zinc-600 rounded-lg font-medium hover:bg-zinc-700 disabled:opacity-50"
                >
                  ↻ Regenerate
                </button>
                {variant.original && (
                  <button
                    onClick={() => handleUndoScrub(idx)}
                    title="Restore the wording before the automatic scrub"
                    className="text-xs px-3 py-2 min-h-[38px] border border-amber-700 text-amber-400 rounded hover:bg-amber-950/40"
                  >
                    ↩ Undo scrub
                  </button>
                )}
                <button
                  onClick={() => handleMakeAllFormats(idx)}
                  disabled={makingAll === idx || rewritingIndex === idx}
                  className="text-xs px-3 py-2 min-h-[38px] bg-zinc-800 border border-zinc-600 rounded-lg font-medium hover:bg-zinc-700 disabled:opacity-50"
                >
                  {makingAll === idx ? "Making all formats..." : "⚡ Make all formats"}
                </button>
                <button
                  onClick={() =>
                    checkResults[String(idx)]
                      ? setCheckResults((prev) => {
                          const next = { ...prev };
                          delete next[String(idx)];
                          return next;
                        })
                      : handleInlineCheck(idx, variant.content, String(idx))
                  }
                  disabled={checkingIdx === idx || rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  {checkingIdx === idx
                    ? "Checking…"
                    : checkResults[String(idx)]
                      ? "✓ Hide check"
                      : "✓ Check it"}
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
                  onClick={() => handleQuickRewrite(idx, "Make this more aggressive and high-energy")}
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  More Punch
                </button>
                <button
                  onClick={() => handleTransform(idx, "script", "Turn this into a short video script (30-45 seconds) keeping the exact same voice and message")}
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Script
                </button>
                <button
                  onClick={() => handleTransform(idx, "caption", "Turn this into a strong social media caption keeping the exact same voice and message")}
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Caption
                </button>
                <button
                  onClick={() => handleTransform(idx, "image_prompt", "Turn this into a detailed image generation prompt that matches the persona's world and this content")}
                  disabled={rewritingIndex === idx || makingAll === idx}
                  className="text-xs px-2.5 py-2 min-h-[38px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  → Image Prompt
                </button>
              </div>

              {/* Inline check verdict — same engine as the full Check page */}
              {checkResults[String(idx)] && (
                <div
                  className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                    checkResults[String(idx)].verdict === "Safe to post"
                      ? "border-green-800 bg-green-950/30 text-green-200"
                      : checkResults[String(idx)].verdict === "Needs changes"
                        ? "border-amber-800 bg-amber-950/30 text-amber-200"
                        : "border-red-800 bg-red-950/30 text-red-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {checkResults[String(idx)].verdict} ·{" "}
                      {checkResults[String(idx)].score}/100 in character
                    </span>
                    <a
                      href={`/dashboard/check?persona=${selectedPersona?.id || ""}&text=${encodeURIComponent(variant.content.slice(0, 2000))}`}
                      className="underline opacity-80 hover:opacity-100"
                    >
                      Full report
                    </a>
                  </div>
                  {checkResults[String(idx)].breaks.map((b, bi) => (
                    <p key={bi} className="opacity-90">
                      <span className="font-medium">“{b.quote}”</span>
                      {b.why ? ` — ${b.why}` : ""}
                      {b.fix ? ` Fix: ${b.fix}` : ""}
                    </p>
                  ))}
                </div>
              )}

              {/* Render image: image prompts become actual images */}
              {(type === "image_prompt" || /image prompt/i.test(variant.hookType || "")) && (
                <div className="mb-4">
                  {!renderedImages[idx] ? (
                    <button
                      onClick={() => handleRenderImage(idx)}
                      disabled={loadingRender !== null}
                      className="min-h-[46px] px-4 w-full sm:w-auto border border-zinc-600 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {loadingRender === idx ? "Rendering image… (up to 2 min)" : "🖼 Render this image"}
                    </button>
                  ) : (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                      <img
                        src={renderedImages[idx]}
                        alt="Rendered from the image prompt"
                        className="w-full max-w-sm rounded-lg mb-3"
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        {savedToVault[idx] ? (
                          <span className="text-xs text-green-400">Saved to your Asset Vault ✓</span>
                        ) : (
                          <button
                            onClick={() => handleSaveToVault(idx)}
                            className="min-h-[40px] px-4 bg-white text-black rounded-lg text-xs font-medium hover:bg-zinc-200"
                          >
                            Save to Vault
                          </button>
                        )}
                        <button
                          onClick={() => handleRenderImage(idx)}
                          disabled={loadingRender !== null}
                          className="text-xs text-zinc-400 hover:text-white disabled:opacity-50"
                        >
                          {loadingRender === idx ? "Rendering…" : "Render again"}
                        </button>
                        <a href="/dashboard/vault" className="text-xs text-zinc-400 hover:text-white">
                          Open Vault →
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}

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

              {/* "3 more of this one" follow-up variants */}
              {moreResults[idx]?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3">
                  <p className="text-xs text-green-400 font-medium">
                    {moreResults[idx].length} more like this — saved to Drafts
                  </p>
                  {moreResults[idx].map((v, mi) => (
                    <div key={mi} className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] text-zinc-500">
                          {v.hookType} · voice match {v.voiceMatch}%
                          {v.polished ? " · polished" : ""}
                        </span>
                        <div className="flex gap-3">
                          <button
                            onClick={() => copyAndOpen(v.content, sharePlatform[platform])}
                            className="text-xs text-white font-medium hover:text-zinc-300"
                          >
                            Copy &amp; open {PLATFORMS[platform].name}
                          </button>
                          <button
                            onClick={() => handleCopyOnly(v.content, `${idx}-${mi}`)}
                            className="text-xs text-zinc-400 hover:text-white"
                          >
                            {copiedIndex === `${idx}-${mi}` ? "Copied ✓" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                        {v.content}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* One idea, every platform */}
          {platformResults.length > 0 && (
            <div className="border border-zinc-700 rounded-2xl p-5 sm:p-6">
              <h2 className="font-bold text-lg mb-1">Same idea, every platform</h2>
              <p className="text-xs text-zinc-500 mb-4">
                Each version is formatted natively — X hook line, LinkedIn fold, Instagram hashtags,
                Threads casual. All saved to Drafts.
              </p>
              <div className="space-y-3">
                {platformResults.map(({ platform: p, variant }, pi) => (
                  <div key={p} className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <span className="text-xs font-medium text-white">
                        {PLATFORMS[p].name}
                        <span className="text-zinc-500 font-normal ml-2">
                          {variant.fit.length}/{variant.fit.limit} · voice match {variant.voiceMatch}%
                        </span>
                      </span>
                      <div className="flex gap-3 shrink-0">
                        <button
                          onClick={() => copyAndOpen(variant.content, sharePlatform[p])}
                          className="text-xs bg-white text-black font-medium px-3 py-1.5 rounded-md hover:bg-zinc-200"
                        >
                          Copy &amp; open
                        </button>
                        <button
                          onClick={() => handleCopyOnly(variant.content, `p-${pi}`)}
                          className="text-xs text-zinc-400 hover:text-white"
                        >
                          {copiedIndex === `p-${pi}` ? "Copied ✓" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                      {variant.content}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
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

export default function StudioPage() {
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
