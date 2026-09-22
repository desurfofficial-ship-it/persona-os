# Persona OS

AI-powered creative infrastructure for creators and founders.

Build coherent digital identities and generate high-quality content that never breaks character.

## Features

- **Persona Profiles** — Backstory, tone, lifestyle pillars, content rules, forbidden topics
- **AI Content Engine** — Captions, scripts, story arcs, image prompts (via OpenRouter)
- **Asset Vault** — Upload and organize photos/videos per persona
- **Content Drafts** — History of everything you’ve generated
- **Model Selector** — GPT-4o Mini, Claude Haiku, Gemini Flash, Llama 3.1

## Tech Stack

- Next.js 15 + TypeScript + Tailwind
- Supabase (Auth + Database + Storage)
- OpenRouter (AI)

## Setup

1. Clone the repo
2. Copy `.env.local.example` → `.env.local`
3. Fill in your Supabase keys + `OPENROUTER_API_KEY`
4. Run the SQL in `supabase/schema.sql` inside Supabase SQL Editor
5. Create a public Storage bucket named `assets`
6. Install & run:

```bash
npm install
npm run dev
```

## Project Structure

- `/dashboard` — Main app
- `/dashboard/personas/new` — Create persona
- `/dashboard/personas/[id]` — View / edit persona
- `/dashboard/generate` — AI content generation
- `/dashboard/vault` — Asset management
- `/dashboard/drafts` — Generated content history

---

Built fast. Iterating daily.
