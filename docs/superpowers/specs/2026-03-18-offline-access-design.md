# Offline Access — Design Spec
**Date:** 2026-03-18
**Status:** Approved

---

## Overview

Build offline access for Waypoint across two phases:

- **Phase 1:** Itinerary data cache using AsyncStorage. All screens serve cached data when offline.
- **Phase 2:** Document storage pipeline (upload to Supabase Storage), in-app viewing via iOS Quick Look, and local document cache via expo-file-system.

Both phases ship ungated to all users. A Pro gate will be added in a future task when RevenueCat/StoreKit is integrated.

**Native build note:** The project already uses a custom Expo dev build (it includes react-native-maps, react-native-reanimated, etc.) so Expo Go is not in use. `react-native-file-viewer` requires a native module and a fresh dev build rebuild after install. This rebuild step is part of Phase 2 setup.

---

## Phase 1: Itinerary Data Cache

### New Shared Building Blocks

#### `context/NetworkContext.tsx`
- `NetworkProvider` wraps the root layout (`app/_layout.tsx`).
- Subscribes to `@react-native-community/netinfo` for real-time connectivity updates.
- Exposes `isOnline: boolean` via `useNetworkStatus()` hook.
- Stores `hasShownOfflineToast: boolean` in component state (in-memory only, resets on app launch) to ensure the first-offline toast fires only once per session.
- Exposes `onlineRefreshTrigger: number` — a counter incremented each time connectivity transitions from false → true. Screens include this value as a dependency in their data-fetch `useCallback` inside `useFocusEffect`, causing them to re-fetch when back online (if currently focused) or on next focus otherwise.
- Manages a global toast queue for "You're offline — showing saved data" and "Back online" messages.
- Exposes a `showOfflineToast(message)` function so any screen or component can trigger the "You're offline" toast without managing its own toast state.
- Renders the global `OfflineBanner` and global `Toast` at the root level. Root-level toasts always render above tab-navigator-level toasts (the existing FAB undo toast). No additional z-index coordination is needed since the root layout is the topmost render layer.

#### `lib/offlineCache.ts`
Pure utility functions for AsyncStorage cache operations:

| Function | Purpose |
|---|---|
| `writeTripListCache(data)` | Serialise and store the trip list |
| `readTripListCache()` | Return parsed trip list or null |
| `writeTripCache(tripId, data)` | Store full trip data (stops, legs, bookings, accommodation, saved places) |
| `readTripCache(tripId)` | Return parsed trip data or null |
| `writeStopCache(stopId, data)` | Store stop-level data for stop-detail screen |
| `readStopCache(stopId)` | Return parsed stop data or null |
| `updateLastOpenedAt(tripId)` | Update `waypoint_cache_meta` map with current timestamp |
| `runCacheCleanup()` | Delete cache entries for trips not opened in 30+ days; calls `cleanupDocumentCache()` from `lib/documentCache.ts` with the list of expired trip IDs |

**Cache key pattern:**
- Trip list: `waypoint_cache_trip_list`
- Individual trip: `waypoint_cache_trip_{trip_id}`
- Individual stop: `waypoint_cache_stop_{stop_id}`
- Metadata (last opened timestamps): `waypoint_cache_meta`

**30-day scoping:** `waypoint_cache_meta` stores `{ [tripId]: { lastOpenedAt: string; stopIds: string[] } }`. The `stopIds` array is populated when `writeTripCache()` is called — extract all stop IDs from the trip data and store them alongside the timestamp. `runCacheCleanup()` is called at two points: (1) once on app launch inside `NetworkProvider`'s initial `useEffect`, and (2) after each successful cache write. It compares `lastOpenedAt` against today and removes stale entries from `waypoint_cache_trip_{id}`, `waypoint_cache_stop_{stopId}` for each `stopId` in the expired trip's metadata entry, and the metadata map entry itself.

#### `components/ui/Toast.tsx`
A rewrite and generalisation of the existing `Toast` component in `QuickCaptureFAB.tsx`:
- Props: `message: string`, `position: 'top' | 'bottom'`, `duration?: number` (default 3000ms), optional `action?: { label: string; onPress: () => void }`
- The existing undo action (currently hardcoded as JSX inside `QuickCaptureFAB`) maps to `action={{ label: 'Undo', onPress: handleUndo }}`.
- Offline toasts use `position: 'top'`, no `action`.
- Positioning: `top` toasts use `useSafeAreaInsets().top` to render below the system status bar without overlapping it, then shift down an additional 8px when the OfflineBanner is visible.

