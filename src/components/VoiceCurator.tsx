"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Persona, VoiceSample } from "@/types/persona";
import { extractVoiceFingerprint } from "@/lib/voice";

/**
 * Voice Gold Set — the curation UI for the samples the engine learns voice
 * from. Curation beats collection: 3 great posts the user vouches for teach
 * the engine more than 30 auto-collected drafts (and break the drift loop
 * where AI drafts teach the AI its own voice).
 */

function splitSamples(raw: string): string[] {
  return raw
    .split(/\n\s*(?:-{3,}|\*{3,})\s*\n|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

function coverage(n: number): { label: string; hint: string; cls: string } {
  if (n === 0)
    return {
      label: "No gold samples — engine is guessing the voice",
      hint: "Paste 3+ posts that sound exactly like you at your best.",
      cls: "border-zinc-700 text-zinc-400",
    };
  if (n <= 2)
    return {
      label: "Warming up",
      hint: "2 samples is a sketch. 3-5 locks the rhythm.",
      cls: "border-amber-700 text-amber-400 bg-amber-950/30",
    };
  if (n <= 5)
    return {
      label: "Voice locked",
      hint: "The engine now measures rhythm, emoji policy, hooks and signature words from YOUR posts.",
      cls: "border-emerald-700 text-emerald-400 bg-emerald-950/30",
    };
  return {
    label: "Gold set",
    hint: "Strong coverage. Every generation uses these as the standard.",
    cls: "border-emerald-500 text-emerald-300 bg-emerald-950/40",
  };
}

export default function VoiceCurator({ persona }: { persona: Persona }) {
  const initial: VoiceSample[] = Array.isArray(persona.voice_samples)
    ? (persona.voice_samples as VoiceSample[])
    : [];

  const [samples, setSamples] = useState<VoiceSample[]>(initial);
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const enabled = samples.filter((s) => s.enabled);
  const cov = coverage(enabled.length);
  const fp = useMemo(
    () => extractVoiceFingerprint(enabled.map((s) => s.text)),
    [enabled]
  );

  const persist = async (next: VoiceSample[]) => {
    setSamples(next);
    setSaving(true);
    const { error } = await supabase
      .from("personas")
      .update({ voice_samples: next })
      .eq("id", persona.id);
    setSaving(false);
    if (error) {
      alert(`Couldn't save voice samples: ${error.message}`);
      return;
    }
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt((t) => (t === Date.now() ? null : t)), 1500);
  };

  const addPasted = async () => {
    const texts = splitSamples(paste);
    if (!texts.length) return;
    const next: VoiceSample[] = [
      ...samples,
      ...texts.map((text) => ({
        id: crypto.randomUUID(),
        text,
        source: "curated" as const,
        enabled: true,
        addedAt: new Date().toISOString(),
      })),
    ];
    setPaste("");
    await persist(next);
  };

  const importFromDrafts = async () => {
    setImporting(true);
    try {
      const { data } = await supabase
        .from("content_drafts")
        .select("content, posted, created_at")
        .eq("persona_id", persona.id)
        .order("created_at", { ascending: false })
        .limit(15);
      const existing = new Set(samples.map((s) => s.text.trim()));
      const fresh = ((data || []) as { content: string; posted: boolean }[])
        .filter((d) => d.content && d.content.trim().length > 20 && !existing.has(d.content.trim()))
        .map((d) => ({
          id: crypto.randomUUID(),
          text: d.content.trim(),
          source: (d.posted ? "posted" : "draft") as VoiceSample["source"],
          enabled: false, // imports start disabled — the user curates, not collects
          addedAt: new Date().toISOString(),
        }));
      if (!fresh.length) {
        alert("Nothing new to import — every recent draft is already in the set.");
        return;
      }
      await persist([...samples, ...fresh]);
    } finally {
      setImporting(false);
    }
  };

  const toggle = async (id: string) => {
    await persist(samples.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const remove = async (id: string) => {
    await persist(samples.filter((s) => s.id !== id));
  };

  // Order matters: the earliest enabled samples anchor the voice fingerprint.
  const move = async (from: number, to: number) => {
    if (to < 0 || to >= samples.length || from === to) return;
    const next = [...samples];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    await persist(next);
  };

  // HTML5 drag-and-drop (desktop); ↑/↓ buttons cover touch + keyboard.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const pasteCount = splitSamples(paste).length;

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 sm:p-6 mb-10">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-lg font-bold">Voice Gold Set</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            The posts the engine learns your voice from. Curate the ones that sound
            exactly like you at your best — every generation is measured against them.
          </p>
        </div>
        <span className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full border ${cov.cls}`}>
          {cov.label}
        </span>
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">{cov.hint}</p>

      {/* Live Voice DNA readout */}
      {fp.samples > 0 && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 mb-4">
          <p className="text-[11px] text-zinc-400">
            <span className="text-zinc-500 font-medium uppercase tracking-wide mr-2">Engine sees</span>
            {fp.sentenceSpread} rhythm · ~{fp.avgSentenceWords} words/sentence ·{" "}
            {fp.emojiPer100 >= 0.5 ? `uses emoji ${fp.topEmojis.join("")}` : "no emoji"} · {fp.casing}{" "}
            casing · {fp.lineStyle.replace("-", " ")}
            {fp.hooks.length ? ` · hooks: ${fp.hooks.join(", ")}` : ""}
            {fp.signatureWords.length ? ` · signatures: ${fp.signatureWords.slice(0, 5).join(", ")}` : ""}
          </p>
        </div>
      )}

      {/* Paste new samples */}
      <textarea
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        rows={3}
        placeholder={`Paste your best posts here — one per block, blank line between them.\n\nLike this one. Real posts, the ones that got saved and shared.`}
        className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-sm mb-2"
      />
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={addPasted}
          disabled={!pasteCount || saving}
          className="px-4 py-2 min-h-[42px] bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 disabled:opacity-40"
        >
          + Add {pasteCount || ""} {pasteCount === 1 ? "sample" : "samples"}
        </button>
        <button
          onClick={importFromDrafts}
          disabled={importing || saving}
          className="px-4 py-2 min-h-[42px] border border-zinc-600 rounded-lg text-sm hover:bg-zinc-800 disabled:opacity-40"
        >
          {importing ? "Importing…" : "Import from drafts"}
        </button>
        <span className="text-[11px] text-zinc-500">
          {saving ? "Saving…" : savedAt ? "Saved ✓" : `${enabled.length} of ${samples.length} enabled`}
        </span>
      </div>

      {/* Sample list */}
      {samples.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No samples yet. Paste 3+ posts above, or import your drafts and pick the
          keepers — imports start switched off so you choose what teaches the engine.
        </p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {samples.map((s, i) => (
            <div
              key={s.id}
              draggable
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(i);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={`border rounded-lg p-3 ${
                s.enabled ? "border-zinc-700 bg-zinc-900" : "border-zinc-800 bg-zinc-950 opacity-70"
              } ${overIndex === i && dragIndex !== null && dragIndex !== i ? "border-emerald-600" : ""} ${
                dragIndex === i ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="shrink-0 flex flex-col items-center gap-0.5">
                  <span
                    className="text-zinc-600 cursor-grab active:cursor-grabbing text-xs leading-none select-none"
                    title="Drag to reorder — first samples anchor the voice"
                    aria-hidden
                  >
                    ⠿
                  </span>
                  <button
                    onClick={() => move(i, i - 1)}
                    disabled={i === 0}
                    title="Move up"
                    className="text-[10px] text-zinc-500 hover:text-white disabled:opacity-20 leading-none"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(i, i + 1)}
                    disabled={i === samples.length - 1}
                    title="Move down"
                    className="text-[10px] text-zinc-500 hover:text-white disabled:opacity-20 leading-none"
                  >
                    ▼
                  </button>
                </div>
                <button
                  onClick={() => toggle(s.id)}
                  title={s.enabled ? "Exclude from voice" : "Include in voice"}
                  className={`shrink-0 w-10 h-6 rounded-full relative transition ${s.enabled ? "bg-emerald-600" : "bg-zinc-700"}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${s.enabled ? "left-[18px]" : "left-0.5"}`}
                  />
                </button>
                <p
                  className={`flex-1 text-sm whitespace-pre-wrap ${expanded === s.id ? "" : "line-clamp-2"} text-zinc-200 cursor-pointer`}
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                >
                  {s.text}
                </p>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span
                    className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                      s.source === "curated"
                        ? "border-emerald-700 text-emerald-400"
                        : s.source === "posted"
                          ? "border-sky-700 text-sky-400"
                          : "border-zinc-700 text-zinc-500"
                    }`}
                  >
                    {s.source}
                  </span>
                  <button
                    onClick={() => remove(s.id)}
                    className="text-[11px] text-zinc-600 hover:text-red-400"
                  >
                    remove
                  </button>
                </div>
              </div>
            </div>
          ))}
          {samples.length > 2 && (
            <p className="text-[11px] text-zinc-600 pt-1">
              Order matters — the first 3 enabled samples anchor the voice. Drag ⠿ or use ▲▼.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
