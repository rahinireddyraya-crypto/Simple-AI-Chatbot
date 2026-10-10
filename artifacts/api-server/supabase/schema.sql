-- Run this once in the Supabase SQL Editor for this project.
create table if not exists public.chat_sessions (
  session_id uuid primary key,
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  updated_at timestamptz not null default now()
);

-- The app accesses this table only from its API server using SERVICE_ROLE_KEY.
-- Keep browser/anonymous access disabled.
alter table public.chat_sessions enable row level security;