#### `components/ui/OfflineBanner.tsx`
- Full-width, 32px height, rendered as an absolutely-positioned element at the top of the screen.
- Uses `useSafeAreaInsets().top` to position below the system status bar.
- Amber/grey background (`#8B6914` tint or `colors.textMuted` background), wifi-off icon + "No internet connection" text.
- Translates in from off-screen top when `!isOnline`, slides out when back online (simple `Animated.timing` translate).
- Rendered from `app/_layout.tsx` via `NetworkProvider`. All screens continue to manage their own `SafeAreaView` insets normally — the banner overlaps the top of screens. Screens with sticky headers that could be obscured by the banner can derive banner visibility from `!isOnline` (already exposed by `useNetworkStatus()`) and add 32px top padding conditionally.

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

The `useFocusEffect` pattern used throughout the app is unchanged. Fallback logic is added inside each screen's existing fetch function. The `onlineRefreshTrigger` from `useNetworkStatus()` is included in the `useCallback` dependency array inside `useFocusEffect` so screens re-fetch when connectivity is restored.

**Screens that get cache write + fallback:**
- `app/(main)/trips.tsx` — trip list (`waypoint_cache_trip_list`)
- `app/trip-detail.tsx` — full trip data (`waypoint_cache_trip_{tripId}`)
- `app/stop-detail.tsx` — stop data (`waypoint_cache_stop_{stopId}`)
- `app/booking-detail.tsx` — leg_booking + accommodation data (reads from stop/trip cache; no separate key needed)
- `app/leg.tsx` — leg data (reads from trip cache; no separate key needed)

**`last_opened_at` tracking:** `updateLastOpenedAt(tripId)` is called when `trip-detail.tsx` successfully loads. The `tripId` is available from the screen's `useLocalSearchParams`.

### Offline UX

#### Toast Notifications
- **First offline detection in a session:** "You're offline — showing saved data" — top toast, 3 seconds, shown once per session (`hasShownOfflineToast` guard in `NetworkProvider`).
- **Back online:** "Back online" — top toast, 2 seconds.
- **Tapping a greyed-out action:** "You're offline" — top toast, 2 seconds, via `showOfflineToast()` from context.

#### Offline Banner
- Thin full-width banner below system status bar, present on all screens while offline.
- Animates in/out on connectivity change.
- Managed entirely from root layout — zero per-screen layout changes required.

#### Greyed-Out Actions
All write actions check `isOnline` from `useNetworkStatus()`:
- `opacity: isOnline ? 1 : 0.4`
- `onPress`: when offline, calls `showOfflineToast('You\'re offline')` instead of performing the action

**Affected actions across all screens:**
- Add stop, add leg, add booking, add accommodation
- Edit / delete on any existing item
- QuickCaptureFAB (disabled entirely when offline)
- Save / submit buttons in sheets and modals

Navigation-only actions are never disabled.

#### Back Online Behaviour
`NetworkProvider` detects the `isOnline` transition from false → true:
1. Shows "Back online" toast
2. Increments `onlineRefreshTrigger`
3. Screens with `onlineRefreshTrigger` in their `useCallback` deps automatically re-fetch if focused (or on next focus if not currently focused)

---

## Phase 2: Document Storage Pipeline + Offline Document Cache

### Part A: Storage and Database

#### New Supabase Migration (`010_document_storage.sql`)
**Note:** Verify migration number at implementation time — if `008_collaboration_rls.sql` has been applied before this work starts, the sequence may shift. Use the next available number.

Two new tables:

**`document_files`**
```sql
id                uuid primary key default gen_random_uuid()
user_id           uuid references auth.users not null
trip_id           uuid references trips  -- nullable: null for inbox documents
storage_path      text not null
file_type         text not null  -- 'pdf' | 'jpg' | 'png'
original_filename text not null
file_size_bytes   integer
created_at        timestamptz default now()
```

`trip_id` is nullable to handle the case where a booking is saved to the inbox (no trip assigned). The RLS policy for null `trip_id` rows falls back to `user_id = auth.uid()` ownership check.

**`document_links`**
```sql
id             uuid primary key default gen_random_uuid()
document_id    uuid references document_files on delete cascade not null
linkable_type  text not null  -- 'leg_booking' | 'accommodation' | 'saved_place'
linkable_id    uuid not null
created_at     timestamptz default now()
unique (document_id, linkable_type, linkable_id)
```

