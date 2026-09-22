import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Nav */}
      <header className="flex items-center justify-between px-8 py-6 border-b border-zinc-900">
        <div className="text-xl font-bold tracking-tight">Persona OS</div>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm text-zinc-400 hover:text-white transition"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="text-sm px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight max-w-3xl leading-tight">
          Stay in character.
          <br />
          <span className="text-zinc-400">Every single post.</span>
        </h1>
        <p className="mt-6 text-lg text-zinc-400 max-w-xl">
          Paste 3–10 of your best posts. Persona OS learns your actual voice — rhythm, casing,
          vocabulary — then writes captions, scripts and threads that sound like you wrote them
          on your best day. Formatted for every platform. Clichés scrubbed before you see them.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Link
            href="/login"
            className="px-8 py-3.5 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition"
          >
            Start Building Free
          </Link>
          <Link
            href="/dashboard"
            className="px-8 py-3.5 border border-zinc-700 rounded-lg font-medium hover:bg-zinc-900 transition"
          >
            Go to Dashboard
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 border-t border-zinc-900">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-2">Voice DNA Engine</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Your real posts become a measured fingerprint: sentence rhythm, emoji policy,
              signature words. Every draft is scored against it — “Voice match 94%” — before
              you ever see it.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-2">3 structures, 4 platforms</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Every generation gives you ranked variants — story, bold take, framework — built
              natively for X, LinkedIn, Instagram or Threads. Over the limit? It becomes a
              ready-to-paste thread.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-2">Quality gate</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              “Here's your caption” wrappers, game-changers, and assistant leaks never reach
              your screen. The consistency checker quotes exact lines and hands you fixes.
            </p>
          </div>
        </div>
      </section>

      <footer className="py-8 text-center text-sm text-zinc-600 border-t border-zinc-900">
        <div>
          Persona OS — Creative infrastructure for coherent identities
        </div>
        <div className="mt-2">
          <a href="/pricing" className="hover:text-zinc-300 underline underline-offset-2">
            Pricing (fair use, in plain words)
          </a>
        </div>
      </footer>
    </main>
  );
}
