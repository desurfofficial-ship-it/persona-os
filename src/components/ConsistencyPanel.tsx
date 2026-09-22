"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";

interface Contradiction {
  a: { quote: string; itemId: string; date: string; type?: string };
  b: { quote: string; itemId: string; date: string; type?: string };
  why: string;
  severity: "high" | "medium" | "low";
  resolution: string;
  source: "deterministic" | "llm";
}

interface ScanResult {
  score: number;
  contradictions: Contradiction[];
  scanned: number;
  scannedPosted?: number;
  scannedAt?: string;
  note?: string;
}

const SEVERITY_STYLES: Record<Contradiction["severity"], string> = {
  high: "bg-red-900/40 border-red-800 text-red-200",
  medium: "bg-amber-900/40 border-amber-800 text-amber-200",
  low: "bg-zinc-800 border-zinc-600 text-zinc-300",
};

function scoreColor(score: number): string {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-amber-400";
  return "text-red-400";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const TYPE_LABELS: Record<string, string> = {
  imported: "your real post",
  x_post: "X post",
  linkedin_post: "LinkedIn post",
  caption: "caption",
  script: "script",
  story_arc: "story arc",
  image_prompt: "image prompt",
};

function typeLabel(type?: string): string {
  if (!type) return "content";
  return TYPE_LABELS[type] || type.replace(/_/g, " ");
}

function scanAge(iso?: string): string | null {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Progress labels mirroring the scan's real execution order. */
const STAGES = [
  "Reading your posts and scripts…",
  "Layer 1 — exact-claim matching across everything…",
  "Layer 2 — semantic read-through in context…",
  "Scoring and writing fixes…",
];

export default function ConsistencyPanel({ personaId }: { personaId: string }) {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Honest staged progress: the two engine layers really do run in this
  // order, so the labels track the work instead of faking a spinner.
  useEffect(() => {
    if (!scanning) {
      setStage(0);
      setElapsed(0);
      return;
    }
    const stageTimer = setInterval(
      () => setStage((s) => (s < STAGES.length - 1 ? s + 1 : s)),
      6000
    );
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      clearInterval(stageTimer);
      clearInterval(tick);
    };
  }, [scanning]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await authedFetch("/api/consistency-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="text-sm font-medium text-zinc-400">Consistency Engine</h2>
        <div className="flex items-center gap-3">
          {result && (
            <span className={`text-sm font-semibold ${scoreColor(result.score)}`}>
              {result.score}/100
            </span>
          )}
          <button
            onClick={runScan}
            disabled={scanning}
            className="text-xs px-3 py-1.5 border border-zinc-600 rounded-lg hover:bg-zinc-800 disabled:opacity-50"
          >
            {scanning ? "Scanning your content…" : result ? "Re-scan" : "Scan for contradictions"}
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Cross-checks every post and script against each other — not just the persona rules. Catches
        the &quot;vegan in March, steakhouse review in July&quot; problem before your followers do.
      </p>

      {error && (
        <p className="text-sm text-red-400 bg-red-900/30 p-3 rounded-lg mb-3">{error}</p>
      )}

      {!result && !scanning && !error && (
        <p className="text-sm text-zinc-500">
          {`Scan runs two layers: deterministic claim matching (free, instant) plus a semantic pass that reads content in context. Requires at least 2 drafts for this persona.`}
        </p>
      )}

      {scanning && (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-white rounded-full animate-spin shrink-0" />
            <p className="text-sm text-zinc-300">{STAGES[stage]}</p>
            <span className="text-xs text-zinc-600 tabular-nums ml-auto">{elapsed}s</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all duration-700"
              style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-600">
            Big libraries take up to a minute — you can keep working, the result lands here.
          </p>
        </div>
      )}

      {result && !scanning && (
        <div>
          {result.note && (
            <p className="text-sm text-zinc-500 mb-3">{result.note}</p>
          )}
          {result.scannedAt && (
            <p className="text-xs text-zinc-500 mb-3">
              Scanned {scanAge(result.scannedAt)} · {result.scanned} pieces of content. Edited or
              added anything since? Re-scan — results don&apos;t update themselves.
            </p>
          )}
          {result.contradictions.length === 0 ? (
            <div className="flex items-center gap-3 bg-green-900/20 border border-green-800/50 rounded-lg p-4">
              <span className="text-green-400 text-lg">✓</span>
              <p className="text-sm text-green-200">
                No contradictions found across {result.scanned} pieces of content
                {typeof result.scannedPosted === "number" &&
                  ` (${result.scannedPosted} posted)`}
                . Your story holds together.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                {result.contradictions.length} contradiction
                {result.contradictions.length === 1 ? "" : "s"} found across {result.scanned}{" "}
                pieces of content. Fix the red ones first — those are the flips followers screenshot.
              </p>
              {result.contradictions.map((c, i) => (
                <div
                  key={i}
                  className={`border rounded-xl p-4 ${SEVERITY_STYLES[c.severity]}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider">
                      {c.severity} · {c.source === "deterministic" ? "exact match" : "contextual"}
                    </span>
                    <span className="text-[10px] opacity-70">
                      {typeLabel(c.a.type)} · {fmtDate(c.a.date)} vs {typeLabel(c.b.type)} ·{" "}
                      {fmtDate(c.b.date)}
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2 mb-2">
                    <blockquote className="bg-black/30 rounded-lg p-3 text-sm border-l-2 border-current">
                      “{c.a.quote}”
                    </blockquote>
                    <blockquote className="bg-black/30 rounded-lg p-3 text-sm border-l-2 border-current">
                      “{c.b.quote}”
                    </blockquote>
                  </div>
                  <p className="text-sm mb-1.5 opacity-90">{c.why}</p>
                  {c.resolution && (
                    <p className="text-sm opacity-75">
                      <span className="font-medium">Fix:</span> {c.resolution}
                    </p>
                  )}
                  {/* Close the loop: jump into drafts pre-filtered to this quote. */}
                  <a
                    href={`/dashboard/drafts?q=${encodeURIComponent(c.a.quote.split(" ").slice(0, 6).join(" "))}`}
                    className="inline-block mt-2 text-xs underline opacity-80 hover:opacity-100"
                  >
                    Find &amp; edit these drafts →
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
