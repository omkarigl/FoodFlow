create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  student_id text,
  role text not null default 'student' check (role in ('student', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.menu_categories(id) on delete restrict,
  name text not null,
  description text,
  price_paise integer not null check (price_paise > 0),
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  guest_name text,
  guest_phone text,
  note text,
  status text not null default 'pending' check (status in ('pending','confirmed','preparing','ready','completed','cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending','verified','failed')),
  total_paise integer not null check (total_paise >= 0),
  tracking_token text not null unique,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price_paise integer not null check (unit_price_paise > 0),
  line_total_paise integer not null check (line_total_paise >= unit_price_paise)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null check (provider in ('razorpay')),
  provider_order_id text not null unique,
  provider_payment_id text,
  status text not null default 'pending' check (status in ('pending','verified','failed')),
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'student')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.payments enable row level security;

drop policy if exists "public menu categories readable" on public.menu_categories;
create policy "public menu categories readable" on public.menu_categories
for select using (true);

drop policy if exists "public menu items readable" on public.menu_items;
create policy "public menu items readable" on public.menu_items
for select using (true);

drop policy if exists "self profile readable" on public.profiles;
create policy "self profile readable" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "self profile updatable" on public.profiles;
create policy "self profile updatable" on public.profiles
for update using (auth.uid() = id);

drop policy if exists "self orders readable" on public.orders;
create policy "self orders readable" on public.orders
for select using (auth.uid() = user_id);

drop policy if exists "self orders insert" on public.orders;
create policy "self orders insert" on public.orders
for insert with check (auth.uid() = user_id);
