# Collaboration Phase 2 — Trip Settings Screen & Shared Trip Indicators

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the trip settings screen (manage name, collaborators, leave/delete) and add shared-trip visual indicators to trip detail and trips list screens.

**Architecture:** New `profiles` table (populated via trigger) makes collaborator emails queryable from the client. A new `app/trip-settings.tsx` screen is accessed via the existing three-dot overflow menu and (for shared trips) an avatar stack added to the trip detail header. The trips list is extended to show both owned and member trips with a "Shared" badge.

**Tech Stack:** React Native / Expo SDK 55, TypeScript (strict), Expo Router 4, Supabase (Postgres + RLS), Feather icons via `@expo/vector-icons`, plain StyleSheet.

**Spec:** `docs/superpowers/specs/2026-03-17-collaboration-phase2-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/009_profiles.sql` | Create | Profiles table, trigger, backfill |
| `supabase/tests/002_profiles_test.sql` | Create | SQL tests for profiles trigger + RLS |
| `app/trip-settings.tsx` | Create | Trip settings screen (name, collaborators, leave/delete) |
| `app/_layout.tsx` | Modify | Register `trip-settings` stack screen |
| `app/trip-detail.tsx` | Modify | Add "Trip Settings" to overflow menu; add avatar stack |
| `app/(main)/trips.tsx` | Modify | Extend query for member trips + shared indicator |

---

## Important Notes for Implementer

**FK join limitation:** `trips.owner_id` and `trip_members.user_id` both reference `auth.users(id)`, not `public.profiles(id)`. PostgREST FK alias syntax (`owner:owner_id(...)`) will NOT work for joining trips/trip_members to profiles. Always fetch profiles in a separate query using `.in('id', arrayOfUserIds)`.

**Async useFocusEffect pattern:** Never pass an `async` function directly to `useFocusEffect`. Always wrap it:
```ts
useFocusEffect(
  useCallback(() => {
    const fetch = async () => { /* ... */ };
    fetch();
  }, [])
);
```

**Session:** Always use `supabase.auth.getSession()`, never `supabase.auth.getUser()`.

**Install rule:** Use `expo install` for Expo packages. For anything else: `npm install --legacy-peer-deps`.

**Design tokens:** All colors from `constants/colors.ts`. All font names from `constants/typography.ts`. Use `fonts.displayBold` for headings, `fonts.body`/`fonts.bodyBold` for UI text.

---

## Task 1: Profiles table migration

**Files:**
- Create: `supabase/migrations/009_profiles.sql`

- [ ] **Step 1.1: Write the migration**

Create `supabase/migrations/009_profiles.sql`:

```sql
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
```

- [ ] **Step 1.2: Apply the migration in Supabase SQL Editor**

Open Supabase → SQL Editor. Paste the full contents of `009_profiles.sql` and run it. You should see no errors.

- [ ] **Step 1.3: Verify backfill in Table Editor**

Open Supabase → Table Editor → `profiles`. You should see one row for each existing user in `auth.users`. If the table is empty, the backfill didn't run — re-run just the `insert into public.profiles...` block.

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/009_profiles.sql
git commit -m "feat: add profiles table with trigger and backfill"
```

---

## Task 2: SQL tests for profiles

**Files:**
- Create: `supabase/tests/002_profiles_test.sql`

Follow the exact same pattern as `supabase/tests/001_collaboration_rls_test.sql` — wrapped in `begin`/`rollback`, uses `pg_temp.set_auth()`, uses `assert`.

- [ ] **Step 2.1: Write the test file**

Create `supabase/tests/002_profiles_test.sql`:

```sql
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
```

- [ ] **Step 2.2: Run the tests in Supabase SQL Editor**

Paste the full contents of `002_profiles_test.sql` into the SQL Editor and run. Expected output (in the Messages tab):

```
SETUP: test user inserted into auth.users
TEST 1 PASS: all auth.users have profile rows (N users, N profiles)
TEST 2 PASS: trigger created profile row for new user
TEST 3 PASS: email copied correctly by trigger
TEST 4 PASS: authenticated user can read profiles (saw N rows)
TEST 5 PASS: user can update their own profile
```

If any test fails, do not continue. Fix the issue first.

- [ ] **Step 2.3: Commit**

```bash
git add supabase/tests/002_profiles_test.sql
git commit -m "test: add SQL tests for profiles table trigger and RLS"
```

---

## Task 3: Register route + settings entry point

**Files:**
- Modify: `app/_layout.tsx`
- Modify: `app/trip-detail.tsx` (just the overflow menu)
- Create: `app/trip-settings.tsx` (skeleton only — content in Tasks 4–6)

- [ ] **Step 3.1: Create the trip-settings screen skeleton**

Create `app/trip-settings.tsx`:

```tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';

