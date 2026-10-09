-- ===========================================================================
-- FoodFlow: Supabase `users` table (system of record for USER ACCOUNTS)
-- Run this ONCE in your Supabase dashboard: SQL Editor > New query > paste > Run.
-- Project: https://xkssgwkmvxikvxujciwb.supabase.co
-- Menu / orders / wallets stay in MongoDB; only accounts live here.
-- Access is via the server-side service_role key ONLY. Row Level Security is
-- enabled with NO public policies, so anon/authenticated app keys can read
-- nothing — the backend (service_role bypasses RLS) is the only reader/writer.
-- ===========================================================================

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  email text not null unique,
  password_hash text not null,
  phone text,
  student_id text,
  role text not null default 'student' check (role in ('student', 'admin')),
  is_blocked boolean not null default false,
  blocked_reason text,
  last_login_at timestamptz,
  avatar_color text not null default '#6366f1',
  notification_email boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_role_idx on public.users (role);
create index if not exists users_student_id_idx on public.users (student_id);
create index if not exists users_created_at_idx on public.users (created_at desc);

-- Keep updated_at fresh on every write (the backend also sets it explicitly).
create or replace function public.handle_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.handle_users_updated_at();

alter table public.users enable row level security;
-- Intentionally NO policies: service_role (backend) bypasses RLS;
-- anon/authenticated keys get nothing.
