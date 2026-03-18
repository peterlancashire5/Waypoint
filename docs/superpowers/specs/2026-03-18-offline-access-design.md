# Offline Access — Design Spec
**Date:** 2026-03-18
**Status:** Approved

---

## Overview

Build offline access for Waypoint across two phases:

- **Phase 1:** Itinerary data cache using AsyncStorage. All screens serve cached data when offline.
- **Phase 2:** Document storage pipeline (upload to Supabase Storage), in-app viewing via iOS Quick Look, and local document cache via expo-file-system.

Both phases ship ungated to all users. A Pro gate will be added in a future task when RevenueCat/StoreKit is integrated.

---

## Phase 1: Itinerary Data Cache

### New Shared Building Blocks

#### `context/NetworkContext.tsx`
- `NetworkProvider` wraps the root layout (`app/_layout.tsx`).
- Subscribes to `@react-native-community/netinfo` for real-time connectivity updates.
- Exposes `isOnline: boolean` via `useNetworkStatus()` hook.
- Manages a global toast queue for "You're offline — showing saved data" and "Back online" messages.
- Renders the global `OfflineBanner` and global `Toast` at the root level so they appear on every screen.

#### `lib/offlineCache.ts`
Pure utility functions for AsyncStorage cache operations:

| Function | Purpose |
|---|---|
| `writeTripListCache(data)` | Serialise and store the trip list |
| `readTripListCache()` | Return parsed trip list or null |
| `writeTripCache(tripId, data)` | Store full trip data (stops, legs, bookings, accommodation, saved places) |
| `readTripCache(tripId)` | Return parsed trip data or null |
| `updateLastOpenedAt(tripId)` | Update `waypoint_cache_meta` map with current timestamp |
| `runCacheCleanup()` | Delete cache entries for trips not opened in 30+ days |

**Cache key pattern:**
- Trip list: `waypoint_cache_trip_list`
- Individual trip: `waypoint_cache_trip_{trip_id}`
- Metadata (last opened timestamps): `waypoint_cache_meta`

**30-day scoping:** `waypoint_cache_meta` stores `{ [tripId]: ISO timestamp }`. On every cache write and on app launch, `runCacheCleanup()` compares `last_opened_at` against today and removes stale entries from both `waypoint_cache_trip_{id}` and the metadata map.

#### `components/ui/Toast.tsx`
Extracted and generalised from `QuickCaptureFAB.tsx`:
- Props: `message`, `position: 'top' | 'bottom'`, optional `action?: { label: string; onPress: () => void }` (replaces hardcoded Undo)
- Existing FAB undo toast migrates to use this component with `position: 'bottom'` and `action={{ label: 'Undo', onPress: ... }}`
- Offline toasts use `position: 'top'`, no action

#### `components/ui/OfflineBanner.tsx`
- Full-width, 32px height, renders below the system status bar
- Amber/grey background, wifi-off icon + "No internet connection" text
- Slides in from top when `!isOnline`, slides out when back online
- Rendered from `app/_layout.tsx` via `NetworkProvider`

### Cache Write + Offline Fallback Pattern

Every screen that fetches from Supabase follows this pattern:

```
isOnline === false → skip fetch, go directly to cache
isOnline === true  → fetch from Supabase
    → success: render data + write to AsyncStorage (background, fire and forget)
    → error:   fall back to AsyncStorage
                 → cache hit:  render data + trigger "offline" toast (once per session)
                 → cache miss: show "No saved data available" empty state
```

The `useFocusEffect` pattern used throughout the app is unchanged. Fallback logic is added inside each screen's existing fetch function.

**Screens that get cache write + fallback:**
- `app/(main)/trips.tsx` — trip list
- `app/trip-detail.tsx` — full trip data
- `app/stop-detail.tsx` — stop data
- `app/booking-detail.tsx` — leg_booking + accommodation data
- `app/leg.tsx` — leg data

**`last_opened_at` tracking:** `updateLastOpenedAt(tripId)` is called when `trip-detail.tsx` loads. This updates the metadata map so the cleanup pass knows which trips are active.

### Offline UX

#### Toast Notifications
- **First offline detection in a session:** "You're offline — showing saved data" — top toast, 3 seconds, shown once per session (session flag in memory, not persisted).
- **Back online:** "Back online" — top toast, 2 seconds.
- **Tapping a greyed-out action:** "You're offline" — top toast, 2 seconds.

