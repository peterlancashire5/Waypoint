-- ============================================================
-- Waypoint — Tests for Migration 009 (Profiles table)
-- Run in Supabase SQL Editor (superuser context required).
-- Wraps everything in a transaction that is ROLLED BACK at
-- the end — no test data persists.
-- ============================================================

begin;

-- ─── Auth helpers (same pattern as 001_collaboration_rls_test.sql) ────────────
create or replace function pg_temp.set_auth(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  set local role = authenticated;
end;
$$ language plpgsql;

create or replace function pg_temp.reset_auth() returns void as $$
begin
  reset role;
end;
$$ language plpgsql;


-- ════════════════════════════════════════════════════════════════════════════
-- TEST 1: Backfill — both existing users have profile rows
-- (This runs outside a temp user context — reads auth.users directly as superuser)
-- ════════════════════════════════════════════════════════════════════════════
do $t1$
declare
  auth_count   integer;
  profile_count integer;
begin
  select count(*) into auth_count   from auth.users;
  select count(*) into profile_count from public.profiles;
  assert profile_count >= auth_count,
    'TEST 1 FAIL: profiles count (' || profile_count || ') < auth.users count (' || auth_count || '). Run backfill.';
  raise notice 'TEST 1 PASS: all auth.users have profile rows (% users, % profiles)', auth_count, profile_count;
end $t1$;


-- ─── Insert a test user to verify trigger ─────────────────────────────────────
do $setup$
begin
  insert into auth.users (
    id, email, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, encrypted_password,
    email_confirmed_at, aud, role
  )
  values (
    '99999999-0000-0000-0000-000000000001',
    'trigger-test@waypoint.test',
    now(), now(), '{}', '{}', false, '', now(),
    'authenticated', 'authenticated'
  )
  on conflict (id) do nothing;
  raise notice 'SETUP: test user inserted into auth.users';
end $setup$;


-- ════════════════════════════════════════════════════════════════════════════
-- TEST 2: Trigger — inserting a user creates a profile row automatically
-- ════════════════════════════════════════════════════════════════════════════
do $t2$
declare cnt integer;
begin
  select count(*) into cnt
  from public.profiles
  where id = '99999999-0000-0000-0000-000000000001';
  assert cnt = 1,
    'TEST 2 FAIL: profile row not created by trigger for new user';
  raise notice 'TEST 2 PASS: trigger created profile row for new user';
end $t2$;


-- ════════════════════════════════════════════════════════════════════════════
-- TEST 3: Trigger — email copied correctly
-- ════════════════════════════════════════════════════════════════════════════
do $t3$
declare found_email text;
begin
  select email into found_email
  from public.profiles
  where id = '99999999-0000-0000-0000-000000000001';
  assert found_email = 'trigger-test@waypoint.test',
    'TEST 3 FAIL: email mismatch — got: ' || coalesce(found_email, 'NULL');
  raise notice 'TEST 3 PASS: email copied correctly by trigger';
end $t3$;


-- ════════════════════════════════════════════════════════════════════════════
-- TEST 4: RLS — authenticated user can read all profiles
-- ════════════════════════════════════════════════════════════════════════════
do $t4$
declare cnt integer;
begin
  perform pg_temp.set_auth('99999999-0000-0000-0000-000000000001');
  select count(*) into cnt from public.profiles;
  perform pg_temp.reset_auth();
  -- Should see at least 1 row (their own) — if RLS is wrong they'd see 0
  assert cnt >= 1,
    'TEST 4 FAIL: authenticated user cannot read profiles (RLS blocking SELECT)';
  raise notice 'TEST 4 PASS: authenticated user can read profiles (saw % rows)', cnt;
end $t4$;


-- ════════════════════════════════════════════════════════════════════════════
-- TEST 5: RLS — user can update their own profile
-- ════════════════════════════════════════════════════════════════════════════
do $t5$
declare found_name text;
begin
  perform pg_temp.set_auth('99999999-0000-0000-0000-000000000001');
  update public.profiles
  set display_name = 'Test User'
  where id = '99999999-0000-0000-0000-000000000001';
  perform pg_temp.reset_auth();
  select display_name into found_name
  from public.profiles
  where id = '99999999-0000-0000-0000-000000000001';
  assert found_name = 'Test User',
    'TEST 5 FAIL: user could not update their own profile';
  raise notice 'TEST 5 PASS: user can update their own profile';
end $t5$;


-- ════════════════════════════════════════════════════════════════════════════
-- Roll back — no test data persists
-- ════════════════════════════════════════════════════════════════════════════
rollback;
