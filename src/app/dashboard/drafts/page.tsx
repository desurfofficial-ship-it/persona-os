"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { fetchVoiceSamples } from "@/lib/voiceSamples";
import { copyAndOpen } from "@/lib/share";
import { nextSevenDays } from "@/lib/calendar";
import { compactNumber, parseCount } from "@/lib/metrics";

interface Draft {
  id: string;
  persona_id: string;
  type: string;
  content: string;
  created_at: string;
  posted?: boolean;
  planned_for?: string | null;
  metrics?: unknown;
  personas?: { name: string };
}

interface DraftMetrics {
  platform: string;
  views: number;
  likes: number;
  comments: number;
  loggedAt: string;
}

const PLATFORMS = ["X", "LinkedIn", "Instagram", "Threads", "TikTok", "YouTube", "Other"];

function asMetrics(raw: unknown): DraftMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (!m.platform) return null;
  return {
    platform: String(m.platform),
    views: Number(m.views) || 0,
    likes: Number(m.likes) || 0,
    comments: Number(m.comments) || 0,
    loggedAt: String(m.loggedAt || ""),
  };
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
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [logForm, setLogForm] = useState({ platform: "X", views: "", likes: "", comments: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const planDays = nextSevenDays();
  const searchParams = useSearchParams();

  // Deep link from the Consistency Engine: /dashboard/drafts?q=<quote fragment>
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setSearch(q);
  }, [searchParams]);

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

  const planFor = async (draft: Draft, dayKey: string | null) => {
    const value = dayKey ? new Date(`${dayKey}T09:00:00`).toISOString() : null;
    // Optimistic
    setDrafts((prev) =>
      prev.map((d) => (d.id === draft.id ? { ...d, planned_for: value } : d))
    );
    const { error } = await supabase
      .from("content_drafts")
      .update({ planned_for: value })
      .eq("id", draft.id);
    if (error) {
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, planned_for: draft.planned_for } : d))
      );
      alert(error.message);
    }
  };

  const togglePosted = async (draft: Draft) => {
    const newValue = !draft.posted;
    // Optimistic update
    setDrafts((prev) =>
      prev.map((d) => (d.id === draft.id ? { ...d, posted: newValue } : d))
    );

    const { error } = await supabase
      .from("content_drafts")
      .update({ posted: newValue })
      .eq("id", draft.id);

    if (error) {
      // Revert on error
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, posted: draft.posted } : d))
      );
      console.error("Posted flag error:", error);
      return;
    }

    // First time marking posted -> invite logging performance right away.
    if (newValue && !draft.metrics) {
      setLogForm({ platform: "X", views: "", likes: "", comments: "" });
      setLoggingId(draft.id);
    }
  };

  const openLogForm = (draft: Draft) => {
    const existing = asMetrics(draft.metrics);
    setLogForm({
      platform: existing?.platform || "X",
      views: existing ? String(existing.views) : "",
      likes: existing ? String(existing.likes) : "",
      comments: existing ? String(existing.comments) : "",
    });
    setLoggingId(draft.id);
  };

  const saveMetrics = async (draft: Draft) => {
    const metrics: DraftMetrics = {
      platform: logForm.platform,
      views: parseCount(logForm.views) ?? 0,
      likes: parseCount(logForm.likes) ?? 0,
      comments: parseCount(logForm.comments) ?? 0,
      loggedAt: new Date().toISOString(),
    };
    // Never store an all-zero junk row — it would skew every average.
    if (metrics.views + metrics.likes + metrics.comments === 0) return;
    // Optimistic
    setDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, metrics } : d)));
    setLoggingId(null);

    const { error } = await supabase
      .from("content_drafts")
      .update({ metrics })
      .eq("id", draft.id);
    if (error) {
      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, metrics: draft.metrics } : d)));
      alert(error.message);
    }
  };

  const startEdit = (draft: Draft) => {
    setEditingId(draft.id);
    setEditText(draft.content);
    setMenuId(null);
  };

  const saveEdit = async (draft: Draft) => {
    const next = editText.trim();
    if (!next || next === draft.content) {
      setEditingId(null);
      return;
    }
    setSavingEdit(true);
    // Optimistic
    setDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, content: next } : d)));
    const { error } = await supabase
      .from("content_drafts")
      .update({ content: next })
      .eq("id", draft.id);
    setSavingEdit(false);
    if (error) {
      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, content: draft.content } : d)));
      alert(error.message);
      return;
    }
    setEditingId(null);
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
          voiceSamples: await fetchVoiceSamples(draft.persona_id),
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
          ).toLocaleString()} ${d.posted ? "| POSTED" : ""} ===\n${d.content}\n`
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
          <div className="flex gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-900/50 border border-red-800 text-red-200 rounded-lg text-sm"
              >
                Delete ({selectedIds.size})
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="px-4 py-2 border border-zinc-700 rounded-lg text-sm hover:bg-zinc-900 disabled:opacity-40"
            >
              Export
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
              {drafts.length === 0
                ? "No drafts yet."
                : search
                  ? searchParams.get("q")
                    ? "No drafts match this quote — you may have already edited or fixed the wording."
                    : `No drafts match “${search}”.`
                  : "No drafts match your filters."}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              {(search || filterPersona !== "all" || filterPosted !== "all") && (
                <button
                  onClick={() => {
                    setSearch("");
                    setFilterPersona("all");
                    setFilterPosted("all");
                    if (searchParams.get("q")) router.replace("/dashboard/drafts");
                  }}
                  className="px-4 py-2.5 border border-zinc-600 rounded-lg text-sm hover:bg-zinc-800"
                >
                  Clear search & filters
                </button>
              )}
              {drafts.length === 0 && (
                <a
                  href="/dashboard/generate"
                  className="inline-block px-5 py-2.5 bg-white text-black rounded-lg text-sm font-medium"
                >
                  Generate content
                </a>
              )}
            </div>
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
                <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-3 gap-3">
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
                          <span className="text-xs px-1.5 py-0.5 bg-green-900/40 text-green-300 rounded whitespace-nowrap">
                            Posted
                          </span>
                        )}
                        {asMetrics(draft.metrics) && (
                          <span className="text-xs px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded whitespace-nowrap">
                            {asMetrics(draft.metrics)!.platform} · {compactNumber(asMetrics(draft.metrics)!.views)} views
                          </span>
                        )}
                        {draft.planned_for && !draft.posted && (
                          <span className="text-xs px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded whitespace-nowrap">
                            Planned {new Date(draft.planned_for).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-400 mt-0.5">
                        {(draft.personas as any)?.name || "Unknown"} ·{" "}
                        {new Date(draft.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={
                        draft.planned_for
                          ? nextSevenDays().find(
                              (d) =>
                                new Date(draft.planned_for!).toDateString() ===
                                new Date(`${d.key}T00:00:00`).toDateString()
                            )?.key || ""
                          : ""
                      }
                      onChange={(e) => planFor(draft, e.target.value || null)}
                      title="Plan this draft for a day"
                      className="text-xs px-2 py-1.5 min-h-[36px] bg-zinc-900 border border-zinc-700 rounded"
                    >
                      <option value="">Plan day…</option>
                      {planDays.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => togglePosted(draft)}
                      className={`text-xs px-2 py-1.5 min-h-[36px] rounded font-medium ${
                        draft.posted
                          ? "border border-zinc-700 hover:bg-zinc-800"
                          : "bg-white text-black hover:bg-zinc-200"
                      }`}
                    >
                      {draft.posted ? "Unmark" : "Mark Posted"}
                    </button>
                    {draft.posted && (
                      <button
                        onClick={() => openLogForm(draft)}
                        title="Record how this post performed"
                        className="text-xs px-2 py-1.5 min-h-[36px] border border-blue-800 text-blue-300 rounded hover:bg-blue-950/50"
                      >
                        {asMetrics(draft.metrics) ? "Edit numbers" : "Log performance"}
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(draft)}
                      title="Edit this draft in place"
                      className="text-xs px-2 py-1.5 min-h-[36px] border border-zinc-700 rounded hover:bg-zinc-800"
                    >
                      Edit
                    </button>
                    {/* Secondary actions live in an overflow menu — the card
                        stays scannable on mobile instead of a button wall. */}
                    <div className="relative">
                      <button
                        onClick={() => setMenuId(menuId === draft.id ? null : draft.id)}
                        aria-expanded={menuId === draft.id}
                        aria-haspopup="true"
                        title="More actions"
                        className="text-xs px-2 py-1.5 min-h-[36px] border border-zinc-700 rounded hover:bg-zinc-800"
                      >
                        ⋯
                      </button>
                      {menuId === draft.id && (
                        <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl py-1.5 z-40">
                          {[
                            {
                              label: improvingId === draft.id ? "Improving…" : "✨ Improve with AI",
                              action: () => handleImprove(draft),
                              disabled: improvingId === draft.id,
                            },
                            {
                              label: "Copy & open X",
                              action: () => copyAndOpen(draft.content, "twitter"),
                            },
                            {
                              label: "Copy & open LinkedIn",
                              action: () => copyAndOpen(draft.content, "linkedin"),
                            },
                            {
                              label: "Copy text",
                              action: () => navigator.clipboard.writeText(draft.content),
                            },
                          ].map((item) => (
                            <button
                              key={item.label}
                              onClick={() => {
                                setMenuId(null);
                                item.action();
                              }}
                              disabled={item.disabled}
                              className="block w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                            >
                              {item.label}
                            </button>
                          ))}
                          <div className="border-t border-zinc-800 my-1" />
                          <button
                            onClick={() => {
                              setMenuId(null);
                              handleDelete(draft.id);
                            }}
                            className="block w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-zinc-800"
                          >
                            Delete draft
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {editingId === draft.id ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={Math.min(16, Math.max(4, Math.ceil(editText.length / 80)))}
                      className="w-full px-3 py-2.5 bg-zinc-950 border border-zinc-600 rounded-lg text-sm text-zinc-100 leading-relaxed"
                    />
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        onClick={() => saveEdit(draft)}
                        disabled={savingEdit}
                        className="text-xs px-3 py-2 min-h-[36px] bg-white text-black rounded font-medium hover:bg-zinc-200 disabled:opacity-50"
                      >
                        {savingEdit ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs px-3 py-2 min-h-[36px] border border-zinc-700 rounded hover:bg-zinc-800"
                      >
                        Cancel
                      </button>
                      <p className="text-xs text-zinc-500 self-center">
                        Editing updates the draft everywhere — the Consistency Engine re-checks on
                        the next scan.
                      </p>
                    </div>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                    {draft.content}
                  </pre>
                )}

                {loggingId === draft.id && (
                  <div className="mt-4 pt-4 border-t border-zinc-800">
                    <p className="text-xs text-blue-300 font-medium mb-2">
                      Log performance — numbers only you can see
                    </p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <select
                        value={logForm.platform}
                        onChange={(e) => setLogForm((f) => ({ ...f, platform: e.target.value }))}
                        className="text-xs px-2 py-2 min-h-[36px] bg-zinc-900 border border-zinc-700 rounded"
                      >
                        {PLATFORMS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Views"
                        value={logForm.views}
                        onChange={(e) => setLogForm((f) => ({ ...f, views: e.target.value }))}
                        className="w-24 text-xs px-2 py-2 min-h-[36px] bg-zinc-900 border border-zinc-700 rounded"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Likes"
                        value={logForm.likes}
                        onChange={(e) => setLogForm((f) => ({ ...f, likes: e.target.value }))}
                        className="w-20 text-xs px-2 py-2 min-h-[36px] bg-zinc-900 border border-zinc-700 rounded"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Comments"
                        value={logForm.comments}
                        onChange={(e) => setLogForm((f) => ({ ...f, comments: e.target.value }))}
                        className="w-24 text-xs px-2 py-2 min-h-[36px] bg-zinc-900 border border-zinc-700 rounded"
                      />
                      <button
                        onClick={() => saveMetrics(draft)}
                        disabled={
                          (parseCount(logForm.views) ?? 0) +
                            (parseCount(logForm.likes) ?? 0) +
                            (parseCount(logForm.comments) ?? 0) ===
                          0
                        }
                        title="Paste numbers exactly as the platform shows them — 12,500 and 1.2K both work"
                        className="text-xs px-3 py-2 min-h-[36px] bg-white text-black rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setLoggingId(null)}
                        className="text-xs px-2 py-2 min-h-[36px] border border-zinc-700 rounded"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                )}

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
