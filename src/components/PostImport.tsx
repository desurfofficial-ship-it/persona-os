"use client";

import { useState } from "react";

/**
 * Read-only profile import panel: paste an X / LinkedIn profile URL, we try
 * to pull recent post text; the user ticks what sounds like them and it is
 * appended (blank-line separated) to the parent's posts textarea.
 *
 * When the fetch fails (X and LinkedIn gate hard), it shows the server's
 * honest fallback hint — never fake results.
 */

interface Props {
  onAddPosts: (posts: string[]) => void;
}

export default function PostImport({ onAddPosts }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [added, setAdded] = useState(false);

  const handleImport = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setCandidates([]);
    setSelected(new Set());
    setAdded(false);

    try {
      const res = await fetch("/api/import-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setCandidates(data.posts || []);
      setSelected(new Set((data.posts || []).map((_: string, i: number) => i)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleAdd = () => {
    const picked = candidates.filter((_, i) => selected.has(i));
    if (picked.length === 0) return;
    onAddPosts(picked);
    setAdded(true);
    setCandidates([]);
    setUrl("");
  };

  const selectedCount = selected.size;

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 sm:p-5">
      <p className="text-sm font-medium text-zinc-200 mb-1">Import from a link (read-only)</p>
      <p className="text-xs text-zinc-500 mb-3">
        Paste your X or LinkedIn profile URL. We fetch recent post text — you pick which to use.
        Nothing is posted or written by this.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleImport()}
          placeholder="x.com/yourhandle or linkedin.com/in/you"
          className="flex-1 px-4 py-2.5 min-h-[44px] bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
          aria-label="Profile URL"
        />
        <button
          onClick={handleImport}
          disabled={loading || !url.trim()}
          className="px-5 min-h-[44px] bg-zinc-800 border border-zinc-600 rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? "Fetching..." : "Fetch posts"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-amber-300/90 leading-relaxed">{error}</p>}

      {added && (
        <p className="mt-3 text-xs text-green-400">Added to your posts below ✓</p>
      )}

      {candidates.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-zinc-400 mb-2">
            {candidates.length} candidate{candidates.length === 1 ? "" : "s"} found — untick anything that isn&apos;t a real post:
          </p>
          <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
            {candidates.map((c, i) => (
              <label
                key={i}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer ${
                  selected.has(i)
                    ? "border-zinc-500 bg-zinc-800/70 text-zinc-200"
                    : "border-zinc-800 text-zinc-500"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggle(i)}
                  className="mt-0.5 accent-white"
                />
                <span className="leading-relaxed">{c}</span>
              </label>
            ))}
          </div>
          <button
            onClick={handleAdd}
            disabled={selectedCount === 0}
            className="mt-3 w-full min-h-[44px] bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"
          >
            Add {selectedCount} post{selectedCount === 1 ? "" : "s"} to the box
          </button>
        </div>
      )}
    </div>
  );
}