export default function TripSettingsScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const fetch = async () => {
        setLoading(false); // placeholder — real fetch added in Task 4
      };
      fetch();
    }, [])
  );

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => router.back()} style={styles.retryButton}>
          <Text style={styles.retryText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.navRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.navTitle}>Trip Settings</Text>
          <View style={styles.navSpacer} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.placeholder}>Settings coming soon</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  navRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  navTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
  navSpacer: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  retryButton: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },
  placeholder: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
});
```

- [ ] **Step 3.2: Register `trip-settings` in `app/_layout.tsx`**

In `app/_layout.tsx`, add the new screen to the Stack. Find the existing `<Stack.Screen name="place-detail" .../>` line and add after it:

```tsx
<Stack.Screen name="trip-settings" options={{ headerShown: false }} />
```

The Stack block should now look like:
```tsx
<Stack screenOptions={{ headerShown: false }}>
  <Stack.Screen name="leg" options={{ presentation: 'modal', headerShown: false }} />
  <Stack.Screen name="create-trip" options={{ presentation: 'modal', headerShown: false }} />
  <Stack.Screen name="stop-detail" options={{ headerShown: false }} />
  <Stack.Screen name="trip-detail" options={{ headerShown: false }} />
  <Stack.Screen name="settings" options={{ headerShown: false }} />
  <Stack.Screen name="booking-detail" options={{ headerShown: false }} />
  <Stack.Screen name="place-detail" options={{ headerShown: false }} />
  <Stack.Screen name="trip-settings" options={{ headerShown: false }} />
</Stack>
```

- [ ] **Step 3.3: Add "Trip Settings" to the overflow menu in `app/trip-detail.tsx`**

Find the overflow menu modal (around line 1113). Currently it has one item: "Edit Stops". Add a second item for "Trip Settings":

```tsx
{/* ── Overflow menu modal ── */}
<Modal
  visible={menuVisible}
  transparent
  animationType="fade"
  onRequestClose={() => setMenuVisible(false)}
>
  <Pressable style={styles.menuOverlay} onPress={() => setMenuVisible(false)}>
    <View style={styles.menuPopup}>
      <Pressable
        style={styles.menuItem}
        onPress={() => {
          setMenuVisible(false);
          enterEditMode();
        }}
      >
        <Feather name="edit-2" size={15} color={colors.text} style={styles.menuIcon} />
        <Text style={styles.menuItemText}>Edit Stops</Text>
      </Pressable>
      <Pressable
        style={styles.menuItem}
        onPress={() => {
          setMenuVisible(false);
          router.push({ pathname: '/trip-settings', params: { tripId } });
        }}
      >
        <Feather name="settings" size={15} color={colors.text} style={styles.menuIcon} />
        <Text style={styles.menuItemText}>Trip Settings</Text>
      </Pressable>
    </View>
  </Pressable>
