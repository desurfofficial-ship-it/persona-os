"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface ConnectedAccount {
  id: string;
  platform: string;
  handle: string;
  profile_url: string | null;
  status: string;
  last_synced_at: string | null;
}

export default function ConnectPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [platform, setPlatform] = useState<"x" | "linkedin">("x");
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadAccounts = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data } = await supabase
      .from("connected_accounts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setAccounts(data || []);
  };

  useEffect(() => {
    loadAccounts();
  }, [router]);

  const saveAccount = async (h: string, p: string, status: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const profile_url =
      p === "x" ? `https://x.com/${h}` : `https://www.linkedin.com/in/${h}`;

    await supabase.from("connected_accounts").upsert(
      {
        user_id: user.id,
        platform: p,
        handle: h,
        profile_url,
        status,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform,handle" }
    );
    await loadAccounts();
  };

  const handleConnectAndBuild = async () => {
    if (!handle.trim()) return;
    setLoading(true);
    setError(null);
    setInfo(null);

    const h = handle.replace(/^@/, "").trim();

    try {
      if (platform === "linkedin") {
        await saveAccount(h, "linkedin", "linked");
        setInfo("LinkedIn handle saved. Use Build from Posts with your public profile URL or paste posts — LinkedIn blocks automated post pulls.");
        setLoading(false);
        return;
      }

      // X: try fetch posts then analyze → create persona
      const fetchRes = await fetch("/api/fetch-account-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "x", handle: h }),
      });
      const fetchData = await fetchRes.json();

      if (!fetchRes.ok) {
        await saveAccount(h, "x", "error");
        throw new Error(fetchData.error || "Could not fetch posts");
      }

      await saveAccount(h, "x", "linked");
      setInfo(`Pulled ${fetchData.posts?.length || 0} snippets. Building persona…`);

      const analyzeRes = await fetch("/api/analyze-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts: fetchData.combined }),
      });
      const preview = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(preview.error || "Analyze failed");

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");

      const example_posts =
        preview.example_posts?.length > 0
          ? preview.example_posts
          : (fetchData.posts || []).slice(0, 8);

      const { data: inserted, error: insertError } = await supabase
        .from("personas")
        .insert({
          user_id: user.id,
          name: preview.name || h,
          backstory: preview.backstory || "",
          tone_of_voice: preview.tone_of_voice || "",
          lifestyle_pillars: preview.lifestyle_pillars || [],
          content_rules: preview.content_rules || [],
          forbidden_topics: preview.forbidden_topics || [],
          example_posts,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      if (inserted?.id) {
        router.push(`/dashboard/generate?persona=${inserted.id}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    await supabase.from("connected_accounts").delete().eq("id", id);
    await loadAccounts();
  };

  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Connect account</h1>
        </div>

        <p className="text-zinc-400 text-sm mb-2">
          Optional — link a public handle so we can learn your voice. You can skip this and paste
          posts anytime.
        </p>
        <p className="text-zinc-500 text-xs mb-8">
          No full OAuth required for X: we only use your public handle. Private accounts won’t work.
        </p>

        <div className="space-y-5 bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Platform</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPlatform("x")}
                className={`px-4 py-2 rounded-lg text-sm ${
                  platform === "x" ? "bg-white text-black" : "bg-zinc-800 text-zinc-300"
                }`}
              >
                X (Twitter)
              </button>
              <button
                type="button"
                onClick={() => setPlatform("linkedin")}
                className={`px-4 py-2 rounded-lg text-sm ${
                  platform === "linkedin" ? "bg-white text-black" : "bg-zinc-800 text-zinc-300"
                }`}
              >
                LinkedIn
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              {platform === "x" ? "Handle" : "Profile slug or name"}
            </label>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder={platform === "x" ? "@yourhandle" : "your-linkedin-slug"}
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg"
            />
          </div>

          <button
            onClick={handleConnectAndBuild}
            disabled={loading || !handle.trim()}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading
              ? "Connecting…"
              : platform === "x"
                ? "Connect X & build persona"
                : "Save LinkedIn handle"}
          </button>

          {error && (
            <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
              <div className="mt-2">
                <a href="/dashboard/personas/from-posts" className="underline text-red-100">
                  Paste posts instead →
                </a>
              </div>
            </div>
          )}

          {info && (
            <div className="p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 text-sm">
              {info}
              {platform === "linkedin" && (
                <a
                  href="/dashboard/personas/from-posts"
                  className="block mt-2 text-white underline"
                >
                  Continue on Build from Posts →
                </a>
              )}
            </div>
          )}
        </div>

        {accounts.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-zinc-400 mb-3">Linked accounts</h2>
            <div className="space-y-2">
              {accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {a.platform === "x" ? "X" : "LinkedIn"} · @{a.handle}
                    </p>
                    <p className="text-xs text-zinc-500 capitalize">{a.status}</p>
                  </div>
                  <button
                    onClick={() => handleDisconnect(a.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-10 text-center">
          <a href="/dashboard/personas/from-posts" className="text-sm text-zinc-500 hover:text-white">
            Skip — paste posts instead
          </a>
        </div>
      </div>
    </div>
  );
}
