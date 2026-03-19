# Waypoint — CLAUDE.md

Project context for Claude Code. Read this before starting any task.

---

## Current Priorities & Known Issues

**Active bugs:**
- Journey detail screen only shows first leg (should show all legs)
- Ljubljana (stop 2 on Euro Summer trip) not appearing as map pin — geocoding issue
- DocumentPicker tap-to-select not working in iOS simulator (likely Expo DocumentPicker known issue)

**Features to build next:**
1. Booking status markers — confirmed, pending, not yet booked. Visual indicators on trip detail and stop detail screens.
2. iOS share extension — PRD done. Needs paid Apple Developer account first.
3. Trip collaboration — PRD done. Need to discuss UI layout (share/invite buttons, collaborator list, comments). Open question: should collaborator removal be creator-only?

**Deferred (needs discussion before building):**
4. Original document access — everywhere a document populates data, user should be able to view the original PDF/screenshot from within the app. Ideally offline.
5. "Add a field" for missing data — accommodation detail screen should let users manually add fields the parser didn't extract, instead of showing empty rows.
6. Settings toggle — show/hide saved place pins on home map. Build when settings screen is fleshed out.
7. Security, infrastructure, scaling discussion — API key exposure, Supabase RLS, error recovery, rate limits, cost at scale. Must happen before launch.

**Design polish (after features are complete):**
8. Saved places map pins — category icons, pin styling, callout design
9. General design polish pass

**Other:**
10. Buy domain — get-waypoint.com ($10.46 on Namecheap/Cloudflare). Not yet purchased.

---

## Claude Code Tooling

**Skills (user scope):**
- `claude-code-setup` — codebase analysis and automation recommendations
- `skill-creator` — create and test custom skills
- `frontend-design` — distinctive, non-generic UI output
- `superpowers` — structured dev workflow: brainstorm → plan → TDD → execute → review

**MCP servers (user scope):**
- `context7` — live, version-specific library docs. Add "use context7" to prompts for current APIs
- `supabase` — direct access to Waypoint's Supabase project (schema, queries, auth, storage)
- `github` — repo management, issues, PRs, code search (repo: peterlancashire5/Waypoint)

Use context7 when writing code that touches Expo, React Native, or Supabase APIs. Use the Supabase MCP to verify schema before writing queries.

---

## Workflow Preferences

- **Explain before acting.** Before making changes, explain what you plan to do and why.
- **Present options.** When there are multiple valid approaches, lay out the tradeoffs and let me choose. Don't assume.
- **I'm learning.** I'm experienced with the product vision but newer to development — be explicit about technical decisions.
- **Use superpowers for complex features.** For new features or multi-file changes, use the brainstorm → plan → execute workflow. For small fixes, just do them.
- **Planning happens in Claude.ai.** Feature design and strategy discussions happen in the Claude.ai chatbot. Claude Code receives implementation briefs from those conversations.

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
  booking-detail.tsx       Booking detail screen
  create-trip.tsx          Modal — create a new trip (stack, slides up)
  leg.tsx                  Modal — leg detail / booking (stack, slides up)
  place-detail.tsx         Place detail screen
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

components/
  AddStopSheet.tsx         Modal sheet for adding a new stop (city + optional dates) to a trip
  BookingPreviewSheet.tsx  Bottom sheet showing AI-parsed booking details with stop/leg assignment picker and save/discard actions
  CityAutocomplete.tsx     City search with autocomplete suggestions
  ManualAccommodationSheet.tsx   Manual accommodation entry form
  ManualTransportSheet.tsx       Manual transport/leg creation form
  PlaceDetailSheet.tsx     Bottom sheet for viewing, editing, moving, and deleting a saved place (with map preview)
  QuickCaptureFAB.tsx      Floating action button for quick item capture
  auth/SocialButton.tsx    Apple / Google sign-in buttons
  ui/Button.tsx            Primary / secondary / ghost / dark variants + loading state
  ui/Divider.tsx           Labelled horizontal divider

constants/
  colors.ts                All design tokens
  typography.ts            Font family names + textStyle presets

hooks/
  useAuth.ts               signInWithEmail, signUpWithEmail, signInWithApple,
                           signInWithGoogle, signOut

lib/
  claude.ts                Anthropic API client — parses PDFs/images into typed booking or place structs via claude-opus-4-6
  duplicateCheck.ts        Checks a parsed booking against existing Supabase records to detect duplicates before saving
  inboxCount.ts            Inbox item count utility
  journeyUtils.ts          Multi-leg journey helpers
  placesEnrichment.ts      Queries Google Places Text Search API to resolve a place name into address, coords, and category
  savedPlaceUtils.ts       Saved places utilities
  supabase.ts              Supabase client — SecureStore session adapter
                           Project URL: bvrgvzxerdefiklgtclw.supabase.co
  tripStore.ts             Lightweight in-memory store for newly created trips within a session (not persisted)

supabase/migrations/
  001_initial_schema.sql   Full schema — apply via Supabase SQL Editor
```

---

## Routing Architecture

Expo Router 4 with a root Stack. Key points:

- **Route groups are transparent** — `app/(main)/foo.tsx` has URL `/foo`, not `/(main)/foo`. Never use the group name in `pathname`.
- **Stack screens for detail/modal views** — registered explicitly in `app/_layout.tsx`. Currently: `leg` (modal), `create-trip` (modal), `stop-detail`, `trip-detail`, `booking-detail`, `place-detail`, `settings`.
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
- [x] Stop detail screen (header with real data; tab content)
- [x] Stop editing
- [x] Leg modal (real transport + booking data; empty state)
- [x] Inbox screen (with inbox count utility)
- [x] Settings screen (email + sign out)
- [x] Full Supabase schema + RLS policies
- [x] Multi-leg journey support (journeyUtils)
- [x] Manual transport/leg creation (ManualTransportSheet)
- [x] Manual accommodation entry (ManualAccommodationSheet)
- [x] Accommodation format expansion
- [x] City autocomplete (CityAutocomplete component)
- [x] Saved places utilities
- [x] Saved places as map pins
- [x] Place detail screen + sheet
- [x] Booking detail screen + preview sheet
- [x] Quick capture FAB
- [x] PDF upload / AI document parsing (lib/claude.ts)
- [x] Duplicate detection (lib/duplicateCheck.ts)
- [x] Places enrichment (lib/placesEnrichment.ts)

## What's Not Built Yet

**Bugs to fix:**
- [ ] Journey detail screen (only shows first leg)
- [ ] Ljubljana geocoding pin issue
- [ ] DocumentPicker tap-to-select (iOS simulator)

**Features:**
- [ ] Booking status markers (confirmed / pending / not yet booked)
- [ ] iOS share extension (PRD done, needs paid Apple Developer account)
- [ ] Trip collaboration (PRD done, UI layout discussion needed)
- [ ] Original document access (view source PDF/screenshot in-app)
- [ ] "Add a field" for accommodation (manual fields parser missed)
- [ ] Settings toggle for saved place map pins
- [ ] Events / day planner
- [ ] Forgot password flow
- [ ] Push notifications

**Pre-launch:**
- [ ] Security / infrastructure / scaling review
- [ ] Design polish pass
- [ ] Buy domain (get-waypoint.com)
