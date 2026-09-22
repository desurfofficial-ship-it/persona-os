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
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [backstory, setBackstory] = useState("");
  const [tone, setTone] = useState("");
  const [pillars, setPillars] = useState("");
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
        console.error(error);
        router.push("/dashboard");
        return;
      }

      setPersona(data);
      setName(data.name);
      setBackstory(data.backstory || "");
      setTone(data.tone_of_voice || "");
      setPillars((data.lifestyle_pillars || []).join(", "));
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

    const { error } = await supabase
      .from("personas")
      .update({
        name,
        backstory,
        tone_of_voice: tone,
        lifestyle_pillars,
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
      });
      setEditing(false);
    }
    setSaving(false);
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
    <div className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Back to Dashboard
          </a>
          <div className="flex gap-3">
            <a
              href={`/dashboard/generate?persona=${persona.id}`}
              className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
            >
              Generate Content
            </a>
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

        {editing ? (
          <div className="space-y-6">
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
                rows={6}
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
              <label className="block text-sm text-zinc-400 mb-2">
                Lifestyle Pillars (comma separated)
              </label>
              <input
                value={pillars}
                onChange={(e) => setPillars(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-white text-black rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
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
          <div className="space-y-6">
            <h1 className="text-3xl font-bold">{persona.name}</h1>

            <div>
              <h2 className="text-sm font-medium text-zinc-400 mb-2">Backstory</h2>
              <p className="text-zinc-200 whitespace-pre-wrap">{persona.backstory}</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
