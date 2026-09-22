-- Persona OS Database Schema (x OpenMuse integration)
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)
--
-- Keeps the existing tables (personas, assets, content_drafts) and adds the
-- Goals & Tracking tables used by the agent (/api/goals, /api/goals/check):
-- recurring public-page checks with deduplicated alerts and failure backoff.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Personas table
create table if not exists public.personas (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  backstory text not null default '',
  visual_style text default '',
  tone_of_voice text default '',
  lifestyle_pillars text[] default '{}',
  content_rules text[] default '{}',
  forbidden_topics text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Assets table (backed by the public Storage bucket 'assets')
create table if not exists public.assets (
  id uuid primary key default uuid_generate_v4(),
  persona_id uuid references public.personas(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check (type in ('image', 'video', 'text', 'metric')),
  url text,
  content text,
  tags text[] default '{}',
  created_at timestamptz default now()
);

-- Content drafts table
create table if not exists public.content_drafts (
  id uuid primary key default uuid_generate_v4(),
  persona_id uuid references public.personas(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check (type in ('caption', 'script', 'story_arc', 'image_prompt')),
  content text not null,
  consistency_score numeric,
  flags text[] default '{}',
  created_at timestamptz default now()
);

-- ============================================================
-- Goals & Tracking (OpenMuse adaptation) — recurring checks
-- ============================================================
create table if not exists public.goals (
  id uuid primary key default uuid_generate_v4(),
  persona_id uuid references public.personas(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  recurrence text not null default 'weekly' check (recurrence in ('daily', 'weekly')),
  check_url text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  last_state_hash text,
  last_state_sample text,
  last_checked timestamptz,
  next_check_at timestamptz,
  failure_count int not null default 0,
  created_at timestamptz default now()
);

-- One alert per (goal, detected change). dedupe_key makes re-alerting on the
-- same page state impossible.
create table if not exists public.goal_alerts (
  id uuid primary key default uuid_generate_v4(),
  goal_id uuid references public.goals(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  body text not null default '',
  dedupe_key text not null unique,
  draft_id uuid references public.content_drafts(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists goals_user_idx on public.goals(user_id);
create index if not exists goals_persona_idx on public.goals(persona_id);
create index if not exists goal_alerts_goal_idx on public.goal_alerts(goal_id);

-- Row Level Security
alter table public.personas enable row level security;
alter table public.assets enable row level security;
alter table public.content_drafts enable row level security;
alter table public.goals enable row level security;
alter table public.goal_alerts enable row level security;

-- Policies: users can only see/edit their own data
create policy "Users can view own personas"
  on public.personas for select
  using (auth.uid() = user_id);

create policy "Users can insert own personas"
  on public.personas for insert
  with check (auth.uid() = user_id);

create policy "Users can update own personas"
  on public.personas for update
  using (auth.uid() = user_id);

create policy "Users can delete own personas"
  on public.personas for delete
  using (auth.uid() = user_id);

create policy "Users can view own assets"
  on public.assets for select
  using (auth.uid() = user_id);

create policy "Users can insert own assets"
  on public.assets for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own assets"
  on public.assets for delete
  using (auth.uid() = user_id);

create policy "Users can view own drafts"
  on public.content_drafts for select
  using (auth.uid() = user_id);

create policy "Users can insert own drafts"
  on public.content_drafts for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own drafts"
  on public.content_drafts for delete
  using (auth.uid() = user_id);

create policy "Users can view own goals"
  on public.goals for select
  using (auth.uid() = user_id);

create policy "Users can insert own goals"
  on public.goals for insert
  with check (auth.uid() = user_id);

create policy "Users can update own goals"
  on public.goals for update
  using (auth.uid() = user_id);

create policy "Users can delete own goals"
  on public.goals for delete
  using (auth.uid() = user_id);

create policy "Users can view own goal alerts"
  on public.goal_alerts for select
  using (auth.uid() = user_id);

create policy "Users can insert own goal alerts"
  on public.goal_alerts for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own goal alerts"
  on public.goal_alerts for delete
  using (auth.uid() = user_id);

-- Updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_personas_updated on public.personas;
create trigger on_personas_updated
  before update on public.personas
  for each row execute procedure public.handle_updated_at();

-- Storage reminder (run once in the Supabase dashboard):
--   create a PUBLIC bucket named 'assets'
--   (Storage > New bucket > name: assets > Public bucket)
