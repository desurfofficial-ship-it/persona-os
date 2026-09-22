"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, authedFetch } from "@/lib/supabase";

/**
 * Trust page — plain language about where data lives, plus the two buttons
 * that prove it: export everything as JSON, and delete the whole account.
 */

export default function TrustPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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
    };
    load();
  }, [router]);

  const handleExport = async () => {
    setExporting(true);
    setMessage(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const [personasRes, draftsRes, assetsRes] = await Promise.all([
        supabase.from("personas").select("*").eq("user_id", user.id),
        supabase.from("content_drafts").select("*").eq("user_id", user.id),
        supabase.from("assets").select("*").eq("user_id", user.id),
      ]);

      const bundle = {
        exported_at: new Date().toISOString(),
        account: { email: userEmail },
        personas: personasRes.data || [],
        drafts: draftsRes.data || [],
        assets: assetsRes.data || [],
      };

      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `persona-os-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Export downloaded — personas, drafts, and asset links included.");
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== "DELETE") return;
    setDeleting(true);

    try {
      const res = await authedFetch("/api/delete-account", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Deletion failed");
      }
      await supabase.auth.signOut();
      router.push("/");
    } catch (err: any) {
      setMessage(err.message);
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-bold">Trust &amp; Data</h1>
        </div>

        {/* Plain-language data handling */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
          <h2 className="font-medium mb-4">Where your stuff lives</h2>
          <ul className="space-y-3 text-sm text-zinc-300">
            <li className="flex gap-3">
              <span className="text-zinc-500 shrink-0 w-20">Personas</span>
              <span>
                Your persona definitions (voice, rules, pillars) are stored in your account&apos;s
                database row. They never leave the app except when you generate content.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-500 shrink-0 w-20">Drafts</span>
              <span>
                Everything you generate is saved to your drafts — yours alone, private by default.
                Marking something &quot;Posted&quot; is just a flag on your own draft.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-500 shrink-0 w-20">Vault</span>
              <span>
                Uploaded photos and videos are stored as private files attached to your account,
                served only to you.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-500 shrink-0 w-20">AI calls</span>
              <span>
                When you generate, your persona rules and the request go to the AI provider to
                write content. We don&apos;t send your vault images or your email to the provider.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-500 shrink-0 w-20">We never</span>
              <span>
                sell your data, train public models on your posts, or auto-post anything anywhere.
                There is no engagement farming here — that&apos;s the point.
              </span>
            </li>
          </ul>
        </div>

        {/* Export */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
          <h2 className="font-medium mb-2">Export everything</h2>
          <p className="text-sm text-zinc-400 mb-4">
            One JSON file: every persona, every draft (posted or not), and your asset links.
            Yours to keep or move anywhere.
          </p>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="min-h-[48px] px-6 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"
          >
            {exporting ? "Building your export..." : "Download my data"}
          </button>
        </div>

        {/* Delete */}
        <div className="bg-zinc-900 border border-red-900/60 rounded-xl p-6">
          <h2 className="font-medium mb-2 text-red-300">Delete account</h2>
          <p className="text-sm text-zinc-400 mb-4">
            Removes your account, personas, drafts, and uploaded files permanently. No trash bin,
            no &quot;90 days&quot; — gone means gone. Type <span className="text-zinc-200 font-mono">DELETE</span> to confirm.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="flex-1 px-4 py-3 min-h-[48px] bg-zinc-950 border border-red-900/60 rounded-lg text-sm font-mono"
              aria-label="Type DELETE to confirm"
            />
            <button
              onClick={handleDeleteAccount}
              disabled={deleting || confirmText !== "DELETE"}
              className="min-h-[48px] px-6 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-500 disabled:opacity-40 whitespace-nowrap"
            >
              {deleting ? "Deleting..." : "Delete everything"}
            </button>
          </div>
        </div>

        {message && (
          <p className="mt-6 text-sm text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-lg p-4">
            {message}
          </p>
        )}

        {userEmail && (
          <p className="mt-8 text-xs text-zinc-600">Signed in as {userEmail}</p>
        )}
      </div>
    </div>
  );
}
