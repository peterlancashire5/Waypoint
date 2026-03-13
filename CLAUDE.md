# Waypoint — CLAUDE.md

Project context for Claude Code. Read this before starting any task.

---

## What is Waypoint

A travel companion app built with React Native / Expo. Users plan and organise trips: stops (cities), legs (transport between stops), accommodation, tickets, saved places, and day-by-day itineraries. The aesthetic is warm editorial — a premium travel magazine in app form.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.83.2 / Expo SDK 55 |
| Language | TypeScript (strict mode) |
| Routing | Expo Router 4 (file-based) |
| Backend | Supabase (Postgres + Auth + RLS) |
| Styling | Plain `StyleSheet` — no NativeWind, no Tamagui |
| Fonts | Playfair Display (display/headings), Lato (body) |

**Install rule:** use `expo install` for Expo-managed packages. For anything else use `npm install --legacy-peer-deps` (peer dep conflict with react-dom 19).

---

## Design System

```
Background:   #F8F7F5   (warm off-white)
Surface:      #FFFFFF
Primary:      #2C5F6E   (deep teal)
PrimaryDark:  #1E4A57
PrimaryLight: #3A7A8C
Accent:       #C07A4F   (terracotta)
AccentLight:  #D4956E
Text:         #1A1A1A
TextMuted:    #9C9088
Border:       #E8E4DE
Error:        #C0392B
Success:      #2E7D5A
```

All tokens live in `constants/colors.ts`. Font names live in `constants/typography.ts`.

Fonts loaded via `@expo-google-fonts/playfair-display` and `@expo-google-fonts/lato`. Use `fonts.displayBold` for headings, `fonts.body` / `fonts.bodyBold` for UI text.

---

## File Map

```
app/
  _layout.tsx              Root stack: font loading, auth listener, routing guard
  create-trip.tsx          Modal — create a new trip (stack, slides up)
  leg.tsx                  Modal — leg detail / booking (stack, slides up)
  settings.tsx             Account screen — email display + sign out
  stop-detail.tsx          Stop detail screen (real screen, stack push)
  stop.tsx                 Inert placeholder — DO NOT use. Real screen is stop-detail.tsx
  trip-detail.tsx          Trip detail — itinerary spine (stack push)
  (auth)/
    _layout.tsx            Auth stack layout (fade animation)
    index.tsx              Splash screen
    onboarding.tsx         3-slide onboarding (shown once, gated by SecureStore key)
    login.tsx              Combined sign-in / sign-up screen
  (main)/
    _layout.tsx            Tab navigator (Map, Trips, Inbox)
    index.tsx              Home map screen (MapView + trip overlay)
    trips.tsx              Trips list screen
    inbox.tsx              Inbox / saved items screen
    stop.tsx               Inert placeholder tab (href: null) — never navigate here

constants/
  colors.ts                All design tokens
  typography.ts            Font family names + textStyle presets

hooks/
  useAuth.ts               signInWithEmail, signUpWithEmail, signInWithApple,
                           signInWithGoogle, signOut

lib/
  supabase.ts              Supabase client — SecureStore session adapter
                           Project URL: bvrgvzxerdefiklgtclw.supabase.co

components/
  auth/SocialButton.tsx    Apple / Google sign-in buttons
  ui/Button.tsx            Primary / secondary / ghost / dark variants + loading state
  ui/Divider.tsx           Labelled horizontal divider

supabase/migrations/
  001_initial_schema.sql   Full schema — apply via Supabase SQL Editor
```

---

## Routing Architecture

Expo Router 4 with a root Stack. Key points:

- **Route groups are transparent** — `app/(main)/foo.tsx` has URL `/foo`, not `/(main)/foo`. Never use the group name in `pathname`.
- **Stack screens for detail/modal views** — registered explicitly in `app/_layout.tsx`. Currently: `leg` (modal), `create-trip` (modal), `stop-detail`, `trip-detail`, `settings`.
- **Tab screens** must NOT be used for screens that need route params. Tab push doesn't pass params reliably. Detail screens must live at the root stack level.
- **`app/(main)/stop.tsx`** is an inert placeholder (`<View />`). It exists because Expo Router auto-detects all files as routes but must never be navigated to. The real stop screen is `app/stop-detail.tsx`.
- **Navigation from home to stop:** `router.push({ pathname: '/stop-detail', params: { stopId } })`
- **Navigation from home to leg:** `router.push({ pathname: '/leg', params: { legId } })`
- **Navigation from trips to trip detail:** `router.push({ pathname: '/trip-detail', params: { tripId } })`

### Auth routing guard (`app/_layout.tsx`)

```ts
const segment = segments[0]; // string primitive, NOT segments array
useEffect(() => {
  if (!session && segment !== '(auth)') router.replace('/(auth)/');
  if (session && segment === '(auth)')  router.replace('/(main)/');
}, [fontsLoaded, fontError, session, segment]);
```

**Critical:** use `segments[0]` (string) not `segments` (array) as the dependency. `useSegments()` returns a new array reference on every render — using the array directly causes an infinite loop.

---

## Supabase Patterns

### Session (always use `getSession`, not `getUser`)

```ts
const { data: { session } } = await supabase.auth.getSession();
const user = session?.user;
```

