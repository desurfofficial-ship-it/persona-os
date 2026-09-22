-- Persona OS Database Schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)

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

-- Assets table
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

-- Row Level Security
alter table public.personas enable row level security;
alter table public.assets enable row level security;
alter table public.content_drafts enable row level security;

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

-- Updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_personas_updated
  before update on public.personas
  for each row execute procedure public.handle_updated_at();
