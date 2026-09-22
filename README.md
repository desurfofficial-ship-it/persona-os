# Persona OS

AI-powered creative infrastructure for creators and founders.

Build, maintain, and generate high-quality content for coherent digital identities / personas.

## Core Features (MVP)

- **Persona Profile**: Create a character with backstory, visual style, tone, lifestyle pillars, and content rules.
- **Consistency Engine**: Flags contradictions across posts and scripts (coming next).
- **Content Generation**: AI captions, scripts, story arcs, and image prompts that stay in-character (coming next).
- **Asset Vault**: Private library of photos, videos, and generated content tied to the persona.

## Tech Stack

- Next.js 15 + TypeScript
- Tailwind CSS
- Supabase (auth, database, storage)
- AI: OpenAI / Anthropic (next)

## Setup

1. Clone the repo
2. Copy `.env.local.example` → `.env.local`
3. The Supabase credentials are already filled for our project.
4. Run the SQL schema:
   - Go to [Supabase SQL Editor](https://supabase.com/dashboard/project/zcbvcaglsrnzrxuozzll/sql)
   - Paste the contents of `supabase/schema.sql` and run it.
5. (Recommended) In Supabase Auth settings, temporarily disable "Confirm email" for faster testing.
6. Install & run:

```bash
npm install
npm run dev
```

Open http://localhost:3000

- `/login` → create account or sign in
- `/dashboard` → main app
- `/dashboard/personas/new` → create your first persona

## Project Status

Private alpha. Software-first. Physical immersive sessions are Phase 2.

---

Built by the Persona OS team.
