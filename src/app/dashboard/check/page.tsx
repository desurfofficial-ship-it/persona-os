"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

function CheckContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("persona");

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [rewritten, setRewritten] = useState("");
  const [loading, setLoading] = useState(false);
  const [rewriting, setRewriting] = useState(false);
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
      if (preselectedId) setSelectedId(preselectedId);
      else if (data && data.length > 0) setSelectedId(data[0].id);
    };
    load();
  }, [router, preselectedId]);

  const selectedPersona = personas.find((p) => p.id === selectedId);

  const handleCheck = async () => {
    if (!selectedPersona || !text.trim()) return;
    setLoading(true);
    setError(null);
    setResult("");
    setRewritten("");

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

  const handleRewrite = async () => {
    if (!selectedPersona || !text.trim()) return;
    setRewriting(true);
    setError(null);
    setRewritten("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          type: "rewrite",
          topic: text,
          model: "openai/gpt-4o-mini",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rewrite failed");

      setRewritten(data.content);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRewriting(false);
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
              Paste content to check or rewrite
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Paste a caption, script, post, or any text..."
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleCheck}
              disabled={loading || !selectedPersona || !text.trim()}
              className="py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
            >
              {loading ? "Checking..." : "Check Consistency"}
            </button>
            <button
              onClick={handleRewrite}
              disabled={rewriting || !selectedPersona || !text.trim()}
              className="py-3 border border-zinc-600 font-medium rounded-lg hover:bg-zinc-800 disabled:opacity-50"
            >
              {rewriting ? "Rewriting..." : "Rewrite in my voice"}
            </button>
          </div>

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

          {rewritten && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium">Rewritten in your voice</h3>
                <button
                  onClick={() => navigator.clipboard.writeText(rewritten)}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Copy
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-zinc-200 text-sm leading-relaxed">
                {rewritten}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConsistencyCheckPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400">Loading...</div>
      }
    >
      <CheckContent />
    </Suspense>
  );
}
