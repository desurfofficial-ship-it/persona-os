"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Draft {
  id: string;
  persona_id: string;
  type: string;
  content: string;
  created_at: string;
  personas?: { name: string };
}

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

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
        .from("content_drafts")
        .select("*, personas(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      setDrafts(data || []);
      setLoading(false);
    };
    load();
  }, [router]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    await supabase.from("content_drafts").delete().eq("id", id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
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
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Content Drafts</h1>
        </div>

        {drafts.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
            <p className="text-zinc-400 mb-4">No drafts yet.</p>
            <a
              href="/dashboard/generate"
              className="inline-block px-5 py-2.5 bg-white text-black rounded-lg text-sm font-medium"
            >
              Generate your first content
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="text-xs uppercase tracking-wide text-zinc-500">
                      {draft.type.replace("_", " ")}
                    </span>
                    <p className="text-sm text-zinc-400 mt-0.5">
                      {(draft.personas as any)?.name || "Unknown persona"} ·{" "}
                      {new Date(draft.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(draft.content)}
                      className="text-xs text-zinc-400 hover:text-white px-2 py-1"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => handleDelete(draft.id)}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                  {draft.content}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
