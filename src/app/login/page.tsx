"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Local preview auth UI.
 * After success we hard-navigate to /dashboard so every client component
 * re-reads the token from localStorage (router.push alone can race with
 * useEffect auth guards and bounce you straight back to /login).
 */

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMessage("Enter an email address");
      setLoading(false);
      return;
    }
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters");
      setLoading(false);
      return;
    }

    try {
      if (isSignUp) {
        const { error, data } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        if (!data?.session) {
          throw new Error(
            "Account created but no session returned. Check LOCAL_SESSION_SECRET on the server, then sign in."
          );
        }
      } else {
        const { error, data } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        if (!data?.session) {
          throw new Error("Sign in succeeded but no session was stored. Try again.");
        }
      }
      // Full reload — avoids client-nav race with dashboard auth guards.
      window.location.assign("/dashboard");
      return;
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err && "message" in err
            ? String((err as { message: unknown }).message)
            : "Something went wrong";
      setMessage(msg);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Persona OS</h1>
          <p className="text-zinc-400 mt-2">
            {isSignUp ? "Create an account" : "Sign in to continue"}
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            autoComplete="email"
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            required
            minLength={8}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
          />

          {message && (
            <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setMessage(null);
          }}
          className="w-full text-sm text-zinc-400 hover:text-white"
        >
          {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>

        <p className="text-[11px] text-zinc-600 text-center leading-relaxed">
          Local preview stores your session in this browser. Password must be at least 8
          characters. No email confirmation required.
        </p>
      </div>
    </div>
  );
}
