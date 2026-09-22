# Persona OS

AI-powered creative infrastructure for creators and founders — now with an **autonomous agent OS** layer (Persona OS × OpenMuse integration).

Build coherent digital identities and generate high-quality content that never breaks character. Then let the agent research, generate, schedule and file everything for you.

## Features

- **Persona Profiles** — Backstory, tone, lifestyle pillars, content rules, forbidden topics
- **AI Content Engine** — Captions, scripts, story arcs, image prompts (via OpenRouter)
- **Asset Vault** — Upload and organize photos/videos per persona
- **Content Drafts** — History of everything you've generated
- **Model Selector** — GPT-4o Mini, Claude Haiku, Gemini Flash, Llama 3.1
- **Consistency Engine** — Flags contradictions across posts/scripts
- **Voice Gold Set + Voice DNA** — Curated samples anchor the voice
- **Basic Analytics & Scheduling** — Performance logging, week calendar, due-today queue

## Agent OS (× OpenMuse)

`/dashboard/generate` is the agent workspace: persona + content type + model on the left, the agent conversation in the center, live preview + **Goals & Tracking** on the right.

Say: *"Research 5 viral wellness hooks on TikTok this week, generate 7 days of captions for MIRA that never mention hustle culture, schedule them, and save assets to vault."*

- **Runtime** — `POST /api/copilotkit` (CopilotKit runtime). With `OPENROUTER_API_KEY` it runs `OpenAIAdapter` pointed at `https://openrouter.ai/api/v1`; without a key it falls back to a built-in preview model with a planner loop (real web research + tool calls) so the agent is testable end-to-end at zero cost.
- **Persona injection** — the active persona id rides the `x-persona-id` header; the route loads the persona server-side (Supabase when configured) and injects it as system instructions ahead of every model call. Forbidden topics are enforced at the system-prompt layer.
- **Client actions** (`hooks/usePersonaAgent.ts`) — `saveToDrafts` → `/api/drafts`, `saveToVault` → `/api/vault/upload` (bucket `assets`), `createGoal` → `/api/goals`, `scheduleContent` → `/api/drafts` (calendar).
- **Goals & Tracking** — recurring public-page checks (`goals` + `goal_alerts` tables). `POST /api/goals/check` (worker token or session) reads each due `check_url` through the OpenMuse browser worker (`lib/browserWorker.ts`, direct-fetch fallback), records a baseline, raises **deduplicated alerts** per detected change (`dedupe_key` unique), backs off exponentially on failures (15m × 2ⁿ, 24h cap, auto-pause at 5), and auto-generates one in-character caption per change through the hardened generation engine.
- **Studio** — the classic ranked-variants engine lives at `/dashboard/studio`.

### Browser worker (optional)

Compatible with the OpenMuse stack:

```bash
# in the OpenMuse repo
pnpm dev:browser
# or the full computer stack
docker build -t openmuse-computer:local apps/computer
```

Set `BROWSER_WORKER_URL` + `WORKER_TOKEN` (see `.env.example`). Goal checks degrade to direct fetches when the worker is absent.

## Tech Stack

- Next.js (App Router) + TypeScript + Tailwind
- Supabase (Auth + Database + Storage) — or the built-in preview backend (SQLite via Prisma) when Supabase env vars are absent
- OpenRouter (all AI), CopilotKit runtime (agent), OpenMuse browser worker (research)

## Setup

1. Clone the repo
2. Copy `.env.example` → `.env.local` and fill in what you use (Supabase keys + `OPENROUTER_API_KEY` for the full stack; nothing for the zero-key preview)
3. Run the SQL in `supabase/schema.sql` inside Supabase SQL Editor (creates `personas`, `assets`, `content_drafts`, `goals`, `goal_alerts` + RLS)
4. Create a public Storage bucket named `assets`
5. Install & run:

```bash
npm install
npm run dev
```

### Task worker

Point any cron/queue at `POST /api/goals/check` with header `x-worker-token: $WORKER_TOKEN` (set `TASK_WORKER_ENABLED=true`). The endpoint is idempotent and self-scheduling per goal via `next_check_at`.

## Project Structure

- `/dashboard` — Main app
- `/dashboard/personas/new` — Create persona
- `/dashboard/personas/[id]` — View / edit persona
- `/dashboard/generate` — Agent workspace (CopilotChat + Goals & Tracking)
- `/dashboard/studio` — Classic generation engine
- `/dashboard/vault` — Asset management
- `/dashboard/drafts` — Generated content history

### Agent API routes

- `POST /api/copilotkit` — CopilotKit runtime (OpenRouter / preview fallback)
- `GET|POST|DELETE /api/goals`, `POST /api/goals/check` — Goals & Tracking
- `POST|PATCH|GET /api/drafts` — agent drafts + scheduling
- `POST /api/vault/upload` — agent vault saves (bucket `assets`)
- `GET /api/personas` — persona list for the agent UI

---

Built fast. Iterating daily.
