"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { fetchVoiceSamples } from "@/lib/voiceSamples";
import VoiceCurator from "@/components/VoiceCurator";

interface Draft {
  id: string;
  type: string;
  content: string;
  created_at: string;
}

export default function PersonaDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [persona, setPersona] = useState<Persona | null>(null);
  const [recentDrafts, setRecentDrafts] = useState<Draft[]>([]);
  const [draftCount, setDraftCount] = useState(0);
  const [postedCount, setPostedCount] = useState(0);
  const [assetCount, setAssetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [sample, setSample] = useState("");
  const [sampleLoading, setSampleLoading] = useState(false);
  const [strengthenLoading, setStrengthenLoading] = useState(false);

  const [name, setName] = useState("");
  const [backstory, setBackstory] = useState("");
  const [tone, setTone] = useState("");
  const [pillars, setPillars] = useState("");
  const [rules, setRules] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data, error } = await supabase
        .from("personas")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (error || !data) {
        router.push("/dashboard");
        return;
      }

      setPersona(data);
      setName(data.name);
      setBackstory(data.backstory || "");
      setTone(data.tone_of_voice || "");
      setPillars((data.lifestyle_pillars || []).join(", "));
      setRules((data.content_rules || []).join("\n"));
      setForbidden((data.forbidden_topics || []).join(", "));

      const [draftsRes, assetsRes, recentRes, postedRes] = await Promise.all([
        supabase
          .from("content_drafts")
          .select("id", { count: "exact", head: true })
          .eq("persona_id", id),
        supabase
          .from("assets")
          .select("id", { count: "exact", head: true })
          .eq("persona_id", id),
        supabase
          .from("content_drafts")
          .select("id, type, content, created_at")
          .eq("persona_id", id)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("content_drafts")
          .select("id", { count: "exact", head: true })
          .eq("persona_id", id)
          .eq("posted", true),
      ]);

      setDraftCount(draftsRes.count || 0);
      setAssetCount(assetsRes.count || 0);
      setRecentDrafts(recentRes.data || []);
      setPostedCount(postedRes.count || 0);
      setLoading(false);
    };

    load();
  }, [id, router]);

  const handleSave = async () => {
    if (!persona) return;
    setSaving(true);

    const lifestyle_pillars = pillars
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const content_rules = rules
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    const forbidden_topics = forbidden
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const { error } = await supabase
      .from("personas")
      .update({
        name,
        backstory,
        tone_of_voice: tone,
        lifestyle_pillars,
        content_rules,
        forbidden_topics,
      })
      .eq("id", persona.id);

    if (error) {
      alert(error.message);
    } else {
      setPersona({
        ...persona,
        name,
        backstory,
        tone_of_voice: tone,
        lifestyle_pillars,
        content_rules,
        forbidden_topics,
      });
      setEditing(false);
    }
    setSaving(false);
  };

  const handleSample = async () => {
    if (!persona) return;
    setSampleLoading(true);
    setSample("");
    try {
      // Gold set first — the curated voice beats auto-collected drafts.
      const gold = (persona.voice_samples || [])
        .filter(
          (s): s is { id: string; text: string; source: "curated" | "draft" | "posted"; enabled: boolean; addedAt: string } =>
            !!s && typeof s === "object" && typeof (s as { text?: unknown }).text === "string"
        )
        .filter((s) => s.enabled && s.text.trim().length > 20)
        .map((s) => s.text);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          type: "caption",
          voiceSamples: await fetchVoiceSamples(persona.id),
          ...(gold.length ? { goldSamples: gold } : {}),
          topic: "Write one short sample post that perfectly demonstrates this persona's voice and energy.",
          model: "openai/gpt-4o-mini",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setSample(data.content);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSampleLoading(false);
    }
  };

  const handleStrengthen = async () => {
    if (!persona) return;
    setStrengthenLoading(true);
    try {
      const res = await fetch("/api/strengthen-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      // Apply suggestions
      setName(data.name || persona.name);
      setBackstory(data.backstory || persona.backstory);
      setTone(data.tone_of_voice || persona.tone_of_voice || "");
      setPillars((data.lifestyle_pillars || persona.lifestyle_pillars || []).join(", "));
      setRules((data.content_rules || persona.content_rules || []).join("\n"));
      setForbidden((data.forbidden_topics || persona.forbidden_topics || []).join(", "));
      setEditing(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setStrengthenLoading(false);
    }
  };

  const handleExportPersona = () => {
    if (!persona) return;
    const text = `PERSONA: ${persona.name}

BACKSTORY:
${persona.backstory}

TONE OF VOICE:
${persona.tone_of_voice || "—"}

LIFESTYLE PILLARS:
${(persona.lifestyle_pillars || []).join(", ") || "—"}

CONTENT RULES:
${(persona.content_rules || []).map((r) => `- ${r}`).join("\n") || "—"}

FORBIDDEN TOPICS:
${(persona.forbidden_topics || []).join(", ") || "—"}
`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${persona.name.toLowerCase().replace(/\s+/g, "-")}-persona.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  if (!persona) return null;

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleStrengthen}
              disabled={strengthenLoading}
              className="px-4 py-2 border border-zinc-600 rounded-lg text-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {strengthenLoading ? "Strengthening..." : "Strengthen"}
            </button>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 border border-zinc-600 rounded-lg text-sm hover:bg-zinc-800"
              >
                Edit
              </button>
            )}
            <button
              onClick={handleExportPersona}
              className="px-4 py-2 border border-zinc-600 rounded-lg text-sm hover:bg-zinc-800"
            >
              Export
            </button>
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-3">{persona.name}</h1>
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg">
              <span className="text-zinc-500">Drafts</span>{" "}
              <span className="font-medium ml-1">{draftCount}</span>
            </div>
            <div className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg">
              <span className="text-zinc-500">Posted</span>{" "}
              <span className="font-medium ml-1 text-green-400">{postedCount}</span>
            </div>
            <div className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg">
              <span className="text-zinc-500">Assets</span>{" "}
              <span className="font-medium ml-1">{assetCount}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          <a
            href={`/dashboard/generate?persona=${persona.id}`}
            className="bg-white text-black rounded-xl p-4 text-center font-medium hover:bg-zinc-200 transition"
          >
            Generate
          </a>
          <a
            href={`/dashboard/series?persona=${persona.id}`}
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 text-center hover:border-zinc-500 transition"
          >
            Series
          </a>
          <a
            href={`/dashboard/ideas?persona=${persona.id}`}
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 text-center hover:border-zinc-500 transition"
          >
            Ideas
          </a>
          <a
            href={`/dashboard/check?persona=${persona.id}`}
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 text-center hover:border-zinc-500 transition"
          >
            Check
          </a>
        </div>

        <VoiceCurator persona={persona} />

        {editing ? (
          <div className="space-y-5 mb-10">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Backstory</label>
              <textarea
                value={backstory}
                onChange={(e) => setBackstory(e.target.value)}
                rows={5}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Tone of Voice</label>
              <input
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Lifestyle Pillars</label>
              <input
                value={pillars}
                onChange={(e) => setPillars(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Content Rules (one per line)</label>
              <textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Forbidden Topics</label>
              <input
                value={forbidden}
                onChange={(e) => setForbidden(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-white text-black rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-5 py-2.5 border border-zinc-600 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-8 mb-10">
            <div>
              <h2 className="text-sm font-medium text-zinc-400 mb-2">Backstory</h2>
              <p className="text-zinc-200 whitespace-pre-wrap leading-relaxed">{persona.backstory}</p>
            </div>

            {persona.tone_of_voice && (
              <div>
                <h2 className="text-sm font-medium text-zinc-400 mb-2">Tone of Voice</h2>
                <p className="text-zinc-200">{persona.tone_of_voice}</p>
              </div>
            )}

            {persona.lifestyle_pillars?.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-zinc-400 mb-2">Lifestyle Pillars</h2>
                <div className="flex flex-wrap gap-2">
                  {persona.lifestyle_pillars.map((p) => (
                    <span key={p} className="px-3 py-1 bg-zinc-800 rounded-full text-sm text-zinc-300">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {persona.content_rules?.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-zinc-400 mb-2">Content Rules</h2>
                <ul className="list-disc list-inside space-y-1 text-zinc-200">
                  {persona.content_rules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {persona.forbidden_topics?.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-zinc-400 mb-2">Forbidden Topics</h2>
                <div className="flex flex-wrap gap-2">
                  {persona.forbidden_topics.map((t) => (
                    <span
                      key={t}
                      className="px-3 py-1 bg-red-900/40 border border-red-800 rounded-full text-sm text-red-200"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-zinc-400">Sample Voice</h2>
                <button
                  onClick={handleSample}
                  disabled={sampleLoading}
                  className="text-xs px-3 py-1.5 border border-zinc-600 rounded-lg hover:bg-zinc-800 disabled:opacity-50"
                >
                  {sampleLoading ? "Generating..." : "Generate Sample"}
                </button>
              </div>
              {sample ? (
                <pre className="whitespace-pre-wrap text-sm text-zinc-200">{sample}</pre>
              ) : (
                <p className="text-sm text-zinc-500">
                  Generate a sample post to hear how this persona sounds.
                </p>
              )}
            </div>
          </div>
        )}

        {recentDrafts.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Recent Drafts</h2>
              <a href="/dashboard/drafts" className="text-sm text-zinc-400 hover:text-white">
                View all →
              </a>
            </div>
            <div className="space-y-3">
              {recentDrafts.map((d) => (
                <div key={d.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2 text-xs text-zinc-500">
                    <span className="uppercase">{d.type.replace("_", " ")}</span>
                    <span>{new Date(d.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-zinc-300 line-clamp-2">{d.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
