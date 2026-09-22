export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">
          Persona OS
        </h1>
        <p className="text-xl text-zinc-400">
          AI-powered creative infrastructure for coherent digital identities.
        </p>
        <p className="text-zinc-500">
          Build, maintain, and generate high-quality content that stays in character.
        </p>
        <div className="pt-8">
          <span className="inline-block px-4 py-2 rounded-full bg-zinc-800 text-sm text-zinc-300">
            Private Alpha — Coming Soon
          </span>
        </div>
      </div>
    </main>
  );
}