`document_links.document_id` cascades on delete (if a `document_files` row is deleted, its links are cleaned up). `linkable_id` has no FK constraint — this is intentional in a polymorphic pattern. Orphan cleanup (when a booking/accommodation is deleted) is handled at the application layer: when `deleteTransportBooking` or accommodation delete is called, also query and delete any `document_links` rows for that record, then delete the `document_files` row and Supabase Storage file.

**RLS policies for `document_files`:**
- SELECT: `trip_id IS NULL AND user_id = auth.uid()` OR `is_trip_member(trip_id)`
- INSERT: authenticated, with `user_id = auth.uid()`
- DELETE: `user_id = auth.uid()`

**RLS policies for `document_links`:**
- SELECT/INSERT/DELETE: use an `EXISTS` subquery to inherit access from the parent document. Example pattern:
  ```sql
  EXISTS (
    SELECT 1 FROM document_files df
    WHERE df.id = document_links.document_id
      AND (
        (df.trip_id IS NULL AND df.user_id = auth.uid())
        OR is_trip_member(df.trip_id)
      )
  )
  ```

#### Supabase Storage Bucket
- Bucket name: `documents`
- Path pattern: `{user_id}/{trip_id}/{uuid}_{original_filename}` (for inbox documents use `{user_id}/inbox/{uuid}_{filename}`)
- Storage RLS:
  - SELECT: authenticated users who own the file (`user_id` prefix matches) or are trip members
  - INSERT: authenticated users uploading to their own `user_id` prefix
  - DELETE: only the file owner

#### Upload Flow

**Source file threading in `QuickCaptureFAB.tsx`:** The source file URI is currently available in `handleUploadFile`, `handleChoosePhoto`, and `handleTakePhoto` as `asset.uri`. Add two new state values: `sourceFileUri: string | null` and `sourceMediaType: BookingMediaType | null`. These are set at the point of capture/pick, cleared after a successful upload or on discard. When `saveBooking()` resolves with a saved record, the background upload reads from these state values.

**Client-side size check:** Before uploading to Supabase Storage, check `file_size_bytes`. If the file exceeds 20MB, skip the upload and log a warning. Do not show an error to the user — the booking was already saved.

**Background upload fires after `saveBooking()` resolves (non-blocking):**
1. Check file size ≤ 20MB; if larger, skip and log
2. If `trip_id` is unknown (inbox save), use null for `trip_id` and `inbox` segment in storage path
3. Decode base64 → `Uint8Array` (or use the original URI directly if available from file system)
4. Upload to Supabase Storage at `{user_id}/{trip_id_or_inbox}/{uuid}_{filename}`
5. Insert row in `document_files`
6. Insert row in `document_links` with `linkable_type` and `linkable_id` from the saved record
7. Log failures silently — the booking is already saved regardless

### Part B: In-App Document Viewing

#### "View original" in `booking-detail.tsx`
- On load (inside existing `useEffect`), query `document_links` where `linkable_type = 'leg_booking'` (or `'accommodation'`) and `linkable_id = recordId`. If a link exists, fetch the associated `document_files` row for `storage_path` and `file_type`.
- Render a "View original" row conditionally. No empty state if no document is found.

#### View logic on tap
```
1. Check local cache map (waypoint_doc_cache_map) for document_id
   → cached: open file at local path via react-native-file-viewer
   → not cached + online:
       download from Supabase Storage to FileSystem.documentDirectory + filename
       update waypoint_doc_cache_map
       open with react-native-file-viewer
   → not cached + offline: showOfflineToast('Document not available offline')
```

**`react-native-file-viewer`** opens files using the platform's native viewer. On iOS this is iOS Quick Look — full-screen, pinch-to-zoom, print, share. Install with `npm install react-native-file-viewer --legacy-peer-deps`. Requires a native dev build rebuild before testing.

### Part C: Offline Document Cache

#### `lib/documentCache.ts`
| Function | Purpose |
|---|---|
| `downloadDocumentsForTrip(tripId, supabase)` | Fetch all document_links for the trip's records, resolve to document_files rows, download missing files to documentDirectory |
| `getLocalDocumentPath(documentId)` | Return local file path from cache map, or null |
| `cleanupDocumentCache(expiredTripIds)` | Query document_files for each expired tripId, delete local files, remove mapping entries |

**Cache map:** `waypoint_doc_cache_map` in AsyncStorage — `{ [documentId]: absoluteLocalPath }`.