</Modal>
```

- [ ] **Step 3.4: Verify navigation works**

Run the app. Open any trip → tap the three-dot menu → "Trip Settings" should appear. Tapping it should open the skeleton screen with "Settings coming soon". Back navigation should work.

- [ ] **Step 3.5: Commit**

```bash
git add app/trip-settings.tsx app/_layout.tsx app/trip-detail.tsx
git commit -m "feat: add trip-settings route skeleton and overflow menu entry"
```

---

## Task 4: Trip settings — trip name section

**Files:**
- Modify: `app/trip-settings.tsx`

Replace the placeholder skeleton with real data fetching and the trip name editable field.

- [ ] **Step 4.1: Add types and state to trip-settings.tsx**

> **Note:** Do not use the `owner:owner_id(...)` PostgREST join syntax shown in the spec — it doesn't work here because `trips.owner_id` references `auth.users`, not `public.profiles`. See Important Notes above for the correct approach.

Replace the full file content with the following (this replaces the skeleton from Task 3):

```tsx
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
}

interface Collaborator extends Profile {
  isOwner: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripSettingsScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trip name
  const [tripName, setTripName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [nameSaving, setNameSaving] = useState(false);

  // Collaborators
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tripId) { setError('No trip specified.'); setLoading(false); return; }

    setLoading(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    setCurrentUserId(userId);

    // Fetch trip
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, name, owner_id')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      setError('Could not load trip settings.');
      setLoading(false);
      return;
    }

    setTripName(trip.name);
    setSavedName(trip.name);
    setOwnerId(trip.owner_id);

    // Fetch trip_members
    const { data: members } = await supabase
      .from('trip_members')
      .select('user_id')
      .eq('trip_id', tripId);

    // Collect all user IDs (owner + members) and fetch their profiles
    const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    const allUserIds = [trip.owner_id, ...memberIds];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', allUserIds);

    const profileMap = new Map<string, Profile>(
      (profiles ?? []).map((p: Profile) => [p.id, p])
    );

    const collabs: Collaborator[] = allUserIds.map((uid) => ({
      id: uid,
      email: profileMap.get(uid)?.email ?? uid, // fallback to id if profile missing
      display_name: profileMap.get(uid)?.display_name ?? null,
      isOwner: uid === trip.owner_id,
    }));

    setCollaborators(collabs);
    setLoading(false);
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  // ── Name save (on blur) ────────────────────────────────────────────────────

  async function handleNameBlur() {
    const trimmed = tripName.trim();
    if (!trimmed || trimmed === savedName) return;
    setNameSaving(true);
    const { error: updateError } = await supabase
      .from('trips')
      .update({ name: trimmed })
      .eq('id', tripId);
    if (updateError) {
      setTripName(savedName); // revert on failure
      Alert.alert('Error', 'Could not save trip name. Please try again.');
    } else {
      setSavedName(trimmed);
    }
    setNameSaving(false);
  }

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => router.back()} style={styles.retryButton}>
          <Text style={styles.retryText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isOwner = currentUserId === ownerId;
  const memberCount = collaborators.length;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.navRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.navTitle}>Trip Settings</Text>
          <View style={styles.navSpacer} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Trip name section ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TRIP NAME</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.nameInput}
              value={tripName}
              onChangeText={setTripName}
              onBlur={handleNameBlur}
              placeholder="Trip name"
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
              blurOnSubmit
            />
            {nameSaving && (
              <ActivityIndicator size="small" color={colors.primary} style={styles.nameSaving} />
            )}
          </View>
        </View>

        {/* Collaborators section — added in Task 5 */}
        {/* Leave/Delete section — added in Task 6 */}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  navRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  navTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
  navSpacer: { flex: 1 },

  scrollContent: { padding: 20, paddingBottom: 60 },

  section: {
    backgroundColor: colors.white, borderRadius: 16,
    padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 10,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  nameInput: {
    flex: 1,
    fontFamily: fonts.body, fontSize: 16, color: colors.text,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  nameSaving: { marginLeft: 8 },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  retryButton: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },
});
```

- [ ] **Step 4.2: Verify name editing**

Run the app. Open Trip Settings. The trip name should appear in the text field. Edit it and tap elsewhere — the name should save. Reopen the trip settings to confirm the new name persists.

- [ ] **Step 4.3: Commit**

```bash
git add app/trip-settings.tsx
git commit -m "feat: trip settings screen with editable trip name"
```

---

## Task 5: Trip settings — collaborators section

**Files:**
- Modify: `app/trip-settings.tsx`

Add the collaborators list below the trip name section. Includes: initials avatar, email, "Creator" badge, remove button (creator only), and disabled Invite button.

- [ ] **Step 5.1: Add CollaboratorRow component and Invite button inside trip-settings.tsx**

Add this component function above `TripSettingsScreen` (after `getInitials`):

```tsx
// ─── CollaboratorRow ─────────────────────────────────────────────────────────