#### Offline Banner
- Thin full-width banner below status bar, present on all screens while offline.
- Animates in/out on connectivity change.
- Managed entirely from root layout — zero per-screen changes needed.

#### Greyed-Out Actions
All write actions check `isOnline` from `useNetworkStatus()`:
- `opacity: isOnline ? 1 : 0.4`
- `onPress`: when offline, shows "You're offline" toast instead of performing the action

**Affected actions across all screens:**
- Add stop, add leg, add booking, add accommodation
- Edit / delete on any existing item
- QuickCaptureFAB (disabled entirely when offline)
- Save / submit buttons in sheets and modals

Navigation-only actions are never disabled.

#### Back Online Behaviour
`NetworkProvider` listens for the transition from `isOnline === false` to `isOnline === true`:
1. Show "Back online" toast
2. Emit a refresh event (via a context callback or a simple event emitter) that the currently focused screen listens to, triggering a fresh Supabase fetch

---

## Phase 2: Document Storage Pipeline + Offline Document Cache

### Part A: Storage and Database

#### New Supabase Migration
Two new tables:

**`document_files`**
```sql
id             uuid primary key default gen_random_uuid()
user_id        uuid references auth.users not null
trip_id        uuid references trips not null
storage_path   text not null
file_type      text not null  -- 'pdf' | 'jpg' | 'png'
original_filename text not null
file_size_bytes integer
created_at     timestamptz default now()
```

**`document_links`**
```sql
id             uuid primary key default gen_random_uuid()
document_id    uuid references document_files not null
linkable_type  text not null  -- 'leg_booking' | 'accommodation' | 'saved_place'
linkable_id    uuid not null
created_at     timestamptz default now()
unique (document_id, linkable_type, linkable_id)
```

**RLS policies:** Mirror the existing `is_trip_member(trip_id)` pattern used throughout the schema:
- SELECT: user owns the trip or is a member
- INSERT: user is authenticated and is a trip member
- DELETE: user is the document owner (`user_id = auth.uid()`)

#### Supabase Storage Bucket
- Bucket name: `documents`
- Path pattern: `{user_id}/{trip_id}/{uuid}_{original_filename}`
- Storage RLS:
  - SELECT: authenticated users who are trip members
  - INSERT: authenticated users uploading to their own `user_id` prefix
  - DELETE: only the file owner

#### Upload Flow

Modified in `QuickCaptureFAB.tsx`. The source file bytes (base64 + mediaType) are currently available in the pick/capture handlers and passed to `parseBookingFile`. They need to be threaded through to the save step.

After `saveBooking()` resolves successfully, a background upload fires (non-blocking):
1. Decode base64 → `Uint8Array`
2. Upload to Supabase Storage at `{user_id}/{trip_id}/{uuid}_{filename}`
3. Insert row in `document_files`
4. Insert row in `document_links` with the `linkable_type` and `linkable_id` from the saved record
5. Log failures silently — the booking is already saved regardless

