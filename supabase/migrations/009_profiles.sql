-- ============================================================
-- Waypoint — Migration 009: Profiles table
-- Makes user email queryable from the client without exposing
-- auth.users directly. Standard Supabase pattern.
-- ============================================================

-- ─── 1. Create profiles table ─────────────────────────────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz default now()
);

-- ─── 2. RLS ───────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

-- Any authenticated user can read all profiles (needed to show collaborator emails)
create policy "profiles: authenticated users can read"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Users can only update their own row
create policy "profiles: users can update own"
  on public.profiles for update
  using (id = auth.uid());

-- ─── 3. Auto-populate trigger ─────────────────────────────────────────────────
-- SECURITY DEFINER: runs as superuser so it can insert even with RLS enabled.
-- This is the ONLY insert path into profiles — no client-side insert ever happens.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 4. Backfill existing users ───────────────────────────────────────────────
-- Populates profile rows for users created before this migration.
-- on conflict (id) do nothing is safe to re-run.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