interface CollaboratorRowProps {
  collab: Collaborator;
  isCurrentUserOwner: boolean;
  currentUserId: string | null;
  onRemove: (collab: Collaborator) => void;
}

function CollaboratorRow({ collab, isCurrentUserOwner, currentUserId, onRemove }: CollaboratorRowProps) {
  const showRemove = isCurrentUserOwner && !collab.isOwner;

  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.avatar}>
        <Text style={rowStyles.avatarText}>{getInitials(collab.email)}</Text>
      </View>
      <View style={rowStyles.info}>
        <Text style={rowStyles.email} numberOfLines={1}>{collab.email}</Text>
        {collab.isOwner && (
          <View style={rowStyles.badge}>
            <Text style={rowStyles.badgeText}>Creator</Text>
          </View>
        )}
      </View>
      {showRemove && (
        <Pressable
          style={rowStyles.removeButton}
          onPress={() => onRemove(collab)}
          hitSlop={8}
        >
          <Feather name="trash-2" size={16} color={colors.error} />
        </Pressable>
      )}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12, flexShrink: 0,
  },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#FFFFFF' },
  info: { flex: 1, gap: 3 },
  email: { fontFamily: fonts.body, fontSize: 14, color: colors.text },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EBF3F6', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: {
    fontFamily: fonts.bodyBold, fontSize: 10,
    color: colors.primary, letterSpacing: 0.5, textTransform: 'uppercase',
  },
  removeButton: { padding: 4 },
});
```

- [ ] **Step 5.2: Add handleRemoveCollaborator function inside TripSettingsScreen**

Add this function inside `TripSettingsScreen`, after `handleNameBlur`:

```tsx
// ── Remove collaborator ─────────────────────────────────────────────────────

