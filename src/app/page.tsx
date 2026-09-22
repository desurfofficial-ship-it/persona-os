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
          Persona OS helps creators and founders build coherent digital identities
          and generate high-quality content that never breaks character.
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
            <h3 className="text-lg font-semibold mb-2">Persona Profiles</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Define backstory, tone, lifestyle pillars, content rules and forbidden topics.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-2">AI Content Engine</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Generate captions, scripts, story arcs and image prompts that stay 100% in character.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-2">Asset Vault</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Store photos and videos tied to each persona so everything stays organized.
            </p>
          </div>
        </div>
      </section>

      <footer className="py-8 text-center text-sm text-zinc-600 border-t border-zinc-900">
        Persona OS — Creative infrastructure for coherent identities
      </footer>
    </main>
  );
}
