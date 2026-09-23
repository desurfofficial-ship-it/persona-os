"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, authedFetch } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

interface Draft {
  id: string;
  persona_id: string;
  type: string;
  content: string;
  created_at: string;
  posted?: boolean;
  performance?: string | null;
  tags?: unknown;
  personas?: { name: string };
}

const PLATFORMS = ["X", "LinkedIn", "Instagram", "Threads", "TikTok", "YouTube", "Other"];

function draftTags(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw as unknown[]).filter((t): t is string => typeof t === "string") : [];
}

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPersona, setFilterPersona] = useState("all");
  const [filterPosted, setFilterPosted] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [improvingId, setImprovingId] = useState<string | null>(null);
  const [improvedContent, setImprovedContent] = useState<Record<string, string>>({});
  const [taggingId, setTaggingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const [draftsRes, personasRes] = await Promise.all([
        supabase
          .from("content_drafts")
          .select("*, personas(name)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase.from("personas").select("*").eq("user_id", user.id),
      ]);

      setDrafts(draftsRes.data || []);
      setPersonas(personasRes.data || []);
      setLoading(false);
    };
    load();
  }, [router]);

  const filtered = drafts.filter((d) => {
    const matchesSearch =
      !search ||
      d.content.toLowerCase().includes(search.toLowerCase()) ||
      d.type.toLowerCase().includes(search.toLowerCase()) ||
      ((d.personas as any)?.name || "").toLowerCase().includes(search.toLowerCase());

    const matchesPersona = filterPersona === "all" || d.persona_id === filterPersona;
    const matchesPosted =
      filterPosted === "all" ||
      (filterPosted === "posted" && d.posted) ||
      (filterPosted === "unposted" && !d.posted);

    return matchesSearch && matchesPersona && matchesPosted;
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} draft(s)?`)) return;

    const ids = Array.from(selectedIds);
    await supabase.from("content_drafts").delete().in("id", ids);
    setDrafts((prev) => prev.filter((d) => !selectedIds.has(d.id)));
    setSelectedIds(new Set());
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    await supabase.from("content_drafts").delete().eq("id", id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  const togglePosted = async (draft: Draft) => {
    const newValue = !draft.posted;
    setDrafts((prev) =>
      prev.map((d) => (d.id === draft.id ? { ...d, posted: newValue } : d))
    );

    const { error } = await supabase
      .from("content_drafts")
      .update({ posted: newValue })
      .eq("id", draft.id);

    if (error) {
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, posted: draft.posted } : d))
      );
      console.error(error);
    }
  };

  const setPerformance = async (draft: Draft, value: "worked" | "ok" | "flopped" | null) => {
    const next = draft.performance === value ? null : value;
    setDrafts((prev) =>
      prev.map((d) => (d.id === draft.id ? { ...d, performance: next } : d))
    );

    const { error } = await supabase
      .from("content_drafts")
      .update({ performance: next })
      .eq("id", draft.id);

    if (error) {
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, performance: draft.performance } : d))
      );
      // Column may not exist yet
      if (error.message?.includes("performance")) {
        alert("Run this in Supabase SQL once:\nalter table content_drafts add column if not exists performance text;");
      }
    }
  };

  const handleSuggestTags = async (draft: Draft) => {
    if (taggingId) return;
    setTaggingId(draft.id);
    try {
      const res = await authedFetch("/api/tag-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tag suggestion failed");
      const tags: string[] = Array.isArray(data.tags) ? data.tags : [];
      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, tags } : d)));
      if (!tags.length) alert("No tags came back for this one — try again after editing it.");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setTaggingId(null);
    }
  };

  const handleImprove = async (draft: Draft) => {
    setImprovingId(draft.id);
    try {
      const persona = personas.find((p) => p.id === draft.persona_id);
      if (!persona) throw new Error("Persona not found");

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          type: draft.type,
          topic: `Improve and tighten this existing ${draft.type}. Keep the same core message but make it stronger, more in character, and higher quality:\n\n${draft.content}`,
          model: "openai/gpt-4o-mini",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Improve failed");

      setImprovedContent((prev) => ({ ...prev, [draft.id]: data.content }));

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("content_drafts").insert({
          persona_id: draft.persona_id,
          user_id: user.id,
          type: draft.type,
          content: data.content,
        });
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setImprovingId(null);
    }
  };

  const handleExport = () => {
    const text = filtered
      .map(
        (d) =>
          `=== ${(d.personas as any)?.name || "Unknown"} | ${d.type} | ${new Date(
            d.created_at
          ).toLocaleString()} ${d.posted ? "| POSTED" : ""} ${d.performance ? "| " + d.performance : ""} ===\n${d.content}\n`
      )
      .join("\n\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `persona-os-drafts-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Export selected (or filtered unposted) as a scheduler-ready post pack */
  const handleExportPack = () => {
    const source =
      selectedIds.size > 0 ? filtered.filter((d) => selectedIds.has(d.id)) : filtered.filter((d) => !d.posted);

    if (source.length === 0) {
      alert("Select drafts or have unposted drafts to export a pack.");
      return;
    }

    const pack = source
      .map((d, i) => {
        const day = i + 1;
        return `--- Day ${day} | ${d.type.replace("_", " ")} | ${(d.personas as any)?.name || ""} ---\n${d.content}`;
      })
      .join("\n\n");

    const header = `Persona OS Post Pack\nGenerated ${new Date().toLocaleString()}\n${source.length} posts\nPaste into Typefully, Buffer, or Notion.\n\n`;
    const full = header + pack;

    navigator.clipboard.writeText(full);
    const blob = new Blob([full], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `post-pack-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    alert(`Post pack copied + downloaded (${source.length} posts).`);
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
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
              ← Dashboard
            </a>
            <h1 className="text-2xl font-bold">Content Drafts</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-900/50 border border-red-800 text-red-200 rounded-lg text-sm"
              >
                Delete ({selectedIds.size})
              </button>
            )}
            <button
              onClick={handleExportPack}
              className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
            >
              Export post pack
            </button>
            <button
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="px-4 py-2 border border-zinc-700 rounded-lg text-sm hover:bg-zinc-900 disabled:opacity-40"
            >
              Export all
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search drafts..."
            className="flex-1 px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
          />
          <select
            value={filterPersona}
            onChange={(e) => setFilterPersona(e.target.value)}
            className="px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
          >
            <option value="all">All Personas</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={filterPosted}
            onChange={(e) => setFilterPosted(e.target.value)}
            className="px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
          >
            <option value="all">All</option>
            <option value="posted">Posted</option>
            <option value="unposted">Not Posted</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
            <p className="text-zinc-400 mb-4">
              {drafts.length === 0 ? "No drafts yet." : "No drafts match your filters."}
            </p>
            {drafts.length === 0 && (
              <a
                href="/dashboard/generate"
                className="inline-block px-5 py-2.5 bg-white text-black rounded-lg text-sm font-medium"
              >
                Generate content
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((draft) => (
              <div
                key={draft.id}
                className={`bg-zinc-900 border rounded-xl p-5 transition ${
                  selectedIds.has(draft.id) ? "border-zinc-500" : "border-zinc-800"
                }`}
              >
                <div className="flex items-start justify-between mb-3 gap-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(draft.id)}
                      onChange={() => toggleSelect(draft.id)}
                      className="mt-1"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-zinc-500">
                          {draft.type.replace("_", " ")}
                        </span>
                        {draft.posted && (
                          <span className="text-xs px-1.5 py-0.5 bg-green-900/40 text-green-300 rounded">
                            Posted
                          </span>
                        )}
                        {draft.performance === "worked" && (
                          <span className="text-xs px-1.5 py-0.5 bg-emerald-900/40 text-emerald-300 rounded">
                            Worked
                          </span>
                        )}
                        {draft.performance === "flopped" && (
                          <span className="text-xs px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded">
                            Flopped
                          </span>
                        )}
                        {draft.performance === "ok" && (
                          <span className="text-xs px-1.5 py-0.5 bg-zinc-700 text-zinc-300 rounded">
                            OK
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-400 mt-0.5">
                        {(draft.personas as any)?.name || "Unknown"} ·{" "}
                        {new Date(draft.created_at).toLocaleString()}
                      </p>
                      {draftTags(draft.tags).length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {draftTags(draft.tags).map((t) => (
                            <button
                              key={t}
                              onClick={() => setSearch(t)}
                              title={`Show everything tagged ${t}`}
                              className="text-[10px] px-1.5 py-0.5 rounded-full border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
                            >
                              #{t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      onClick={() => togglePosted(draft)}
                      className="text-xs px-2 py-1 border border-zinc-700 rounded hover:bg-zinc-800"
                    >
                      {draft.posted ? "Unmark" : "Mark Posted"}
                    </button>
                    <button
                      onClick={() => handleImprove(draft)}
                      disabled={improvingId === draft.id}
                      className="text-xs px-2 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {improvingId === draft.id ? "Improving..." : "Improve"}
                    </button>
                    <button
                      onClick={() => handleSuggestTags(draft)}
                      disabled={taggingId === draft.id}
                      className="text-xs px-2 py-1 border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {taggingId === draft.id ? "Suggesting…" : "# Suggest tags"}
                    </button>
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

                <div className="mt-3 pt-3 border-t border-zinc-800 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-500">How did it do?</span>
                  <button
                    onClick={() => setPerformance(draft, "worked")}
                    className={`text-xs px-2 py-1 rounded border ${
                      draft.performance === "worked"
                        ? "border-emerald-600 bg-emerald-900/40 text-emerald-200"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    Worked
                  </button>
                  <button
                    onClick={() => setPerformance(draft, "ok")}
                    className={`text-xs px-2 py-1 rounded border ${
                      draft.performance === "ok"
                        ? "border-zinc-500 bg-zinc-700 text-zinc-200"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    OK
                  </button>
                  <button
                    onClick={() => setPerformance(draft, "flopped")}
                    className={`text-xs px-2 py-1 rounded border ${
                      draft.performance === "flopped"
                        ? "border-red-600 bg-red-900/40 text-red-200"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    Flopped
                  </button>
                </div>

                {improvedContent[draft.id] && (
                  <div className="mt-4 pt-4 border-t border-zinc-800">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-green-400 font-medium">Improved version</p>
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(improvedContent[draft.id])
                        }
                        className="text-xs text-zinc-400 hover:text-white"
                      >
                        Copy
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                      {improvedContent[draft.id]}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
