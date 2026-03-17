# Collaboration Phase 2 — Trip Settings Screen & Shared Trip Indicators

**Date:** 2026-03-17
**Status:** Approved
**Phase:** 2 of 5 (Trip Collaboration)

---

## Context

Phase 1 (database foundation + RLS overhaul) is complete:
- `trip_members` and `trip_invites` tables exist
- `is_trip_member(trip_id)` RLS helper function deployed
- `join_trip_by_token` RPC function deployed
- All tables have collaboration-ready RLS policies

Phase 2 adds the trip settings screen and visual indicators for shared trips. No invite link generation yet — that is Phase 3.

---

## What We're Building

1. **Profiles table** — makes collaborator emails queryable from the client
2. **Trip settings screen** (`app/trip-settings.tsx`) — manage name, collaborators, leave/delete
3. **Trip detail: avatar stack** — shows collaborators on shared trips, taps to settings
4. **Trip detail: settings entry point** — "Trip Settings" added to existing overflow menu
5. **Trips list: shared indicator** — small people icon + "Shared" label on trip cards

---

## 1. Database: Profiles Table

### Table definition

```sql
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz default now()
);
```

### RLS

```sql
alter table public.profiles enable row level security;

-- Any authenticated user can read all profiles (needed to show collaborator emails)
create policy "profiles: authenticated users can read"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Users can only update their own profile
create policy "profiles: users can update own"
  on public.profiles for update
  using (id = auth.uid());
```

### Auto-populate trigger

A `SECURITY DEFINER` trigger fires on `auth.users` insert and copies `email` into `profiles`. This is the standard Supabase pattern for making user info accessible without exposing `auth.users` directly.

```sql
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
```

### Backfill

```sql
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
```

### Migration file

`supabase/migrations/009_profiles.sql`

---

## 2. Trip Settings Screen

### Route

- File: `app/trip-settings.tsx`
- Registered in `app/_layout.tsx` as a root stack screen (push, no modal), same pattern as `stop-detail`
- Params: `tripId` (string)
- Navigation from: overflow menu "Trip Settings" item; avatar stack on trip detail

### Data fetching

Single `useFocusEffect` fetch loading:
- `trips`: `id, name, owner_id`
- Owner profile: `profiles` joined via `owner_id`
- Collaborators: `trip_members` joined with `profiles` on `user_id`

Query pattern:
```ts
supabase
  .from('trips')
  .select('id, name, owner_id, profiles!owner_id(email, display_name)')
  .eq('id', tripId)
  .single()

supabase
  .from('trip_members')
  .select('user_id, profiles(email, display_name)')
  .eq('trip_id', tripId)
```

### Sections

#### Trip name
- Editable `TextInput` displaying current name
- Saves on blur via `supabase.from('trips').update({ name }).eq('id', tripId)`
- Available to all members (RLS Phase 1 already allows member updates)

#### Collaborators
- Section header: "Collaborators (N)" where N = 1 (owner) + trip_members count
- List rows: initials avatar circle + email + "Creator" badge on owner row
- Creator sees a trash/remove icon on each non-owner row
- Non-owner rows show no remove button for non-creators
- Below list: disabled "Invite" button (placeholder for Phase 3)
  - `// TODO: Phase 3 — wire up invite link generation`

#### Leave trip (non-owner only)
- Red ghost button at bottom of screen
- Confirmation: "Leave this trip? You'll lose access to this trip and its itinerary."
- On confirm: `supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId)`
- Then `router.replace('/(main)/')` (navigate to trips tab)

#### Delete trip (owner only)
- Red ghost button at bottom of screen
- Confirmation: "Delete this trip? This will permanently delete the trip for all collaborators."
- On confirm: `supabase.from('trips').delete().eq('id', tripId)`
- Cascade deletes all related rows (stops, legs, accommodation, etc.)
- Then `router.replace('/(main)/')` (navigate to trips tab)

#### Remove collaborator (creator only, per row)
- Confirmation: "Remove [email]? They'll lose access to this trip."
- On confirm: `supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId)`
- Refresh collaborator list

