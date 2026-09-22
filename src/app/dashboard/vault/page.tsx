"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
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
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPersonaId) return;

    setUploading(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upload to Supabase Storage
      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("assets")
        .upload(fileName, file);

      if (uploadError) {
        // If bucket doesn't exist, give clear instructions
        if (uploadError.message.includes("Bucket not found") || uploadError.message.includes("not found")) {
          throw new Error(
            'Storage bucket "assets" not found. Go to Supabase → Storage → New bucket → name it "assets" → make it Public → then try again.'
          );
        }
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("assets").getPublicUrl(fileName);

      const type = file.type.startsWith("video") ? "video" : "image";

      const { error: insertError } = await supabase.from("assets").insert({
        persona_id: selectedPersonaId,
        user_id: user.id,
        type,
        url: publicUrl,
        tags: [],
      });

      if (insertError) throw insertError;

      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string, url: string | null) => {
    if (!confirm("Delete this asset?")) return;

    try {
      // Optional: delete from storage too
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
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
              ← Dashboard
            </a>
            <h1 className="text-2xl font-bold">Asset Vault</h1>
          </div>
        </div>

        {/* Upload section */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
          <h2 className="font-medium mb-4">Upload Asset</h2>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <div className="flex-1">
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

        {/* Assets grid */}
        {assets.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
            <p className="text-zinc-400">No assets yet. Upload your first image or video above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {assets.map((asset) => (
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
                <div className="p-3">
                  <p className="text-xs text-zinc-400 truncate">
                    {(asset.personas as any)?.name || "Unknown"}
                  </p>
                  <p className="text-xs text-zinc-600">
                    {new Date(asset.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(asset.id, asset.url)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-black/70 text-white text-xs px-2 py-1 rounded transition"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
