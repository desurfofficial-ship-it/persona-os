"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

export default function PersonaDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [persona, setPersona] = useState<Persona | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [assetCount, setAssetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

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

      // Counts
      const [draftsRes, assetsRes] = await Promise.all([
        supabase
          .from("content_drafts")
          .select("id", { count: "exact", head: true })
          .eq("persona_id", id),
        supabase
          .from("assets")
          .select("id", { count: "exact", head: true })
          .eq("persona_id", id),
      ]);

      setDraftCount(draftsRes.count || 0);
      setAssetCount(assetsRes.count || 0);
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
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <div className="flex gap-2">
            <a
              href={`/dashboard/generate?persona=${persona.id}`}
              className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
            >
              Generate
            </a>
            <button
              onClick={handleExportPersona}
              className="px-4 py-2 border border-zinc-600 rounded-lg text-sm hover:bg-zinc-800"
            >
              Export
            </button>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 border border-zinc-600 rounded-lg text-sm hover:bg-zinc-800"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-4 mb-8 text-sm">
          <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg">
            <span className="text-zinc-500">Drafts</span>{" "}
            <span className="font-medium ml-1">{draftCount}</span>
          </div>
          <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg">
            <span className="text-zinc-500">Assets</span>{" "}
            <span className="font-medium ml-1">{assetCount}</span>
          </div>
        </div>

        {editing ? (
          <div className="space-y-5">
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
          <div className="space-y-8">
            <h1 className="text-3xl font-bold">{persona.name}</h1>

            <div>
              <h2 className="text-sm font-medium text-zinc-400 mb-2">Backstory</h2>
              <p className="text-zinc-200 whitespace-pre-wrap leading-relaxed">
                {persona.backstory}
              </p>
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
                    <span
                      key={p}
                      className="px-3 py-1 bg-zinc-800 rounded-full text-sm text-zinc-300"
                    >
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
          </div>
        )}
      </div>
    </div>
  );
}
