-- Jalankan SQL ini di Supabase SQL Editor.
-- Table utama untuk safelink YouTube locker.

create extension if not exists pgcrypto;

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text default 'Complete the steps below to unlock your link.',
  video_url text not null,
  channel_url text not null,
  destination_url text not null,
  theme text default 'violet',
  required_subscribe boolean default true,
  required_like boolean default true,
  required_comment boolean default true,
  timer_seconds integer default 10,
  clicks integer default 0,
  unlocks integer default 0,
  active boolean default true,
  last_click_at timestamptz,
  last_unlock_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists links_slug_idx on public.links (slug);
create index if not exists links_created_at_idx on public.links (created_at desc);

-- Opsional: update otomatis kolom updated_at.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_links_updated_at on public.links;
create trigger set_links_updated_at
before update on public.links
for each row
execute function public.set_updated_at();

-- App ini pakai SERVICE_ROLE_KEY dari backend, jadi jangan taruh key itu di frontend.
-- RLS boleh aktif atau nonaktif; service role tetap bisa akses.
alter table public.links enable row level security;
