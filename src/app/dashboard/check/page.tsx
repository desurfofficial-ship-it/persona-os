"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

export default function ConsistencyCheckPage() {
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data } = await supabase
        .from("personas")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      setPersonas(data || []);
      if (data && data.length > 0) setSelectedId(data[0].id);
    };
    load();
  }, [router]);

  const selectedPersona = personas.find((p) => p.id === selectedId);

  const handleCheck = async () => {
    if (!selectedPersona || !text.trim()) return;
    setLoading(true);
    setError(null);
    setResult("");

    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          text,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed");

      setResult(data.content);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Consistency Checker</h1>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Persona</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {selectedPersona && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-400">
              <p className="font-medium text-zinc-200">{selectedPersona.name}</p>
              <p className="line-clamp-2 mt-1">{selectedPersona.backstory}</p>
            </div>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Paste content to check
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Paste a caption, script, post, or any text you want to verify against this persona..."
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            />
          </div>

          <button
            onClick={handleCheck}
            disabled={loading || !selectedPersona || !text.trim()}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Checking..." : "Check Consistency"}
          </button>

          {error && (
            <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <h3 className="font-medium mb-3">Analysis</h3>
              <pre className="whitespace-pre-wrap text-zinc-200 text-sm leading-relaxed">
                {result}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
