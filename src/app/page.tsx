import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 sm:px-8 py-6 border-b border-zinc-900">
        <div className="text-xl font-bold tracking-tight">Persona OS</div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition">
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

      <section className="flex-1 flex flex-col items-center justify-center px-6 py-20 sm:py-24 text-center">
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight max-w-3xl leading-tight">
          Stay in character.
          <br />
          <span className="text-zinc-400">Every single post.</span>
        </h1>
        <p className="mt-6 text-base sm:text-lg text-zinc-400 max-w-xl">
          Paste your best posts. We build your persona. Generate captions, scripts, and series
          that never break character — then copy straight to X or LinkedIn.
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

      <section className="px-6 py-16 sm:py-20 border-t border-zinc-900">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <h3 className="font-semibold mb-2">Build from posts</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Paste 3–10 real posts. We extract your voice, tone, rules, and pillars.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <h3 className="font-semibold mb-2">Generate & transform</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Captions, scripts, series, ideas — then turn any result into another format.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <h3 className="font-semibold mb-2">Stay consistent</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Consistency checker + posted-aware generation so you don’t repeat yourself.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <h3 className="font-semibold mb-2">Ship fast</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              One-tap copy to X or LinkedIn. Mark posted. Keep the loop tight.
            </p>
          </div>
        </div>
      </section>

      <footer className="py-8 text-center text-sm text-zinc-600 border-t border-zinc-900">
        Persona OS — Consistency operating system for creators & founders
      </footer>
    </main>
  );
}
