"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const { error, data } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        // Preview backend confirms signups instantly — go straight in.
        if (data?.session) {
          router.push("/dashboard");
          return;
        }
        setMessage("Check your email for the confirmation link (or disable email confirm in Supabase for faster testing).");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push("/dashboard");
      }
    } catch (err: any) {
      setMessage(err.message);
    } finally {
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
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            minLength={6}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
          />

          {message && (
            <p className="text-sm text-zinc-300 bg-zinc-900 p-3 rounded-lg">{message}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 transition disabled:opacity-50"
          >
            {loading ? "Loading..." : isSignUp ? "Sign Up" : "Sign In"}
          </button>
        </form>

        <p className="text-center text-sm text-zinc-500">
          {isSignUp ? "Already have an account?" : "Need an account?"}{" "}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-white underline"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}