### Initials avatar helper

```ts
function getInitials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}
```

Uses first 2 chars of email since `display_name` is nullable and not populated at this stage.

---

## 3. Trip Detail: Settings Entry Point

The existing three-dot overflow menu in `trip-detail.tsx` already contains "Edit Stops". Add a second item: **"Trip Settings"** that navigates to `/trip-settings` with the current `tripId`.

No new icon is added to the header — the existing three-dot menu is the sole entry point for non-shared trips. Shared trips get a second entry point via the avatar stack (see Section 4).

---

## 4. Trip Detail: Avatar Stack (Shared Trips Only)

### Data

Extend `fetchTrip` in `trip-detail.tsx` to also fetch:
```ts
supabase
  .from('trip_members')
  .select('user_id, profiles(email)')
  .eq('trip_id', tripId)
```

If result is empty → trip is solo → show nothing extra.

### Rendering

Rendered in the `tripMeta` area below the trip name. Small overlapping circles (diameter 28px) showing up to 3 initials avatars, then `+N` text if more. The entire stack is a `Pressable` navigating to `/trip-settings?tripId=...`.

Visual style: teal background (`colors.primary`) with white initials text, `-8px` left margin for overlap, subtle border.

### Placement

```
[MULTI-STOP badge]
[Trip name]
[Date range]
[● ● ● +2]   ← avatar stack, only on shared trips
```

---

## 5. Trips List: Shared Indicator

### Query change

Extend the trips query in `(main)/trips.tsx`:
```ts
supabase
  .from('trips')
  .select('*, stops(city), trip_members(user_id)')
  .eq('owner_id', user.id)
  .order('created_at', { ascending: false })
```

PostgREST fetches nested `trip_members` rows in one query — no N+1.

### Rendering

In `TripCard`, if `trip.memberCount > 0`, add a small "Shared" indicator to the meta row:

```
📅 1 Apr – 14 Apr  ·  📍 3 stops  ·  👥 Shared
```

Uses `Feather name="users"` icon and "Shared" text in `textMuted` style, matching the existing date/stops row aesthetic. Solo trips show nothing extra.

---

## Error Handling

- All Supabase calls follow the existing pattern: `const { data, error } = await ...`
- On error: set error state, show a toast or inline error message
- Leave/delete navigate away on success; stay on error with an alert
- Name save failure: revert `TextInput` to original value, show toast

---

## Testing

### SQL tests (to write and run before completing)

1. Trigger works: insert a test user into `auth.users` → verify `profiles` row created
2. Backfill: both existing users have profile rows
3. RLS: authenticated user can `select` from `profiles`; unauthenticated cannot

### Manual device tests

1. Open a trip → three-dot menu → "Trip Settings" appears
2. Trip Settings screen opens with correct trip name
3. Edit trip name → tap elsewhere → name saves
4. Collaborators section shows owner with "Creator" badge
5. Invite button is visible but disabled
6. **Manually insert** a `trip_members` row via Supabase Table Editor (link second test user to a trip)
7. Re-open trip → avatar stack appears in header below trip name
8. Tap avatar stack → navigates to trip settings
9. Trip settings shows 2 collaborators; creator sees remove icon on non-owner row
10. Tap remove → confirm alert → collaborator removed → list refreshes
11. Trips list shows "Shared" indicator on the shared trip card
12. Delete trip → confirm → navigates to trips list → trip gone

---

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/009_profiles.sql` | New — profiles table, trigger, backfill |
| `app/trip-settings.tsx` | New — trip settings screen |
| `app/_layout.tsx` | Add `trip-settings` stack screen registration |
| `app/trip-detail.tsx` | Add "Trip Settings" to overflow menu; add avatar stack |
| `app/(main)/trips.tsx` | Extend query for member count; add shared indicator |

---

## Out of Scope (Phase 3+)

- Invite link generation and deep linking
- Accepting invites via link
- Push notifications for new collaborators
- Profile photos
- Display name editing