`getUser()` makes a network round-trip and in React Native may not guarantee the JWT is attached to subsequent client calls. `getSession()` reads from the SecureStore cache.

### `useFocusEffect` async pattern

```ts
useFocusEffect(
  useCallback(() => {
    const fetch = async () => { /* ... */ };
    fetch();
  }, [])
);
```

Never pass an `async` function directly to `useFocusEffect` — it returns a Promise, which React Navigation interprets as a cleanup function and warns.

### FK alias joins

```ts
supabase
  .from('legs')
  .select('*, from_stop:from_stop_id(city, country), to_stop:to_stop_id(city, country), leg_bookings(*)')
```

PostgREST syntax: `alias:foreign_key_column(columns)`.

### Error handling pattern

```ts
const { data, error } = await supabase.from('trips').select('*').eq('id', id).single();
if (error || !data) { setError('Could not load.'); return; }
```

Use `.maybeSingle()` when zero results is a valid state; `.single()` when the row must exist.

---

## Database Schema (summary)

Full SQL in `supabase/migrations/001_initial_schema.sql`. Apply via Supabase SQL Editor.

| Table | Key columns |
|---|---|
| `trips` | id, name, type (single/multi), start_date, end_date, status (upcoming/active/past), owner_id |
| `stops` | id, trip_id, city, country, latitude, longitude, start_date, end_date, nights, order_index |
| `legs` | id, trip_id, from_stop_id, to_stop_id, transport_type, departure_time, arrival_time, order_index |
| `leg_bookings` | id, leg_id, owner_id, operator, reference, seat, confirmation_ref |
| `accommodation` | id, stop_id, owner_id, name, address, check_in, check_out, confirmation_ref, wifi_name, wifi_password, door_code |
| `days` | id, stop_id, date |
| `events` | id, day_id, stop_id, title, time, is_floating, category, notes |
| `saved_items` | id, stop_id, trip_id, creator_id, name, category, photo_url, note, is_inbox |
| `trip_members` | id, trip_id, user_id |
| `trip_invites` | id, trip_id, invited_by, invited_user_id, status |

**RLS:** all tables have RLS enabled. Helper function `is_trip_member(trip_id)` used in policies.

**Privacy model:** `accommodation` and `leg_bookings` are owner-only (not visible to other trip members).

**Geocoding:** stops have `latitude`/`longitude` populated at create time via the free Open-Meteo API: `https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=en&format=json`. Never block trip creation on a failed geocode.

---

## Auth Flow

```
App start
  → _layout.tsx waits for fonts + session
  → session === null  →  /(auth)/index  (splash)
     → first launch   →  /(auth)/onboarding  (3 slides, SecureStore gated)
     → returning      →  /(auth)/login
  → session exists   →  /(main)/   (tab navigator)
```

Sign-out: call `supabase.auth.signOut()`. The `onAuthStateChange` listener detects `session → null` and the routing guard redirects to `/(auth)/` automatically. No manual navigation needed.

Auto sign-in after sign-up works only when **email confirmation is disabled** in the Supabase dashboard (Authentication → Settings). With confirmation enabled, the user must confirm their email before a session is created.

---

## Key Component Notes

### `Button` (`components/ui/Button.tsx`)
Supports `loading` prop (shows ActivityIndicator) and `disabled` prop. Variants: `primary`, `secondary`, `ghost`, `dark`.

### `useAuth` (`hooks/useAuth.ts`)
All methods throw on error — callers must `try/catch`. Apple sign-in error code `1001` = user cancelled, should be swallowed silently.

### Map screen (`app/(main)/index.tsx`)
- Uses `react-native-maps` with `PROVIDER_DEFAULT`
- Fetches most recent upcoming/active trip on focus
- Polyline taps navigate to `/leg` with `firstLegId`
- City chips and map pins select a stop; tapping a selected stop deselects
- "View trip details" navigates to `/stop-detail` with the first stop's ID
- Settings icon (top-right) navigates to `/settings`

### `create-trip.tsx`
- Single or multi-stop flow
- Geocodes each city on blur via Open-Meteo; stores lat/lng in stop insert
- Uses `AbortController` per field to cancel stale geocode requests
- Inserts trip then stops in sequence; never blocks on geocode failure

---

## What's Built

- [x] Auth flow (sign in, sign up, onboarding, sign out)
- [x] Home map screen with real trip data
- [x] Create trip flow (single + multi-stop, with geocoding)
- [x] Trips list screen
- [x] Trip detail screen (itinerary spine: stops + legs interleaved)
- [x] Stop detail screen (header with real data; tab content placeholder)
- [x] Leg modal (real transport + booking data; empty state)
- [x] Inbox screen (mock items; filing bottom sheet)
- [x] Settings screen (email + sign out)
- [x] Full Supabase schema + RLS policies

## What's Not Built Yet

- [ ] Stop detail tab content (Logistics: accommodation; Days: events timeline; Saved: saved places)
- [ ] Add transport / create leg flow
- [ ] Accommodation entry
- [ ] Events / day planner
- [ ] Trip sharing / invite members
- [ ] Saved items (real data)
- [ ] Forgot password flow
- [ ] Push notifications
