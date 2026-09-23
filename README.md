# Persona OS

Consistency operating system for creators and founders.

Build a coherent digital identity, generate content that never breaks character, and ship it fast.

## Core loop

1. **Paste your best posts** → auto-build persona (voice, tone, rules, pillars)
2. **Generate** captions, scripts, series, or topic ideas
3. **Transform** any result (shorter / longer / → script / → caption / → image prompt)
4. **Copy + open** X or LinkedIn
5. **Mark Posted** → future generation avoids those topics

## Features

- **Build from posts** — reverse-engineer your real voice
- **Templates** — Founder, Fitness, Luxury, Tech Operator
- **Strengthen persona** — AI sharpens rules and tone
- **Generate** — multi-model (OpenRouter), multi-variation
- **Series planner** — 3/5/7-day content plans
- **Topic ideas** — on-brand idea lists
- **Consistency checker** — score + rewrite suggestions
- **Posted-aware generation** — avoids already-posted content
- **Asset vault** — photos/videos per persona
- **Drafts** — search, filter, improve, bulk delete, export
- **Copy + X / LinkedIn** — one tap to ship

## Tech

- Next.js 15 + TypeScript + Tailwind
- Supabase (Auth + Postgres + Storage)
- OpenRouter (AI)

## Setup

1. Clone the repo
2. Copy `.env.local.example` → `.env.local`
3. Add Supabase URL + anon key + `OPENROUTER_API_KEY`
4. Run `supabase/schema.sql` in Supabase SQL Editor
5. Create a **public** Storage bucket named `assets`
6. Install & run:

```bash
npm install
npm run dev
```

## Key routes

| Path | Purpose |
|------|---------|
| `/dashboard` | Home (first-run → paste posts) |
| `/dashboard/personas/from-posts` | Auto-build persona |
| `/dashboard/personas/new` | Templates + manual create |
| `/dashboard/personas/[id]` | Command center |
| `/dashboard/generate` | AI content + transforms |
| `/dashboard/series` | Multi-day plans |
| `/dashboard/ideas` | Topic lists |
| `/dashboard/check` | Consistency |
| `/dashboard/drafts` | History + posted flag |
| `/dashboard/vault` | Assets |

---

Built for results. Iterating daily.