The `trip_id` for the link is resolved from the saved record (available from `saveBooking`'s return value which includes the table and id).

### Part B: In-App Document Viewing

#### "View original" in `booking-detail.tsx`
- On load, query `document_links` for the current record (`linkable_type` + `linkable_id`).
- If a link exists, fetch the associated `document_files` row for `storage_path`.
- Render a "View original" row conditionally. No empty state if no document is found.

#### View logic on tap
```
1. Check local cache map (waypoint_doc_cache_map) for document_id
   → cached: open file at local path via react-native-file-viewer
   → not cached + online: download from Supabase Storage to temp path, then open
   → not cached + offline: show "Document not available offline" toast
```

**`react-native-file-viewer`** opens files using the platform's native viewer. On iOS this is iOS Quick Look — full-screen, pinch-to-zoom, print, share. Install with `npm install react-native-file-viewer --legacy-peer-deps`. Requires a native dev build rebuild.

### Part C: Offline Document Cache

#### `lib/documentCache.ts`
| Function | Purpose |
|---|---|
| `downloadDocumentsForTrip(tripId)` | Fetch all document_links for the trip's records, resolve to document_files rows, download missing files to documentDirectory |
| `getLocalDocumentPath(documentId)` | Return local file path from cache map, or null |
| `cleanupDocumentCache(expiredTripIds)` | Delete local files and remove mapping entries for expired trips |

**Cache map:** `waypoint_doc_cache_map` in AsyncStorage — `{ [documentId]: absoluteLocalPath }`.

**Trigger:** `downloadDocumentsForTrip(tripId)` is called from `trip-detail.tsx` after a successful online fetch (background, non-blocking).

**Cleanup:** `runCacheCleanup()` in `lib/offlineCache.ts` calls `cleanupDocumentCache()` with the list of expired trip IDs so both caches stay in sync.

---

## New Files

| File | Purpose |
|---|---|
| `context/NetworkContext.tsx` | NetworkProvider + useNetworkStatus hook |
| `lib/offlineCache.ts` | AsyncStorage cache read/write/cleanup |
| `lib/documentCache.ts` | Document download/cache/cleanup |
| `components/ui/Toast.tsx` | Extracted + generalised toast component |
| `components/ui/OfflineBanner.tsx` | Thin offline banner rendered from root |
| `supabase/migrations/010_document_storage.sql` | document_files + document_links tables + RLS |

## Modified Files

| File | Change |
|---|---|
| `app/_layout.tsx` | Wrap with NetworkProvider, render OfflineBanner |
| `app/(main)/trips.tsx` | Cache write + fallback, greyed-out add button |
| `app/trip-detail.tsx` | Cache write + fallback, updateLastOpenedAt, document download trigger, greyed-out actions |
| `app/stop-detail.tsx` | Cache write + fallback, greyed-out actions |
| `app/booking-detail.tsx` | Cache write + fallback, document link query, "View original" button |
| `app/leg.tsx` | Cache write + fallback, greyed-out actions |
| `components/QuickCaptureFAB.tsx` | Thread source bytes through save, background document upload, disabled when offline |
| `components/ui/Button.tsx` | Accept isOnline prop or consume from context for offline state |

---

## New Dependencies

| Package | Install command | Purpose |
|---|---|---|
| `@react-native-community/netinfo` | `expo install @react-native-community/netinfo` | Network connectivity detection |
| `@react-native-async-storage/async-storage` | `expo install @react-native-async-storage/async-storage` | Local data cache |
| `react-native-file-viewer` | `npm install react-native-file-viewer --legacy-peer-deps` | iOS Quick Look / Android native viewer |

---

## What's Not Built

- No Pro tier gating (deferred to RevenueCat integration)
- No offline write queue — read-only when offline
- No real-time sync or conflict resolution
- No manual "download for offline" button — automatic only
- No share extension modifications
- No "View original" on saved places (only leg_bookings and accommodation)

---

## Testing Instructions

### Phase 1 — Itinerary cache
1. Open a trip on the device while connected. Navigate through stops, legs, bookings.
2. Enable airplane mode.
3. Force-quit and reopen the app (or navigate away and back to the trip).
4. Verify: cached trip data loads, "You're offline — showing saved data" toast appears at the top, thin offline banner appears below the status bar.
5. Tap an edit or add button. Verify it's greyed out and shows "You're offline" toast.
6. Disable airplane mode.
7. Verify: "Back online" toast, banner disappears, buttons re-enable, data refreshes from Supabase.

### Phase 2A — Document upload
1. Use QuickCaptureFAB to upload a PDF or take a photo of a booking confirmation.
2. Confirm and save the booking.
3. In Supabase Table Editor, verify a row exists in `document_files` and `document_links`.
4. In Supabase Storage, verify the file exists in the `documents` bucket.

### Phase 2B — Document viewing
1. Open a booking detail screen for a record that has an attached document.
2. Verify the "View original" button/row is present.
3. Tap it. Verify the document opens in Quick Look (full-screen, pinch-to-zoom).
4. Open a booking with no attached document. Verify no "View original" row appears.

### Phase 2C — Offline document cache
1. While connected, open a trip that has uploaded documents (triggers background download).
2. Enable airplane mode.
3. Navigate to a booking with an attached document and tap "View original".
4. Verify the document loads from local cache (no network request needed).
5. Test a document that was NOT pre-cached. Verify "Document not available offline" message appears.

### Cache cleanup
1. In `lib/offlineCache.ts`, temporarily reduce the 30-day threshold to 1 minute.
2. Open a trip, wait 1 minute, then trigger a cleanup pass (app relaunch or next fetch).
3. Verify the trip's AsyncStorage cache entry is removed and locally cached documents for that trip are deleted.
