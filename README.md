# Persona OS

Consistency operating system for creators and founders.

Build a coherent digital identity, generate content that stays in character, ship it, and learn from what worked.

## Core loop

1. **Paste posts / template / connect handle** → persona (voice, tone, rules, gold examples)
2. **Generate** via Studio or Agent (captions, scripts, series, ideas)
3. **Copy + open** X / LinkedIn / Threads
4. **Mark Posted** + **Worked / Flopped** → future generation avoids repeats and doubles down on winners

## Stack (current)

| Layer | Local preview | Production path |
|-------|---------------|-----------------|
| App | Next.js 16 + TypeScript + Tailwind | same |
| Data | Prisma + SQLite (`db/custom.db`) | Supabase Postgres + RLS |
| Auth | Local signed tokens (`LOCAL_SESSION_SECRET`) | Supabase Auth |
| AI | OpenRouter (required) | same |
| Agent | CopilotKit runtime (optional) | same |

Pages talk to a **Supabase-js shaped shim** (`src/lib/supabase.ts`) that hits `/api/local-*`. Swap that file for the real `createClient` when you deploy on Supabase — most UI code stays the same.

## Setup (local)

1. Clone the repo
2. `cp .env.local.example .env.local`
3. Set `OPENROUTER_API_KEY` and a strong `LOCAL_SESSION_SECRET`
4. `npm install` (or `bun install`)
5. `npx prisma db push`
6. `npm run dev`

Do **not** commit `.env.local` or anything under `db/`.

## Key routes

| Path | Purpose |
|------|---------|
| `/dashboard` | Home |
| `/dashboard/personas/from-posts` | Build persona from posts |
| `/dashboard/personas/new` | Templates + manual create |
| `/dashboard/generate` | Agent workspace |
| `/dashboard/studio` | Classic ranked variants + voice DNA |
| `/dashboard/series` | Multi-day plans |
| `/dashboard/ideas` | Topic lists |
| `/dashboard/check` | Consistency |
| `/dashboard/posts` | Ready queue, batch generate, Copy & open, scheduler export |
| `/dashboard/drafts` | Posted + performance + export |
| `/dashboard/vault` | Assets |
| `/dashboard/connect` | Optional social handle |

## Security notes

- Local auth is for **preview only**. Set `LOCAL_SESSION_SECRET` (≥16 random chars). Default secret is rejected outside development.
- AI routes require a Bearer session token and are rate-limited per user.
- Goal check URLs are guarded against SSRF (`src/lib/safeUrl.ts`).
- Rotate any keys that were ever committed to git history.

## Scripts

```bash
npm run dev          # development
npm run build        # production build
npx prisma db push   # sync SQLite schema
```

---

Built for results. Iterating daily.

## Scheduler export

From **Posts**, export the Ready (or Posted) queue as:

- **JSON** — `{ posts: [{ text, scheduled_at, platforms, persona }] }` for agents / Shoutrrr-style tools
- **CSV** — `scheduled_at,text,persona,type,id`
- **Week plan** — plain text copy

Persona OS stays the voice + anti-slop layer. External tools (or official X API later) handle publish.
