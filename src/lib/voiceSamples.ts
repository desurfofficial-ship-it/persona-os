import { supabase } from "./supabase";
import type { Persona, VoiceSample } from "@/types/persona";

/**
 * Voice-sample resolution for the generation engine.
 *
 * Priority:
 *  1. Curated gold set (persona.voice_samples, enabled only) — the posts the
 *     user chose to represent their voice. When present it wins outright:
 *     AI-generated drafts must never teach the AI its own voice (drift loop).
 *  2. Fallback: the persona's recent drafts + posted content, as before.
 */
export async function loadVoiceSource(persona: Persona): Promise<{
  samples: string[];
  source: "gold" | "drafts";
  goldSet: VoiceSample[];
}> {
  const raw = persona.voice_samples;
  const goldSet: VoiceSample[] = Array.isArray(raw)
    ? (raw as VoiceSample[]).filter(
        (s) => s && typeof s.text === "string" && typeof s.enabled === "boolean"
      )
    : [];
  const enabled = goldSet.filter((s) => s.enabled && s.text.trim().length > 20);
  if (enabled.length > 0) {
    return { samples: enabled.map((s) => s.text), source: "gold", goldSet };
  }

  // Fallback: recent drafts teach the voice until the user curates a gold set.
  const drafts = await fetchVoiceSamples(persona.id);
  return { samples: drafts, source: "drafts", goldSet };
}

/**
 * Fetch the persona's real drafts to use as voice samples.
 * Every AI surface (ideas, series, improve, sample voice) sends these so
 * the fingerprint engine can constrain output to the persona's measured
 * voice — not just the adjective description.
 */
export async function fetchVoiceSamples(personaId: string, limit = 30): Promise<string[]> {
  const { data } = await supabase
    .from("content_drafts")
    .select("content")
    .eq("persona_id", personaId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data || []) as { content: string }[])
    .map((d) => d.content)
    .filter((c) => typeof c === "string" && c.length > 20);
}

// ---------------------------------------------------------------------------
// Gold-set split — pure, testable
// ---------------------------------------------------------------------------

/**
 * Split one sample into sentence-based parts. Sentences pack greedily so a
 * part is never a lonely fragment — tiny sentences ride along until the part
 * crosses MIN_PART_CHARS. Returns fewer than 2 parts (null) when there is
 * nothing to split: no clean sentence break, or splitting would make
 * fragments shorter than a usable sample.
 */
export const MIN_PART_CHARS = 50;

export function splitIntoParts(text: string): string[] | null {
  const sentences = text.match(/[^.!?\n]+[.!?]+["')\]]?|[^.!?\n]+$/g) || [text];
  const parts: string[] = [];
  let current = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length <= MIN_PART_CHARS) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = s;
      if (current.length >= MIN_PART_CHARS) {
        // Long enough to stand alone right now.
        parts.push(current);
        current = "";
      }
      // else: stays open — the next short sentence packs onto it.
    }
  }
  if (current) parts.push(current);
  const clean = parts.map((p) => p.trim()).filter((p) => p.length > 20);
  return clean.length >= 2 ? clean : null;
}