function handleRemoveCollaborator(collab: Collaborator) {
  Alert.alert(
    'Remove collaborator',
    `Remove ${collab.email}? They'll lose access to this trip.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error: removeError } = await supabase
            .from('trip_members')
            .delete()
            .eq('trip_id', tripId)
            .eq('user_id', collab.id);
          if (removeError) {
            Alert.alert('Error', 'Could not remove collaborator. Please try again.');
            return;
          }
          // Refresh collaborator list
          setCollaborators((prev) => prev.filter((c) => c.id !== collab.id));
        },
      },
    ]
  );
}
```

- [ ] **Step 5.3: Add the collaborators section to the JSX**

In the `ScrollView` content, replace the `{/* Collaborators section — added in Task 5 */}` comment with:

```tsx
{/* ── Collaborators section ── */}
<View style={styles.section}>
  <Text style={styles.sectionLabel}>
    COLLABORATORS ({memberCount})
  </Text>
  {collaborators.map((collab) => (
    <CollaboratorRow
      key={collab.id}
      collab={collab}
      isCurrentUserOwner={isOwner}
      currentUserId={currentUserId}
      onRemove={handleRemoveCollaborator}
    />
  ))}
  {/* TODO: Phase 3 — wire up invite link generation */}
  <Pressable
    style={[styles.inviteButton, styles.inviteButtonDisabled]}
    disabled
  >
    <Feather name="user-plus" size={16} color={colors.textMuted} />
    <Text style={styles.inviteButtonTextDisabled}>Invite someone</Text>
  </Pressable>
</View>
```

- [ ] **Step 5.4: Add inviteButton styles to the styles object**

Append to the existing `StyleSheet.create({...})` at the bottom of the file:

```ts
  inviteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 12,
    paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: colors.primary,
  },
  inviteButtonDisabled: { borderColor: colors.border },
  inviteButtonTextDisabled: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.textMuted },
```

- [ ] **Step 5.5: Verify collaborators list**

Run the app. Open Trip Settings. The Collaborators section should show:
- "COLLABORATORS (1)" header (just you as creator for solo trips)
- Your email with a "Creator" badge
- A disabled "Invite someone" button

To test with a second collaborator: go to Supabase → Table Editor → `trip_members` → Insert a row linking your second test user to a trip. Reopen trip settings — the collaborator should appear. As creator, you should see a trash icon next to the non-owner row.

- [ ] **Step 5.6: Commit**

```bash
git add app/trip-settings.tsx
git commit -m "feat: trip settings collaborators section with remove button"
```

---

## Task 6: Trip settings — leave and delete trip

**Files:**
- Modify: `app/trip-settings.tsx`

- [ ] **Step 6.1: Add handleLeaveTrip and handleDeleteTrip functions inside TripSettingsScreen**

Add after `handleRemoveCollaborator`:

```tsx
// ── Leave trip (non-owner only) ────────────────────────────────────────────

function handleLeaveTrip() {
  Alert.alert(
    'Leave this trip?',
    "You'll lose access to this trip and its itinerary.",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          if (!currentUserId) return;
          const { error: leaveError } = await supabase
            .from('trip_members')
            .delete()
            .eq('trip_id', tripId)
            .eq('user_id', currentUserId);
          if (leaveError) {
            Alert.alert('Error', 'Could not leave trip. Please try again.');
            return;
          }
          router.replace('/(main)/trips');
        },
      },
    ]
  );
}

// ── Delete trip (owner only) ───────────────────────────────────────────────

function handleDeleteTrip() {
  Alert.alert(
    'Delete this trip?',
    'This will permanently delete the trip for all collaborators.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error: deleteError } = await supabase
            .from('trips')
            .delete()
            .eq('id', tripId);
          if (deleteError) {
            Alert.alert('Error', 'Could not delete trip. Please try again.');
            return;
          }
          router.replace('/(main)/trips');
        },
      },
    ]
  );
}
```

- [ ] **Step 6.2: Add the leave/delete section to the JSX**

Replace the `{/* Leave/Delete section — added in Task 6 */}` comment with:

```tsx
{/* ── Danger zone ── */}
<View style={styles.dangerSection}>
  {isOwner ? (
    <Pressable style={styles.dangerButton} onPress={handleDeleteTrip}>
      <Feather name="trash-2" size={16} color={colors.error} />
      <Text style={styles.dangerButtonText}>Delete trip</Text>
    </Pressable>
  ) : (
    <Pressable style={styles.dangerButton} onPress={handleLeaveTrip}>
      <Feather name="log-out" size={16} color={colors.error} />
      <Text style={styles.dangerButtonText}>Leave trip</Text>
    </Pressable>
  )}
</View>
```

- [ ] **Step 6.3: Add dangerSection styles**

Append to the `StyleSheet.create({...})`:

```ts
  dangerSection: { marginTop: 8 },
  dangerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: colors.error,
  },
  dangerButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.error },
```

- [ ] **Step 6.4: Verify delete flow**

Run the app. Open a trip → Trip Settings. As the creator, scroll to the bottom — "Delete trip" should appear in red. Tap it — alert should appear with correct text. Confirm — should navigate to trips list and trip should be gone.

- [ ] **Step 6.5: Commit**

```bash
git add app/trip-settings.tsx
git commit -m "feat: trip settings leave and delete trip flows"
```

---

## Task 7: Trip detail — avatar stack for shared trips

**Files:**
- Modify: `app/trip-detail.tsx`

Show a small overlapping avatar stack below the trip name when the trip has collaborators. Tapping it navigates to trip settings.

- [ ] **Step 7.1: Add CollaboratorProfile type and collaborators state to TripDetailScreen**

At the top of `trip-detail.tsx`, add to the existing type definitions:

```tsx
interface CollaboratorProfile {
  id: string;
  email: string;
}
```

Inside `TripDetailScreen`, add new state after the existing state declarations (around line 368):

```tsx
// Collaborators (for avatar stack on shared trips)
const [collaboratorProfiles, setCollaboratorProfiles] = useState<CollaboratorProfile[]>([]);
```

- [ ] **Step 7.2: Fetch collaborators at the end of fetchTrip**

In `fetchTrip`, just before `setLoading(false)` at the very end (after `setItinerary(...)`), add:

```tsx
// Fetch collaborators for avatar stack (non-blocking)
const { data: memberRows } = await supabase
  .from('trip_members')
  .select('user_id')
  .eq('trip_id', tripId!);

if (memberRows && memberRows.length > 0) {
  const memberIds = memberRows.map((m: { user_id: string }) => m.user_id);
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, email')
    .in('id', memberIds);
  setCollaboratorProfiles((profileRows ?? []) as CollaboratorProfile[]);
} else {
  setCollaboratorProfiles([]);
}
```

- [ ] **Step 7.3: Add AvatarStack component**

Add this component near the top of the file, after the existing type definitions and before `TripDetailScreen`:

```tsx
// ─── AvatarStack ─────────────────────────────────────────────────────────────

function getInitials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

interface AvatarStackProps {
  profiles: CollaboratorProfile[];
  onPress: () => void;
}

function AvatarStack({ profiles, onPress }: AvatarStackProps) {
  if (profiles.length === 0) return null;

  const visible = profiles.slice(0, 3);
  const overflow = profiles.length - visible.length;

  return (
    <Pressable style={avatarStackStyles.row} onPress={onPress} hitSlop={8}>
      {visible.map((p, i) => (
        <View
          key={p.id}
          style={[
            avatarStackStyles.avatar,
            i > 0 && avatarStackStyles.avatarOverlap,
          ]}
        >
          <Text style={avatarStackStyles.initials}>{getInitials(p.email)}</Text>
        </View>
      ))}
      {overflow > 0 && (
        <View style={[avatarStackStyles.avatar, avatarStackStyles.avatarOverlap, avatarStackStyles.overflowAvatar]}>
          <Text style={avatarStackStyles.overflowText}>+{overflow}</Text>
        </View>
      )}
      <Feather name="chevron-right" size={14} color={colors.textMuted} style={avatarStackStyles.chevron} />
    </Pressable>
  );
}

const avatarStackStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  avatar: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.primary,
    borderWidth: 2, borderColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarOverlap: { marginLeft: -8 },
  initials: { fontFamily: fonts.bodyBold, fontSize: 10, color: '#FFFFFF' },
  overflowAvatar: { backgroundColor: colors.textMuted },
  overflowText: { fontFamily: fonts.bodyBold, fontSize: 10, color: '#FFFFFF' },
  chevron: { marginLeft: 4 },
});
```

- [ ] **Step 7.4: Render AvatarStack in the trip meta area**

In the JSX, find the `tripMeta` section (around line 1004):

```tsx
<View style={styles.tripMeta}>
  <View style={styles.typeBadge}>
    <Text style={styles.typeBadgeLabel}>
      {trip.type === 'multi' ? 'MULTI-STOP' : 'SINGLE'}
    </Text>
  </View>
  <Text style={styles.tripName}>{trip.name}</Text>
  {meta ? <Text style={styles.tripDetails}>{meta}</Text> : null}
</View>
```

Add the `AvatarStack` after `tripDetails`:

```tsx
<View style={styles.tripMeta}>
  <View style={styles.typeBadge}>
    <Text style={styles.typeBadgeLabel}>
      {trip.type === 'multi' ? 'MULTI-STOP' : 'SINGLE'}
    </Text>
  </View>
  <Text style={styles.tripName}>{trip.name}</Text>
  {meta ? <Text style={styles.tripDetails}>{meta}</Text> : null}
  <AvatarStack
    profiles={collaboratorProfiles}
    onPress={() => router.push({ pathname: '/trip-settings', params: { tripId } })}
  />
</View>
```

- [ ] **Step 7.5: Verify avatar stack**

Run the app. For a solo trip: no avatar stack appears. For a shared trip (manually insert a `trip_members` row via Supabase Table Editor): small overlapping avatar circles appear below the trip name. Tapping them navigates to trip settings.

- [ ] **Step 7.6: Commit**

```bash
git add app/trip-detail.tsx
git commit -m "feat: avatar stack on trip detail header for shared trips"
```

---

## Task 8: Trips list — member trips + shared indicator

**Files:**
- Modify: `app/(main)/trips.tsx`

Show trips where the user is a collaborator (not just owner). Add a "Shared" badge to cards with collaborators.

- [ ] **Step 8.1: Extend DbTrip and TripSummary types**

In `app/(main)/trips.tsx`, update the type definitions:

```tsx
interface DbTrip {
  id: string;
  name: string;
  type: 'single' | 'multi';
  start_date: string | null;
  end_date: string | null;
  status: 'upcoming' | 'active' | 'past';
  created_at: string;
  stops: { city: string }[];
  trip_members: { user_id: string }[]; // ← new
}

interface TripSummary {
  id: string;
  name: string;
  status: 'Upcoming' | 'Past';
  dateRange: string;
  stopCount: number;
  chips: string[];
  memberCount: number; // ← new
}
```

Update `toTripSummary`:

```tsx
function toTripSummary(t: DbTrip): TripSummary {
  return {
    id: t.id,
    name: t.name,
    status: t.status === 'past' ? 'Past' : 'Upcoming',
    dateRange: formatDateRange(t.start_date, t.end_date),
    stopCount: t.stops.length,
    chips: t.stops.map((s) => s.city).filter(Boolean),
    memberCount: t.trip_members.length, // ← new
  };
}
```

- [ ] **Step 8.2: Update fetchTrips to include owned + member trips**

Replace the existing `fetchTrips` function body with:

```tsx
const fetchTrips = async () => {
  setLoading(true);
  setError(null);

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) { setLoading(false); return; }

  // Query 1: trips owned by this user
  const { data: ownedData, error: ownedError } = await supabase
    .from('trips')
    .select('*, stops(city), trip_members(user_id)')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (ownedError) {
    setError('Could not load trips.');
    setLoading(false);
    return;
  }

  // Query 2: trips where user is a collaborator (non-owner member)
  const { data: memberRows } = await supabase
    .from('trip_members')
    .select('trip_id')
    .eq('user_id', user.id);

  const memberTripIds = (memberRows ?? []).map((r: { trip_id: string }) => r.trip_id);

  let sharedData: DbTrip[] = [];
  if (memberTripIds.length > 0) {
    const { data } = await supabase
      .from('trips')
      .select('*, stops(city), trip_members(user_id)')
      .in('id', memberTripIds)
      .order('created_at', { ascending: false });
    sharedData = (data ?? []) as DbTrip[];
  }

  // Merge: owned first, then shared trips not already in owned set
  const ownedIds = new Set((ownedData ?? []).map((t: DbTrip) => t.id));
  const allTrips = [
    ...(ownedData ?? []) as DbTrip[],
    ...sharedData.filter((t) => !ownedIds.has(t.id)),
  ];

  setTrips(allTrips.map(toTripSummary));
  setLoading(false);
};
```

Note: the `fetchTrips` function is defined inside `useFocusEffect`. Make sure to update the inner function — do not add a new one outside.

- [ ] **Step 8.3: Update TripCard to show shared indicator**

In `TripCard`, update the `cardMeta` row to include the shared indicator:

```tsx
function TripCard({ trip, onPress }: { trip: TripSummary; onPress?: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardTopLeft}>
          <StatusPill status={trip.status} />
          <Text style={styles.cardTitle}>{trip.name}</Text>
        </View>
        <Feather name="arrow-right" size={18} color={colors.border} />
      </View>

      <View style={styles.cardMeta}>
        <Feather name="calendar" size={13} color={colors.textMuted} />
        <Text style={styles.cardDateRange}>{trip.dateRange || '—'}</Text>
        <Text style={styles.cardDot}>·</Text>
        <Feather name="map-pin" size={13} color={colors.textMuted} />
        <Text style={styles.cardStops}>
          {trip.stopCount} {trip.stopCount === 1 ? 'stop' : 'stops'}
        </Text>
        {trip.memberCount > 0 && (
          <>
            <Text style={styles.cardDot}>·</Text>
            <Feather name="users" size={13} color={colors.textMuted} />
            <Text style={styles.cardShared}>Shared</Text>
          </>
        )}
      </View>

      {trip.chips.length > 0 && (
        <View style={styles.chips}>
          {trip.chips.map((c) => (
            <View key={c} style={styles.chip}>
              <Text style={styles.chipText}>{c}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}
```

- [ ] **Step 8.4: Add cardShared style**

Append to the `StyleSheet.create({...})` in trips.tsx:

```ts
  cardShared: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
```

- [ ] **Step 8.5: Fix fetchTrips scope issue**

In the error state JSX, `trips.tsx` has a `<Pressable onPress={fetchTrips}>` but `fetchTrips` is now defined inside the `useFocusEffect` callback and not accessible at the component scope. Move the function definition to the component scope (outside `useFocusEffect`) so both the error retry button and `useFocusEffect` can call it.

The corrected structure (use the full fetch body from Step 8.2 above):

```tsx
export default function TripsScreen() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrips = useCallback(async () => {
    // ... full fetch logic from Step 8.2 ...
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTrips();
    }, [fetchTrips])
  );

  // ... rest of component
}
```

Import `useCallback` at the top of the file if not already imported.

- [ ] **Step 8.6: Verify shared trips list**

Run the app. Go to the trips tab.
- Trips you own should still appear as before
- Trips where you're a collaborator (add via Supabase Table Editor) should also appear
- Shared trips should show the "Shared" indicator in the meta row

- [ ] **Step 8.7: Commit**

```bash
git add app/(main)/trips.tsx
git commit -m "feat: trips list shows member trips and shared indicator"
```

---

## Manual Testing Checklist

Run through these after all tasks are complete:

1. **Settings entry:** Open any trip → tap three-dot menu → "Trip Settings" visible
2. **Navigation:** Tap "Trip Settings" → screen opens with back button
3. **Trip name edit:** Tap the name field, edit it, tap elsewhere → name saves. Reopen to confirm persistence
4. **Creator badge:** Collaborators section shows your email with "Creator" badge
5. **Invite button:** "Invite someone" button appears but is disabled (greyed out)
6. **Delete trip:** Tap "Delete trip" → alert appears → confirm → navigates to trips list → trip gone
7. **Avatar stack (shared):** Via Supabase Table Editor, insert a `trip_members` row linking the second test user to a trip. Reload the trip detail → avatar stack appears below the trip name
8. **Avatar stack tap:** Tap the avatar stack → navigates to trip settings
9. **Collaborator in settings:** Trip settings shows 2 collaborators; creator sees trash icon on non-owner row
10. **Remove collaborator:** Tap trash icon → confirm alert → collaborator removed → list refreshes to 1
11. **Shared badge:** Trips list shows "Shared" on the card for the shared trip
12. **Leave trip:** (Requires signing in as second test user — note for later testing)

---

## Out of Scope

- Invite link generation and deep linking (Phase 3)
- Accepting invites via link (Phase 3)
- Profile photos, display name editing
- Push notifications for new collaborators
