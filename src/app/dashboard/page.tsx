"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

export default function DashboardPage() {
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
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

      const { data, error } = await supabase
        .from("personas")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
      } else {
        setPersonas(data || []);
      }

      setLoading(false);
    };

    load();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-3xl font-bold">Persona OS</h1>
            {userEmail && (
              <p className="text-sm text-zinc-500 mt-1">{userEmail}</p>
            )}
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <a href="/dashboard" className="text-white">
              Dashboard
            </a>
            <a href="/dashboard/generate" className="text-zinc-400 hover:text-white">
              Generate
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
            <button
              onClick={handleLogout}
              className="text-zinc-400 hover:text-white"
            >
              Logout
            </button>
          </nav>
        </header>

        <div className="mb-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Your Personas</h2>
            <a
              href="/dashboard/personas/new"
              className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
            >
              + New Persona
            </a>
          </div>

          {personas.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
              <p className="text-zinc-400 mb-4">No personas yet.</p>
              <a
                href="/dashboard/personas/new"
                className="inline-block px-5 py-2.5 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
              >
                Create your first persona
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {personas.map((persona) => (
                <a
                  key={persona.id}
                  href={`/dashboard/personas/${persona.id}`}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-zinc-600 transition block"
                >
                  <h3 className="text-lg font-semibold mb-2">{persona.name}</h3>
                  <p className="text-sm text-zinc-400 line-clamp-3 mb-4">
                    {persona.backstory || "No backstory yet."}
                  </p>
                  {persona.tone_of_voice && (
                    <p className="text-xs text-zinc-500 mb-2">
                      Tone: {persona.tone_of_voice}
                    </p>
                  )}
                  {persona.lifestyle_pillars?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {persona.lifestyle_pillars.map((pillar) => (
                        <span
                          key={pillar}
                          className="text-xs px-2 py-1 bg-zinc-800 rounded-full text-zinc-300"
                        >
                          {pillar}
                        </span>
                      ))}
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <a
            href="/dashboard/generate"
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-zinc-600 transition"
          >
            <h2 className="text-lg font-semibold mb-2">AI Generate</h2>
            <p className="text-zinc-400 text-sm">
              Captions, scripts, story arcs & image prompts that stay in character
            </p>
          </a>
          <a
            href="/dashboard/vault"
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-zinc-600 transition"
          >
            <h2 className="text-lg font-semibold mb-2">Asset Vault</h2>
            <p className="text-zinc-400 text-sm">
              Upload and organize photos & videos for each persona
            </p>
          </a>
          <a
            href="/dashboard/drafts"
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-zinc-600 transition"
          >
            <h2 className="text-lg font-semibold mb-2">Content Drafts</h2>
            <p className="text-zinc-400 text-sm">
              All previously generated content in one place
            </p>
          </a>
        </div>
      </div>
    </div>
  );
}
