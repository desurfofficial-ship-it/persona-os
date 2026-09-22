"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase, authedFetch } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

interface Asset {
  id: string;
  persona_id: string;
  type: string;
  url: string | null;
  content: string | null;
  tags: string[];
  created_at: string;
  personas?: { name: string };
}

export default function VaultPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [filterPersonaId, setFilterPersonaId] = useState("all");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taggingId, setTaggingId] = useState<string | null>(null); // asset being auto-tagged
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");

  const loadData = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const [assetsRes, personasRes] = await Promise.all([
      supabase
        .from("assets")
        .select("*, personas(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("personas")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

    setAssets(assetsRes.data || []);
    setPersonas(personasRes.data || []);
    if (personasRes.data && personasRes.data.length > 0 && !selectedPersonaId) {
      setSelectedPersonaId(personasRes.data[0].id);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [router]);

  const allTags = Array.from(
    new Set(assets.flatMap((a) => (Array.isArray(a.tags) ? a.tags : [])))
  ).sort();

  const filteredAssets =
    filterPersonaId === "all"
      ? assets
      : assets.filter((a) => a.persona_id === filterPersonaId);

  const tagFilteredAssets = filterTag
    ? filteredAssets.filter((a) => Array.isArray(a.tags) && a.tags.includes(filterTag))
    : filteredAssets;

  const searchedAssets = search.trim()
    ? tagFilteredAssets.filter((a) => {
        const q = search.trim().toLowerCase();
        return (
          (Array.isArray(a.tags) && a.tags.some((t) => t.toLowerCase().includes(q))) ||
          ((a.personas as any)?.name || "").toLowerCase().includes(q) ||
          (a.content || "").toLowerCase().includes(q)
        );
      })
    : tagFilteredAssets;

  const autoTag = async (assetId: string) => {
    setTaggingId(assetId);
    try {
      const res = await authedFetch("/api/auto-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const data = await res.json();
      if (res.ok && data.tags) {
        setAssets((prev) =>
          prev.map((a) => (a.id === assetId ? { ...a, tags: data.tags } : a))
        );
      }
    } catch {
      // silent — user can tag manually
    } finally {
      setTaggingId(null);
    }
  };

  const addTag = async (assetId: string, presetTag?: string) => {
    const tag = (presetTag ?? newTag).trim().toLowerCase();
    if (!tag) return;
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;

    const tags = Array.from(new Set([...(asset.tags || []), tag]));
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, tags } : a)));
    setNewTag("");
    setEditingTagId(null);

    await supabase.from("assets").update({ tags }).eq("id", assetId);
  };

  const removeTag = async (assetId: string, tag: string) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;

    const tags = (asset.tags || []).filter((t) => t !== tag);
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, tags } : a)));

    await supabase.from("assets").update({ tags }).eq("id", assetId);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPersonaId) return;

    setUploading(true);
    setError(null);

    let createdAssetId: string | null = null;

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("assets")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("assets").getPublicUrl(fileName);

      const type = file.type.startsWith("video") ? "video" : "image";

      const { data: inserted, error: insertError } = await supabase.from("assets").insert({
        persona_id: selectedPersonaId,
        user_id: user.id,
        type,
        url: publicUrl,
        tags: [],
      });

      if (insertError) throw insertError;
      createdAssetId = (inserted as any)?.[0]?.id || null;

      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }

    // Auto-tag right after the asset lands (non-blocking errors are fine).
    if (createdAssetId) await autoTag(createdAssetId);
  };

  const handleDelete = async (id: string, url: string | null) => {
    if (!confirm("Delete this asset?")) return;

    try {
      if (url) {
        const path = url.split("/assets/")[1];
        if (path) {
          await supabase.storage.from("assets").remove([path]);
        }
      }
      await supabase.from("assets").delete().eq("id", id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const writeForAsset = (asset: Asset) => {
    router.push(`/dashboard/generate?persona=${asset.persona_id}&asset=${asset.id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Asset Vault</h1>
        </div>

        {/* Upload */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
          <h2 className="font-medium mb-1">Upload Asset</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Images get auto-tagged on upload. Every asset has a{" "}
            <span className="text-zinc-300">&quot;Write for this&quot;</span> button — the words
            will match what&apos;s in the frame.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <div className="flex-1 w-full">
              <label className="block text-sm text-zinc-400 mb-2">Attach to Persona</label>
              <select
                value={selectedPersonaId}
                onChange={(e) => setSelectedPersonaId(e.target.value)}
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg"
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleUpload}
                disabled={uploading || !selectedPersonaId}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className={`inline-block px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer ${
                  uploading || !selectedPersonaId
                    ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                    : "bg-white text-black hover:bg-zinc-200"
                }`}
              >
                {uploading ? "Uploading..." : "Choose Image / Video"}
              </label>
            </div>
          </div>
          {error && (
            <p className="mt-4 text-sm text-red-400 bg-red-900/30 p-3 rounded-lg">{error}</p>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vault — tags, persona, anything…"
              className="flex-1 px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
            />
            <select
              value={filterPersonaId}
              onChange={(e) => setFilterPersonaId(e.target.value)}
              className="px-3 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm"
            >
              <option value="all">All Personas</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFilterTag(null)}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  !filterTag
                    ? "bg-white text-black border-white"
                    : "border-zinc-700 text-zinc-400 hover:text-white"
                }`}
              >
                all
              </button>
              {allTags.slice(0, 12).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterTag(filterTag === t ? null : t)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    filterTag === t
                      ? "bg-white text-black border-white"
                      : "border-zinc-700 text-zinc-400 hover:text-white"
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grid */}
        {searchedAssets.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
            <p className="text-zinc-400">
              {search
                ? `Nothing matches “${search}”.`
                : filterTag
                  ? `No assets tagged #${filterTag}.`
                  : "No assets yet."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {searchedAssets.map((asset) => (
              <div
                key={asset.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden group relative"
              >
                {asset.type === "image" && asset.url ? (
                  <img
                    src={asset.url}
                    alt="Asset"
                    className="w-full aspect-square object-cover"
                  />
                ) : asset.type === "video" && asset.url ? (
                  <video
                    src={asset.url}
                    className="w-full aspect-square object-cover"
                    controls
                  />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center text-zinc-500 text-sm">
                    {asset.type}
                  </div>
                )}

                <button
                  onClick={() => handleDelete(asset.id, asset.url)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-black/70 text-white text-xs px-2 py-1 rounded transition"
                >
                  Delete
                </button>

                <div className="p-3">
                  <p className="text-xs text-zinc-400 truncate">
                    {(asset.personas as any)?.name || "Unknown"}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mt-1.5 min-h-[20px]">
                    {(asset.tags || []).map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-zinc-800 rounded-full text-zinc-300"
                      >
                        #{t}
                        <button
                          onClick={() => removeTag(asset.id, t)}
                          className="text-zinc-500 hover:text-red-400"
                          aria-label={`Remove tag ${t}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {editingTagId === asset.id ? (
                      <span className="flex flex-col gap-1 items-start">
                        <input
                          autoFocus
                          value={newTag}
                          onChange={(e) => setNewTag(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addTag(asset.id);
                            if (e.key === "Escape") setEditingTagId(null);
                          }}
                          onBlur={() => addTag(asset.id)}
                          placeholder="tag… (mood, place, campaign)"
                          className="w-32 text-[10px] px-1.5 py-0.5 bg-zinc-950 border border-zinc-600 rounded-full outline-none"
                        />
                        <span className="flex flex-wrap gap-1">
                          {["luxury", "casual", "professional", "night", "beach", "office", "gym", "travel"]
                            .filter((s) => !(asset.tags || []).includes(s))
                            .slice(0, 4)
                            .map((s) => (
                              <button
                                key={s}
                                onClick={() => addTag(asset.id, s)}
                                className="text-[9px] px-1.5 py-0.5 border border-dashed border-zinc-600 rounded-full text-zinc-500 hover:text-white"
                              >
                                {s}
                              </button>
                            ))}
                        </span>
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingTagId(asset.id);
                          setNewTag("");
                        }}
                        className="text-[10px] px-1.5 py-0.5 border border-dashed border-zinc-600 rounded-full text-zinc-500 hover:text-white"
                      >
                        + tag
                      </button>
                    )}
                    {taggingId === asset.id && (
                      <span className="text-[10px] text-zinc-500 animate-pulse">tagging…</span>
                    )}
                  </div>

                  {/* The vault→generate loop */}
                  <button
                    onClick={() => writeForAsset(asset)}
                    className="mt-2.5 w-full min-h-[38px] bg-zinc-800 border border-zinc-600 rounded-lg text-xs font-medium hover:bg-zinc-700"
                  >
                    ✍ Write for this
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
