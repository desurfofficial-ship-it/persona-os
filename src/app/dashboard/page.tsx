export default function DashboardPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-12">
          <h1 className="text-3xl font-bold">Persona OS</h1>
          <nav className="flex gap-6 text-sm text-zinc-400">
            <a href="/dashboard" className="text-white">Dashboard</a>
            <a href="/dashboard/personas" className="hover:text-white">Personas</a>
            <a href="/dashboard/vault" className="hover:text-white">Vault</a>
            <a href="/dashboard/generate" className="hover:text-white">Generate</a>
          </nav>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-2">Your Personas</h2>
            <p className="text-zinc-400 text-sm mb-4">Create and manage digital identities</p>
            <a
              href="/dashboard/personas/new"
              className="inline-block px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200"
            >
              + New Persona
            </a>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-2">Asset Vault</h2>
            <p className="text-zinc-400 text-sm mb-4">Photos, videos, and generated content</p>
            <span className="text-zinc-500 text-sm">Coming soon</span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-2">Generate</h2>
            <p className="text-zinc-400 text-sm mb-4">AI captions, scripts & image prompts</p>
            <span className="text-zinc-500 text-sm">Coming soon</span>
          </div>
        </div>
      </div>
    </div>
  );
}
