"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

interface Draft {
  id: string;
  type: string;
  content: string;
  created_at: string;
  personas?: { name: string };
}

export default function DashboardPage() {
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [recentDrafts, setRecentDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUserEmail(user.email ?? null);

      const [personasRes, draftsRes] = await Promise.all([
        supabase
          .from("personas")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("content_drafts")
          .select("*, personas(name)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      setPersonas(personasRes.data || []);
      setRecentDrafts(draftsRes.data || []);
      setLoading(false);
    };

    load();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleDeletePersona = async (id: string, name: string) => {
    if (!confirm(`Delete persona "${name}"? This cannot be undone.`)) return;

    const { error } = await supabase.from("personas").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    setPersonas((prev) => prev.filter((p) => p.id !== id));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl font-bold">Persona OS</h1>
            {userEmail && <p className="text-sm text-zinc-500 mt-1">{userEmail}</p>}
          </div>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            <a href="/dashboard" className="text-white font-medium">
              Dashboard
            </a>
            <a href="/dashboard/generate" className="text-zinc-400 hover:text-white">
              Generate
            </a>
            <a href="/dashboard/check" className="text-zinc-400 hover:text-white">
              Check
            </a>
            <a href="/dashboard/vault" className="text-zinc-400 hover:text-white">
              Vault
            </a>
            <a href="/dashboard/drafts" className="text-zinc-400 hover:text-white">
              Drafts
            </a>
            <a href="/dashboard/personas/new" className="text-zinc-400 hover:text-white">
              + New
            </a>
            <button onClick={handleLogout} className="text-zinc-400 hover:text-white">
              Logout
            </button>
          </nav>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-12">
          <a
            href="/dashboard/generate"
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition"
          >
            <h2 className="font-semibold mb-1">Generate</h2>
            <p className="text-zinc-400 text-sm">AI content</p>
          </a>
          <a
            href="/dashboard/check"
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition"
          >
            <h2 className="font-semibold mb-1">Check</h2>
            <p className="text-zinc-400 text-sm">Consistency</p>
          </a>
          <a
            href="/dashboard/vault"
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition"
          >
            <h2 className="font-semibold mb-1">Vault</h2>
            <p className="text-zinc-400 text-sm">Assets</p>
          </a>
          <a
            href="/dashboard/personas/new"
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition"
          >
            <h2 className="font-semibold mb-1">New Persona</h2>
            <p className="text-zinc-400 text-sm">Create</p>
          </a>
        </div>

        <div className="mb-12">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-semibold">Your Personas</h2>
            <a
              href="/dashboard/personas/new"
              className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
            >
              + New
            </a>
          </div>

          {personas.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
              <p className="text-zinc-400 mb-4">No personas yet.</p>
              <a
                href="/dashboard/personas/new"
                className="inline-block px-5 py-2.5 bg-white text-black rounded-lg text-sm font-medium"
              >
                Create your first persona
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {personas.map((persona) => (
                <div
                  key={persona.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition group relative"
                >
                  <a href={`/dashboard/personas/${persona.id}`} className="block">
                    <h3 className="text-lg font-semibold mb-2">{persona.name}</h3>
                    <p className="text-sm text-zinc-400 line-clamp-3 mb-3">
                      {persona.backstory || "No backstory."}
                    </p>
                    {persona.tone_of_voice && (
                      <p className="text-xs text-zinc-500 mb-2">Tone: {persona.tone_of_voice}</p>
                    )}
                    {persona.lifestyle_pillars?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {persona.lifestyle_pillars.slice(0, 3).map((pillar) => (
                          <span
                            key={pillar}
                            className="text-xs px-2 py-0.5 bg-zinc-800 rounded-full text-zinc-300"
                          >
                            {pillar}
                          </span>
                        ))}
                      </div>
                    )}
                  </a>
                  <button
                    onClick={() => handleDeletePersona(persona.id, persona.name)}
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {recentDrafts.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold">Recent Drafts</h2>
              <a href="/dashboard/drafts" className="text-sm text-zinc-400 hover:text-white">
                View all →
              </a>
            </div>
            <div className="space-y-3">
              {recentDrafts.map((draft) => (
                <div key={draft.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="uppercase text-xs tracking-wide text-zinc-500">
                        {draft.type.replace("_", " ")}
                      </span>
                      <span className="text-zinc-600">•</span>
                      <span className="text-zinc-400">
                        {(draft.personas as any)?.name || "Unknown"}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-600">
                      {new Date(draft.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 line-clamp-2">{draft.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