**Trigger:** `downloadDocumentsForTrip(tripId, supabase)` is called from `trip-detail.tsx` after a successful online fetch (background, non-blocking). Does nothing if offline.

**Cleanup:** `runCacheCleanup()` in `lib/offlineCache.ts` passes expired trip IDs to `cleanupDocumentCache()` so both caches stay in sync.

---

## New Files

| File | Purpose |
|---|---|
| `context/NetworkContext.tsx` | NetworkProvider + useNetworkStatus hook |
| `lib/offlineCache.ts` | AsyncStorage cache read/write/cleanup |
| `lib/documentCache.ts` | Document download/cache/cleanup |
| `components/ui/Toast.tsx` | Rewritten generalised toast component |
| `components/ui/OfflineBanner.tsx` | Thin offline banner rendered from root |
| `supabase/migrations/010_document_storage.sql` | document_files + document_links tables + RLS (number TBC) |

## Modified Files

| File | Change |
|---|---|
| `app/_layout.tsx` | Wrap with NetworkProvider, render OfflineBanner |
| `app/(main)/trips.tsx` | Cache write + fallback, greyed-out add button |
| `app/trip-detail.tsx` | Cache write + fallback, updateLastOpenedAt, document download trigger, greyed-out actions, onlineRefreshTrigger dep |
| `app/stop-detail.tsx` | Cache write + fallback (own stop cache key), greyed-out actions |
| `app/booking-detail.tsx` | Cache fallback, document link query, "View original" button |
| `app/leg.tsx` | Cache fallback (reads trip cache), greyed-out actions |
| `components/QuickCaptureFAB.tsx` | Add sourceFileUri/sourceMediaType state, thread to background upload, disabled when offline, migrate undo toast to new Toast component |
| `components/ui/Button.tsx` | No change needed — offline state handled per-screen via useNetworkStatus |

**Note on `Button.tsx`:** The greyed-out offline state is applied at the callsite (each Pressable/button in each screen), not inside the `Button` component itself. This avoids making `Button` aware of network state and keeps the pattern explicit.

---

## New Dependencies

| Package | Install command | Purpose |
|---|---|---|
| `@react-native-community/netinfo` | `npx expo install @react-native-community/netinfo` | Network connectivity detection |
| `@react-native-async-storage/async-storage` | `npx expo install @react-native-async-storage/async-storage` | Local data cache |
| `react-native-file-viewer` | `npm install react-native-file-viewer --legacy-peer-deps` | iOS Quick Look / Android native viewer — requires dev build rebuild |

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
4. Verify: cached trip data loads, "You're offline — showing saved data" top toast appears once, thin offline banner appears below the status bar.
5. Navigate to another trip screen. Verify the toast does NOT appear again (once per session).
6. Tap an edit or add button. Verify it is greyed out (opacity ~0.4) and shows "You're offline" toast.
7. Disable airplane mode.
8. Verify: "Back online" toast appears, banner disappears, buttons re-enable, data refreshes from Supabase automatically.

### Phase 2A — Document upload
1. Use QuickCaptureFAB to upload a PDF or take a photo of a booking confirmation.
2. Confirm and save the booking.
3. In Supabase Table Editor, verify a row exists in `document_files` and `document_links`.
4. In Supabase Storage, verify the file exists in the `documents` bucket at the correct path.
5. Save a booking to the inbox (no trip assigned). Verify a `document_files` row is created with `trip_id = null` and the file is stored under the `inbox` path prefix.

### Phase 2B — Document viewing
1. Open a booking detail screen for a record that has an attached document.
2. Verify the "View original" row is present.
3. Tap it. Verify the document opens in iOS Quick Look (full-screen, pinch-to-zoom, share/print options).
4. Open a booking with no attached document. Verify no "View original" row appears.

### Phase 2C — Offline document cache
1. While connected, open a trip that has uploaded documents (this triggers the background document download).
2. Enable airplane mode.
3. Navigate to a booking with an attached document and tap "View original".
4. Verify the document loads from local cache (Quick Look opens without network access).
5. Test a document that was NOT downloaded: verify "Document not available offline" toast appears.

### Cache cleanup
1. In `lib/offlineCache.ts`, temporarily reduce the 30-day threshold to 1 minute for testing.
2. Open a trip, wait 1 minute.
3. Trigger a cleanup pass by relaunching the app or making a fresh network request.
4. Verify the trip's AsyncStorage cache entry (`waypoint_cache_trip_{id}`) is removed, and locally cached documents for that trip are deleted from the file system and removed from `waypoint_doc_cache_map`.
