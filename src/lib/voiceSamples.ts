import { supabase } from "./supabase";

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
