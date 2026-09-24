"use client";

/**
 * Posts desk — the publish loop.
 * Ready queue → Copy & open platform → Mark posted → Worked/Flopped.
 * Honest: we never auto-post to social networks. You post; we track.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, authedFetch } from "@/lib/supabase";
import { extractGenerateContent } from "@/lib/generateResponse";
import {
  copyAndOpen,
  copyToClipboard,
  PLATFORM_LABEL,
  type Platform,
} from "@/lib/share";
import type { Persona } from "@/types/persona";
import {
  toSchedulerPayload,
  toSchedulerCsv,
  toWeekPlanText,
  downloadText,
} from "@/lib/schedulerExport";

interface Draft {
  id: string;
  persona_id: string;
  type: string;
  content: string;
  created_at: string;
  posted?: boolean | null;
  performance?: string | null;
  planned_for?: string | null;
  personas?: { name: string } | null;
}

const SHARE_PLATFORMS: Platform[] = [
  "twitter",
  "linkedin",
  "instagram",
  "threads",
  "tiktok",
];

function isPublishable(d: Draft) {
  return d.type === "caption" || d.type === "script" || d.type === "story_arc";
}

export default function PostsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPersona, setFilterPersona] = useState("all");
  const [tab, setTab] = useState<"ready" | "posted">("ready");
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generatingBatch, setGeneratingBatch] = useState(false);
  const [batchTopic, setBatchTopic] = useState("");
  const [batchCount, setBatchCount] = useState(4);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const [draftsRes, personasRes] = await Promise.all([
        supabase
          .from("content_drafts")
          .select("id, persona_id, type, content, created_at, posted, performance, planned_for, personas(name)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("personas").select("*").eq("user_id", user.id),
      ]);

      setDrafts((draftsRes.data as Draft[]) || []);
      setPersonas((personasRes.data as Persona[]) || []);
      setLoading(false);
    };
    load();
  }, [router]);

  const filtered = useMemo(() => {
    return drafts.filter((d) => {
      if (!isPublishable(d)) return false;
      if (filterPersona !== "all" && d.persona_id !== filterPersona) return false;
      return true;
    });
  }, [drafts, filterPersona]);

  const ready = useMemo(() => {
    const list = filtered.filter((d) => !d.posted);
    // Due / planned first, then newest
    return [...list].sort((a, b) => {
      const ap = a.planned_for ? new Date(a.planned_for).getTime() : Number.MAX_SAFE_INTEGER;
      const bp = b.planned_for ? new Date(b.planned_for).getTime() : Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [filtered]);

  const posted = useMemo(
    () =>
      filtered
        .filter((d) => d.posted)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
    [filtered]
  );

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  };

  const markPosted = async (draft: Draft, value: boolean) => {
    setBusyId(draft.id);
    const { error } = await supabase
      .from("content_drafts")
      .update({ posted: value })
      .eq("id", draft.id);
    if (!error) {
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, posted: value } : d))
      );
      flash(value ? "Marked posted" : "Back in ready queue");
    }
    setBusyId(null);
  };

  const setPerformance = async (
    draft: Draft,
    value: "worked" | "ok" | "flopped" | null
  ) => {
    const next = draft.performance === value ? null : value;
    setDrafts((prev) =>
      prev.map((d) => (d.id === draft.id ? { ...d, performance: next } : d))
    );
    const { error } = await supabase
      .from("content_drafts")
      .update({ performance: next })
      .eq("id", draft.id);
    if (error) {
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === draft.id ? { ...d, performance: draft.performance } : d
        )
      );
      return;
    }

    // Worked → gold voice
    if (next === "worked" && draft.content?.trim().length > 20) {
      const persona = personas.find((p) => p.id === draft.persona_id);
      if (persona) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const existing = Array.isArray(persona.voice_samples)
            ? persona.voice_samples
            : [];
          const text = draft.content.trim().slice(0, 2000);
          if (!existing.some((s: { text?: string }) => (s.text || "").trim() === text)) {
            const sample = {
              id: `worked-${draft.id}`,
              text,
              source: "curated" as const,
              enabled: true,
              addedAt: new Date().toISOString(),
            };
            const nextSamples = [...existing, sample].slice(-40);
            await supabase
              .from("personas")
              .update({ voice_samples: nextSamples })
              .eq("id", persona.id)
              .eq("user_id", user.id);
            setPersonas((prev) =>
              prev.map((p) =>
                p.id === persona.id ? { ...p, voice_samples: nextSamples } : p
              )
            );
            flash("Posted + added to gold voice");
          }
        }
      }
    }
  };

  const handleCopyOpen = async (draft: Draft, platform: Platform) => {
    setBusyId(draft.id);
    const { copied } = await copyAndOpen(draft.content, platform);
    flash(
      copied
        ? `Copied — ${PLATFORM_LABEL[platform]} opened`
        : `${PLATFORM_LABEL[platform]} opened (copy manually if needed)`
    );
    setBusyId(null);
  };

  const handleCopy = async (draft: Draft) => {
    const ok = await copyToClipboard(draft.content);
    flash(ok ? "Copied" : "Copy failed — select text manually");
  };


  const generateBatch = async () => {
    if (generatingBatch) return;
    const persona =
      filterPersona !== "all"
        ? personas.find((p) => p.id === filterPersona)
        : personas[0];
    if (!persona) {
      flash("Create a persona first");
      return;
    }
    setGeneratingBatch(true);
    setNotice(null);
    try {
      const gold = Array.isArray(persona.voice_samples)
        ? persona.voice_samples
            .filter((s: { enabled?: boolean; text?: string }) => s && s.enabled !== false && typeof s.text === "string" && s.text.length > 20)
            .map((s: { text: string }) => s.text)
        : [];
      const postedCtx = drafts
        .filter((d) => d.posted && d.persona_id === persona.id)
        .slice(0, 10)
        .map((d) => ({ content: d.content }));

      const res = await authedFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          type: "caption",
          topic:
            batchTopic.trim() ||
            "Write a short standalone post from this persona's world. Specific. Fold-proof first line. No CTA spam.",
          platform: "x",
          variants: Math.min(8, Math.max(2, batchCount)),
          polish: true,
          goldSamples: gold.length ? gold : undefined,
          postedContext: postedCtx,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generate failed");

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const variants: { content?: string }[] = Array.isArray(data.variants)
        ? data.variants
        : [];
      const texts = variants
        .map((v) => (typeof v.content === "string" ? v.content.trim() : ""))
        .filter((c) => c.length > 10);
      if (!texts.length) {
        const one = extractGenerateContent(data);
        if (one) texts.push(one);
      }
      if (!texts.length) throw new Error("Empty batch");

      const rows = texts.map((content) => ({
        persona_id: persona.id,
        user_id: user.id,
        type: "caption",
        content,
      }));
      const { data: inserted, error } = await supabase
        .from("content_drafts")
        .insert(rows)
        .select("id, persona_id, type, content, created_at, posted, performance, planned_for");
      if (error) throw error;

      const withName = (inserted || []).map((d) => ({
        ...d,
        personas: { name: persona.name },
      }));
      setDrafts((prev) => [...withName, ...prev]);
      setTab("ready");
      flash(`Added ${withName.length} posts to Ready`);
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : "Batch generate failed");
    } finally {
      setGeneratingBatch(false);
    }
  };


  const exportRows = () => {
    const source = tab === "ready" ? ready : posted;
    return source.map((d) => ({
      id: d.id,
      content: d.content,
      type: d.type,
      planned_for: d.planned_for,
      created_at: d.created_at,
      persona_name: (d.personas as { name?: string } | null)?.name,
    }));
  };

  const exportSchedulerJson = () => {
    const rows = exportRows();
    if (!rows.length) {
      flash("Nothing to export");
      return;
    }
    const payload = toSchedulerPayload(rows, ["x", "linkedin", "threads"]);
    downloadText(
      `persona-os-queue-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    flash(`Exported ${rows.length} posts (JSON)`);
  };

  const exportSchedulerCsv = () => {
    const rows = exportRows();
    if (!rows.length) {
      flash("Nothing to export");
      return;
    }
    downloadText(
      `persona-os-queue-${new Date().toISOString().slice(0, 10)}.csv`,
      toSchedulerCsv(rows),
      "text/csv;charset=utf-8"
    );
    flash(`Exported ${rows.length} posts (CSV)`);
  };

  const exportWeekPlan = async () => {
    const rows = exportRows();
    if (!rows.length) {
      flash("Nothing to export");
      return;
    }
    const text = toWeekPlanText(rows);
    try {
      await navigator.clipboard.writeText(text);
      flash("Week plan copied");
    } catch {
      downloadText(
        `persona-os-week-plan-${new Date().toISOString().slice(0, 10)}.txt`,
        text,
        "text/plain"
      );
      flash("Week plan downloaded");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-400">
        Loading…
      </div>
    );
  }

  const list = tab === "ready" ? ready : posted;

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl sm:text-3xl font-bold mt-3 mb-2">Posts</h1>
          <p className="text-zinc-400 text-sm">
            Ready queue → copy & open → mark posted → log what worked.
            We never auto-post for you.
          </p>
        </div>

        {notice && (
          <div className="mb-4 p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-sm text-emerald-200">
            {notice}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <button
            type="button"
            onClick={() => setTab("ready")}
            className={`text-sm px-3 py-1.5 rounded-lg border ${
              tab === "ready"
                ? "border-white bg-white text-black"
                : "border-zinc-700 text-zinc-400"
            }`}
          >
            Ready ({ready.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("posted")}
            className={`text-sm px-3 py-1.5 rounded-lg border ${
              tab === "posted"
                ? "border-white bg-white text-black"
                : "border-zinc-700 text-zinc-400"
            }`}
          >
            Posted ({posted.length})
          </button>
          <select
            value={filterPersona}
            onChange={(e) => setFilterPersona(e.target.value)}
            className="ml-auto text-sm px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg"
          >
            <option value="all">All personas</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={exportSchedulerJson}
            className="text-xs px-3 py-1.5 border border-zinc-600 rounded-lg text-zinc-300 hover:bg-zinc-800"
            title="JSON for Shoutrrr / custom schedulers / agents"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={exportSchedulerCsv}
            className="text-xs px-3 py-1.5 border border-zinc-600 rounded-lg text-zinc-300 hover:bg-zinc-800"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={exportWeekPlan}
            className="text-xs px-3 py-1.5 border border-zinc-600 rounded-lg text-zinc-300 hover:bg-zinc-800"
          >
            Copy week plan
          </button>
        </div>
        <p className="text-[11px] text-zinc-600 -mt-4 mb-6">
          Export the current tab (Ready or Posted) for Shoutrrr, Typefully, xqueue, or any scheduler.
          We generate; they publish.
        </p>


        <div className="mb-6 p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-3">
          <p className="text-sm font-medium text-zinc-200">Generate posts</p>
          <p className="text-xs text-zinc-500">
            Ranked variants, anti-slop on. Lands in Ready — you still post yourself.
          </p>
          <input
            value={batchTopic}
            onChange={(e) => setBatchTopic(e.target.value)}
            placeholder="Topic (optional) e.g. quiet luxury travel logistics"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={batchCount}
              onChange={(e) => setBatchCount(Number(e.target.value))}
              className="text-sm px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg"
            >
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n} posts
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={generateBatch}
              disabled={generatingBatch || personas.length === 0}
              className="text-sm px-4 py-2 bg-white text-black rounded-lg font-medium disabled:opacity-50"
            >
              {generatingBatch ? "Generating…" : "Generate"}
            </button>
            {filterPersona === "all" && personas[0] && (
              <span className="text-[10px] text-zinc-500">
                Uses {personas[0].name} (pick a persona above to switch)
              </span>
            )}
          </div>
        </div>

        {list.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-zinc-400 text-sm mb-4">
              {tab === "ready"
                ? "Nothing in the ready queue. Generate a caption or series first."
                : "No posted items yet. Mark a draft posted after you publish."}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <a
                href="/dashboard/studio"
                className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium"
              >
                Studio
              </a>
              <a
                href="/dashboard/series"
                className="px-4 py-2 border border-zinc-700 rounded-lg text-sm"
              >
                Series
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {list.map((draft) => (
              <div
                key={draft.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                    {draft.type.replace("_", " ")}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {(draft.personas as { name?: string } | null)?.name || "—"}
                  </span>
                  {draft.planned_for && !draft.posted && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/40 text-amber-200 rounded">
                      Plan{" "}
                      {new Date(draft.planned_for).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                  {draft.performance === "worked" && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900/40 text-emerald-300 rounded">
                      Worked
                    </span>
                  )}
                  {draft.performance === "flopped" && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded">
                      Flopped
                    </span>
                  )}
                </div>

                <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed mb-4">
                  {draft.content}
                </pre>

                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    type="button"
                    disabled={busyId === draft.id}
                    onClick={() => handleCopy(draft)}
                    className="text-xs px-2.5 py-1.5 border border-zinc-700 rounded-lg hover:bg-zinc-800"
                  >
                    Copy
                  </button>
                  {SHARE_PLATFORMS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={busyId === draft.id}
                      onClick={() => handleCopyOpen(draft, p)}
                      className="text-xs px-2.5 py-1.5 border border-zinc-700 rounded-lg hover:bg-zinc-800"
                    >
                      {p === "twitter" ? "Open X" : PLATFORM_LABEL[p].split(" ")[0]}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-zinc-800">
                  {!draft.posted ? (
                    <button
                      type="button"
                      disabled={busyId === draft.id}
                      onClick={() => markPosted(draft, true)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-900/40 border border-emerald-700/50 text-emerald-200"
                    >
                      Mark posted
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === draft.id}
                      onClick={() => markPosted(draft, false)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400"
                    >
                      Unmark posted
                    </button>
                  )}

                  <span className="text-[10px] text-zinc-600 ml-1">How did it do?</span>
                  {(["worked", "ok", "flopped"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPerformance(draft, v)}
                      className={`text-[10px] px-2 py-1 rounded border capitalize ${
                        draft.performance === v
                          ? v === "worked"
                            ? "border-emerald-600 bg-emerald-900/40 text-emerald-200"
                            : v === "flopped"
                              ? "border-red-600 bg-red-900/40 text-red-200"
                              : "border-zinc-500 bg-zinc-700 text-zinc-200"
                          : "border-zinc-700 text-zinc-500"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
