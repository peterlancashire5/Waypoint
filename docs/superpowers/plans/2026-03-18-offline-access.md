# Offline Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full offline support — AsyncStorage itinerary cache (Phase 1) and Supabase Storage document pipeline with local file cache and iOS Quick Look viewer (Phase 2).

**Architecture:** A `NetworkProvider` at the root wraps the app, exposes `isOnline` + `onlineRefreshTrigger` + `showOfflineToast` via context. Cache utilities in `lib/offlineCache.ts` and `lib/documentCache.ts` handle AsyncStorage and FileSystem respectively. Every data-fetching screen writes to cache on success and falls back to cache when offline.

**Tech Stack:** `@react-native-community/netinfo`, `@react-native-async-storage/async-storage`, `expo-file-system` (already installed), `react-native-file-viewer` (Phase 2, requires dev build rebuild), Supabase JS client v2 for Storage.

**Spec:** `docs/superpowers/specs/2026-03-18-offline-access-design.md`

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `context/NetworkContext.tsx` | NetworkProvider + `useNetworkStatus` hook — connectivity state, toasts, refresh trigger |
| `lib/offlineCache.ts` | AsyncStorage read/write/cleanup for trip list, trips, stops |
| `lib/documentCache.ts` | File system download, path lookup, cleanup for cached documents |
| `components/ui/Toast.tsx` | Generalised animated toast: top/bottom, optional action button |
| `components/ui/OfflineBanner.tsx` | Thin full-width "No internet connection" banner |
| `supabase/migrations/010_document_storage.sql` | `document_files` + `document_links` tables, RLS, storage bucket policy |

### Modified files
| File | Change |
|---|---|
| `app/_layout.tsx` | Wrap with `NetworkProvider` |
| `app/(main)/trips.tsx` | Cache write + fallback + greyed-out add button |
| `app/trip-detail.tsx` | Cache write + fallback + `updateLastOpenedAt` + document download trigger + greyed-out actions + `onlineRefreshTrigger` dep |
| `app/stop-detail.tsx` | Cache write + fallback (own key) + greyed-out actions |
| `app/booking-detail.tsx` | Cache fallback + document link query + "View original" button |
| `app/leg.tsx` | Cache fallback + greyed-out actions |
| `components/QuickCaptureFAB.tsx` | Migrate undo toast to `Toast.tsx`; add `sourceFileUri`/`sourceMediaType` state; background document upload; disable when offline |

---

## ── PHASE 1: INFRASTRUCTURE ──

---

### Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Step 1: Install netinfo and AsyncStorage via expo**

```bash
cd /Users/peterlancashire/waypoint
npx expo install @react-native-community/netinfo @react-native-async-storage/async-storage
```

Expected: both packages added to `package.json` with Expo-compatible versions, no errors.

- [ ] **Step 2: Verify installs**

```bash
grep -E "netinfo|async-storage" package.json
```

Expected: both packages appear under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add netinfo and AsyncStorage dependencies"
```

---

### Task 2: Create `lib/offlineCache.ts`

**Files:**
- Create: `lib/offlineCache.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/offlineCache.ts
//
// AsyncStorage cache for offline itinerary data.
// Metadata key: waypoint_cache_meta
//   Value: { [tripId]: { lastOpenedAt: string; stopIds: string[] } }
// Trip cache:  waypoint_cache_trip_{tripId}
// Stop cache:  waypoint_cache_stop_{stopId}
// Trip list:   waypoint_cache_trip_list

import AsyncStorage from '@react-native-async-storage/async-storage';

const TRIP_LIST_KEY = 'waypoint_cache_trip_list';
const TRIP_KEY = (id: string) => `waypoint_cache_trip_${id}`;
const STOP_KEY = (id: string) => `waypoint_cache_stop_${id}`;
const META_KEY = 'waypoint_cache_meta';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripMeta {
  lastOpenedAt: string; // ISO timestamp
  stopIds: string[];
}

type MetaMap = Record<string, TripMeta>;

// ─── Trip list ────────────────────────────────────────────────────────────────

export async function writeTripListCache(data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(TRIP_LIST_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[offlineCache] writeTripListCache failed:', e);
  }
}

export async function readTripListCache<T>(): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(TRIP_LIST_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    console.warn('[offlineCache] readTripListCache failed:', e);
    return null;
  }
}

// ─── Individual trip ──────────────────────────────────────────────────────────

export async function writeTripCache(tripId: string, data: unknown, stopIds: string[] = []): Promise<void> {
  try {
    await AsyncStorage.setItem(TRIP_KEY(tripId), JSON.stringify(data));
    // Update metadata with current timestamp and stop IDs
    const meta = await readMeta();
    meta[tripId] = {
      lastOpenedAt: new Date().toISOString(),
      stopIds,
    };
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('[offlineCache] writeTripCache failed:', e);
  }
}

export async function readTripCache<T>(tripId: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(TRIP_KEY(tripId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    console.warn('[offlineCache] readTripCache failed:', e);
    return null;
  }
}

// ─── Individual stop ──────────────────────────────────────────────────────────

export async function writeStopCache(stopId: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(STOP_KEY(stopId), JSON.stringify(data));
  } catch (e) {
    console.warn('[offlineCache] writeStopCache failed:', e);
  }
}

export async function readStopCache<T>(stopId: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(STOP_KEY(stopId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    console.warn('[offlineCache] readStopCache failed:', e);
    return null;
  }
}

// ─── Last-opened tracking ─────────────────────────────────────────────────────

export async function updateLastOpenedAt(tripId: string): Promise<void> {
  try {
    const meta = await readMeta();
    meta[tripId] = {
      lastOpenedAt: new Date().toISOString(),
      stopIds: meta[tripId]?.stopIds ?? [],
    };
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('[offlineCache] updateLastOpenedAt failed:', e);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Removes cache entries for trips not opened in 30+ days.
 * Returns the list of expired trip IDs (used by documentCache cleanup).
 */
export async function runCacheCleanup(): Promise<string[]> {
  try {
    const meta = await readMeta();
    const now = Date.now();
    const expiredTripIds: string[] = [];

    for (const [tripId, entry] of Object.entries(meta)) {
      const age = now - new Date(entry.lastOpenedAt).getTime();
      if (age > THIRTY_DAYS_MS) {
        expiredTripIds.push(tripId);
      }
    }

    if (expiredTripIds.length === 0) return [];

    // Build all keys to remove
    const keysToRemove: string[] = [];
    for (const tripId of expiredTripIds) {
      keysToRemove.push(TRIP_KEY(tripId));
      const stopIds = meta[tripId]?.stopIds ?? [];
      for (const stopId of stopIds) {
        keysToRemove.push(STOP_KEY(stopId));
      }
      delete meta[tripId];
    }

    await AsyncStorage.multiRemove(keysToRemove);
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));

    return expiredTripIds;
  } catch (e) {
    console.warn('[offlineCache] runCacheCleanup failed:', e);
    return [];
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function readMeta(): Promise<MetaMap> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/offlineCache.ts
git commit -m "feat: add offlineCache utility (AsyncStorage trip/stop cache)"
```

---

### Task 3: Create `components/ui/Toast.tsx`

This is a rewrite of the existing `Toast` component inside `QuickCaptureFAB.tsx`, generalised for global use. The FAB will be updated to use this in Task 6.

**Files:**
- Create: `components/ui/Toast.tsx`

- [ ] **Step 1: Create the file**

```typescript
// components/ui/Toast.tsx
//
// Generalised animated toast. Used for offline status messages (position: 'top')
// and the QuickCaptureFAB undo toast (position: 'bottom').

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastProps {
  message: string;
  position: 'top' | 'bottom';
  duration?: number;
  action?: ToastAction;
  /** Extra top offset (e.g. 40 when OfflineBanner is visible). Only used when position='top'. */
  topOffset?: number;
  onDismiss: () => void;
}

export default function Toast({
  message,
  position,
  duration = 3000,
  action,
  topOffset = 0,
  onDismiss,
}: ToastProps) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();

    timerRef.current = setTimeout(() => {
      dismiss();
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function dismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() =>
      onDismiss()
    );
  }

  function handleAction() {
    dismiss();
    action?.onPress();
  }

  const positionStyle =
    position === 'top'
      ? { top: insets.top + 8 + topOffset }
      : { bottom: 104 };

  return (
    <Animated.View style={[styles.toast, positionStyle, { opacity }]}>
      <Text style={styles.message} numberOfLines={2}>
        {message}
      </Text>
      {action && (
        <Pressable onPress={handleAction} hitSlop={8}>
          <Text style={styles.actionLabel}>{action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.text,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 9999,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.white,
    flex: 1,
  },
  actionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.accent,
    marginLeft: 12,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add components/ui/Toast.tsx
git commit -m "feat: add generalised Toast component (top/bottom, optional action)"
```

---

### Task 4: Create `components/ui/OfflineBanner.tsx`

**Files:**
- Create: `components/ui/OfflineBanner.tsx`

- [ ] **Step 1: Create the file**

```typescript
// components/ui/OfflineBanner.tsx
//
// Thin full-width banner displayed below the system status bar when offline.
// Rendered from the root layout via NetworkProvider — zero per-screen changes needed.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { fonts } from '@/constants/typography';

const BANNER_HEIGHT = 32;

interface OfflineBannerProps {
  visible: boolean;
}

export default function OfflineBanner({ visible }: OfflineBannerProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-BANNER_HEIGHT)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : -BANNER_HEIGHT,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <Animated.View
      style={[
        styles.banner,
        { top: insets.top, transform: [{ translateY }] },
      ]}
      pointerEvents="none"
    >
      <Feather name="wifi-off" size={13} color="#fff" />
      <Text style={styles.text}>No internet connection</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BANNER_HEIGHT,
    backgroundColor: '#6B6460',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    zIndex: 9998,
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: '#fff',
    letterSpacing: 0.2,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add components/ui/OfflineBanner.tsx
git commit -m "feat: add OfflineBanner component"
```

---

### Task 5: Create `context/NetworkContext.tsx`

**Files:**
- Create: `context/NetworkContext.tsx`

- [ ] **Step 1: Create the file**

```typescript
// context/NetworkContext.tsx
//
// NetworkProvider wraps the root layout. Subscribes to @react-native-community/netinfo.
//
// Exposed via useNetworkStatus():
//   isOnline: boolean           — current connectivity state
//   onlineRefreshTrigger: number — incremented on each offline→online transition.
//                                  Include in useFocusEffect useCallback deps to auto-refresh.
//   showOfflineToast(msg?)      — show a top toast with optional custom message.
//
// Also renders the global OfflineBanner and manages the first-offline session toast.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import Toast from '@/components/ui/Toast';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { runCacheCleanup } from '@/lib/offlineCache';

// ─── Context shape ────────────────────────────────────────────────────────────

interface NetworkContextValue {
  isOnline: boolean;
  onlineRefreshTrigger: number;
  showOfflineToast: (message?: string) => void;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  onlineRefreshTrigger: 0,
  showOfflineToast: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ToastEntry {
  id: number;
  message: string;
  duration: number;
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [onlineRefreshTrigger, setOnlineRefreshTrigger] = useState(0);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  // In-memory flags — reset on app launch, not persisted
  const hasShownOfflineToast = useRef(false);
  const wasOnline = useRef(true);
  const toastCounter = useRef(0);

  // ── Network subscription ──────────────────────────────────────────────────

  useEffect(() => {
    // Initial fetch
    NetInfo.fetch().then(handleNetworkChange);

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener(handleNetworkChange);

    // Run cache cleanup on app launch
    runCacheCleanup().catch(() => {});

    return () => unsubscribe();
  }, []);

  function handleNetworkChange(state: NetInfoState) {
    // Consider online only when connected AND internet is reachable (or unknown/null = assume reachable)
    const online =
      state.isConnected === true && state.isInternetReachable !== false;

    setIsOnline((prev) => {
      if (prev === online) return prev;

      if (!online) {
        // Just went offline — show toast once per session
        if (!hasShownOfflineToast.current) {
          hasShownOfflineToast.current = true;
          enqueueToast("You're offline — showing saved data", 3000);
        }
      } else if (!prev && online) {
        // Just came back online
        enqueueToast('Back online', 2000);
        setOnlineRefreshTrigger((n) => n + 1);
      }

      wasOnline.current = online;
      return online;
    });
  }

  // ── Toast management ──────────────────────────────────────────────────────

  function enqueueToast(message: string, duration: number) {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, duration }]);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // ── showOfflineToast (callable by screens/components) ─────────────────────

  const showOfflineToast = useCallback((message = "You're offline") => {
    enqueueToast(message, 2000);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <NetworkContext.Provider value={{ isOnline, onlineRefreshTrigger, showOfflineToast }}>
      {children}

      {/* Global offline banner — pointerEvents="none" so it doesn't block taps */}
      <OfflineBanner visible={!isOnline} />

      {/* Global toast stack — render only the most recent toast at a time */}
      {toasts.slice(-1).map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          position="top"
          duration={toast.duration}
          topOffset={!isOnline ? 40 : 0}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </NetworkContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNetworkStatus(): NetworkContextValue {
  return useContext(NetworkContext);
}
```

- [ ] **Step 2: Commit**

```bash
git add context/NetworkContext.tsx
git commit -m "feat: add NetworkProvider and useNetworkStatus hook"
```

---

### Task 6: Wire `NetworkProvider` into root layout + migrate FAB undo toast

**Files:**
- Modify: `app/_layout.tsx`
- Modify: `components/QuickCaptureFAB.tsx`

- [ ] **Step 1: Wrap root layout with NetworkProvider**

In `app/_layout.tsx`, add the import and wrap the `<Stack>` with `<NetworkProvider>`:

```typescript
// Add import at top
import { NetworkProvider } from '@/context/NetworkContext';

// In the return statement, wrap Stack:
return (
  <NetworkProvider>
    <Stack screenOptions={{ headerShown: false }}>
      {/* ...existing Stack.Screen entries unchanged... */}
    </Stack>
  </NetworkProvider>
);
```

- [ ] **Step 2: Migrate FAB undo toast to use the new `Toast` component**

In `components/QuickCaptureFAB.tsx`:

1. Remove the local `Toast` component (lines ~429–482, the entire `function Toast(...)` and its `toastStyles`).
2. Add import at top:
   ```typescript
   import Toast from '@/components/ui/Toast';
   ```
3. The existing toast render in the FAB's return (near the bottom) passes `message`, `onUndo`, `onDismiss`. Update it to use the new API:
   ```typescript
   {toastMessage && (
     <Toast
       message={toastMessage}
       position="bottom"
       duration={4000}
       action={lastSaved ? { label: 'Undo', onPress: handleUndo } : undefined}
       onDismiss={() => { setToastMessage(null); setLastSaved(null); }}
     />
   )}
   ```

- [ ] **Step 3: Verify app launches without errors**

Run the app in the dev build and check:
- App launches without crash
- QuickCaptureFAB appears on Trips and Inbox tabs
- A capture action shows the "Saved to X" toast at the bottom as before

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx components/QuickCaptureFAB.tsx
git commit -m "feat: wire NetworkProvider into root layout; migrate FAB toast to shared component"
```

---

## ── PHASE 1: SCREEN INTEGRATION ──

---

### Task 7: Cache write + fallback in `app/(main)/trips.tsx`

**Files:**
- Modify: `app/(main)/trips.tsx`

The existing `fetchTrips` function already handles `setLoading`, `setError`, `setTrips`. We add:
1. Import `useNetworkStatus`, `readTripListCache`, `writeTripListCache`
2. If offline, skip fetch and load from cache
3. On success, write to cache
4. Grey out the Add Trip button when offline

- [ ] **Step 1: Add imports**

At the top of `trips.tsx`, add:
```typescript
import { useNetworkStatus } from '@/context/NetworkContext';
import { readTripListCache, writeTripListCache } from '@/lib/offlineCache';
```

- [ ] **Step 2: Consume network status in the component**

Inside `TripsScreen`, add:
```typescript
const { isOnline, onlineRefreshTrigger, showOfflineToast } = useNetworkStatus();
```

- [ ] **Step 3: Update `fetchTrips` to write cache on success and fallback when offline**

The key change is in the `fetchTrips` function. Replace the error handling and the `setTrips` call:

```typescript
const fetchTrips = useCallback(async () => {
  setLoading(true);
  setError(null);

  // ── Offline fallback ──────────────────────────────────────────────────────
  if (!isOnline) {
    const cached = await readTripListCache<TripSummary[]>();
    if (cached) {
      setTrips(cached);
    } else {
      setError('No saved data available.');
    }
    setLoading(false);
    return;
  }

  // ── Online fetch (existing logic) ─────────────────────────────────────────
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) { setLoading(false); return; }

  // ... (keep all existing query logic unchanged) ...

  const allTrips = [/* existing merge logic */];
  const summaries = allTrips.map(toTripSummary);
  setTrips(summaries);
  setLoading(false);

  // Write to cache in background (fire and forget)
  writeTripListCache(summaries).catch(() => {});
}, [isOnline, onlineRefreshTrigger]); // Add isOnline + onlineRefreshTrigger as deps
```

**Important:** The entire existing query logic remains unchanged. You're only adding the offline early-return block at the top, and the cache write at the bottom. Also add `isOnline` and `onlineRefreshTrigger` to the `useCallback` deps array.

- [ ] **Step 4: Grey out the Add Trip button**

Find the `Pressable` for the add button in the header. Wrap its `onPress`:

```typescript
<Pressable
  style={[styles.addButton, !isOnline && { opacity: 0.4 }]}
  hitSlop={8}
  onPress={() => {
    if (!isOnline) { showOfflineToast(); return; }
    router.push('/create-trip');
  }}
>
```

- [ ] **Step 5: Verify on device**
  - Navigate to Trips tab while online → trips load as before
  - Enable airplane mode, reopen app → trips load from cache
  - Add Trip button is greyed and shows "You're offline" toast

- [ ] **Step 6: Commit**

```bash
git add app/(main)/trips.tsx
git commit -m "feat: offline cache for trips list screen"
```

---

### Task 8: Cache write + fallback in `app/trip-detail.tsx`

**Files:**
- Modify: `app/trip-detail.tsx`

Trip detail is the most important screen to cache — it's the itinerary spine. The `fetchTrip` function fetches from 6+ queries and builds `trip`, `itinerary`, `stopOptions`, `collaboratorProfiles`. We cache and restore all of this as a single JSON blob.

- [ ] **Step 1: Add imports**

```typescript
import { useNetworkStatus } from '@/context/NetworkContext';
import {
  readTripCache,
  writeTripCache,
  updateLastOpenedAt,
} from '@/lib/offlineCache';
import { downloadDocumentsForTrip } from '@/lib/documentCache';
```

- [ ] **Step 2: Add cache data type above the component**

```typescript
// Shape cached to disk for offline restore
interface TripCacheData {
  trip: any; // same shape as the `trip` state (raw Supabase row + sorted stops/legs)
  itinerary: ItineraryItem[]; // same type as the `itinerary` state
  stopOptions: StopOption[];
  collaboratorProfiles: CollaboratorProfile[];
}
```

- [ ] **Step 3: Consume network status**

Inside the `TripDetailScreen` component, add:
```typescript
const { isOnline, onlineRefreshTrigger, showOfflineToast } = useNetworkStatus();
```

- [ ] **Step 4: Update `fetchTrip`**

Add to the `useCallback` deps: `isOnline`, `onlineRefreshTrigger`.

At the **top** of `fetchTrip`, before the existing Supabase call, add the offline block:
```typescript
// ── Offline fallback ─────────────────────────────────────────────────────
if (!isOnline) {
  const cached = await readTripCache<TripCacheData>(tripId);
  if (cached) {
    setTrip(cached.trip);
    setItinerary(cached.itinerary);
    setStopOptions(cached.stopOptions);
    setCollaboratorProfiles(cached.collaboratorProfiles);
  } else {
    setError('No saved data available.');
  }
  setLoading(false);
  return;
}
```

At the **bottom** of `fetchTrip`, after `setLoading(false)` on success, add:
```typescript
// Update last-opened timestamp so cleanup knows this trip is active
updateLastOpenedAt(tripId).catch(() => {});

// Write full trip state to cache for offline use
const stopIds = sortedStops.map((s) => s.id);
writeTripCache(
  tripId,
  {
    trip: { ...raw, stops: sortedStops, legs: sortedLegs },
    itinerary: buildItinerary(sortedStops, sortedLegs, allTransport),
    stopOptions: sortedStops.map((s) => ({ id: s.id, city: s.city, tripName: raw.name ?? '' })),
    collaboratorProfiles: collaboratorProfilesData, // the local var before setCollaboratorProfiles
  } satisfies TripCacheData,
  stopIds,
).catch(() => {});

// Download documents for this trip in the background (Phase 2)
if (isOnline) {
  downloadDocumentsForTrip(tripId, supabase).catch(() => {});
}
```

**Note:** `allTransport` and `collaboratorProfilesData` need to be captured as local variables before they're passed to setState. Check the current code — `setItinerary(buildItinerary(...))` — pull the itinerary value into a local var first, then call both `setItinerary(itinerary)` and include `itinerary` in the cache write.

- [ ] **Step 5: Grey out write actions**

Find all Pressables that trigger mutations (add stop, edit, delete, add leg). For each:
```typescript
onPress={() => {
  if (!isOnline) { showOfflineToast(); return; }
  // existing handler
}}
style={[existingStyle, !isOnline && { opacity: 0.4 }]}
```

Key actions in trip-detail to grey out:
- "Add stop" button
- "Add leg" / "+" between stops
- Edit icon on stop items
- Delete icon on stop items
- The drag-to-reorder handle (disable drag when offline by checking `isOnline` in the `onDragEnd` handler)

- [ ] **Step 6: Verify on device**
  - Open a trip while online → loads and saves to cache
  - Enable airplane mode → reopen trip → cached itinerary loads
  - Greyed-out action buttons show "You're offline" toast

- [ ] **Step 7: Commit**

```bash
git add app/trip-detail.tsx
git commit -m "feat: offline cache + greyed actions for trip detail screen"
```

---

### Task 9: Cache write + fallback in `app/stop-detail.tsx`

**Files:**
- Modify: `app/stop-detail.tsx`

Stop detail is very complex (~1800 lines, many tabs). The strategy: identify the main data-loading function, cache everything it produces, and restore on cache read.

- [ ] **Step 1: Add imports**

```typescript
import { useNetworkStatus } from '@/context/NetworkContext';
import { readStopCache, writeStopCache } from '@/lib/offlineCache';
```

- [ ] **Step 2: Add cache type near the top of the file**

Look at what state variables the main load function populates. The main load function is around line 1184. It sets state for: stop info, accommodation list, transport items, saved places. Add:

```typescript
// Shape cached for offline restore — mirrors the screen's loaded state
interface StopCacheData {
  stop: StopDetail;
  accommodation: any[];       // whatever type the accommodation state uses
  transportItems: any[];      // whatever type the inbound leg/booking state uses
  savedPlaces: SavedPlace[];
  // Add any other state vars the main load function sets
}
```

Inspect the actual state variable types in the file and update accordingly.

- [ ] **Step 3: Consume network status**

```typescript
const { isOnline, onlineRefreshTrigger, showOfflineToast } = useNetworkStatus();
```

- [ ] **Step 4: Find the main useFocusEffect + loadData function (around line 1421)**

Add offline block at the top of the load function, and cache write at the bottom after all state is set.

Offline block (top of load function):
```typescript
if (!isOnline) {
  const cached = await readStopCache<StopCacheData>(stopId);
  if (cached) {
    setStop(cached.stop);
    setAccommodation(cached.accommodation);
    setTransportItems(cached.transportItems);
    setSavedPlaces(cached.savedPlaces);
    // restore any other state vars
  } else {
    setError('No saved data available.');
  }
  setLoading(false);
  return;
}
```

Cache write (bottom, after all setState calls):
```typescript
writeStopCache(stopId, {
  stop: stopData,
  accommodation: accomData,
  transportItems: transportData,
  savedPlaces: placesData,
} satisfies StopCacheData).catch(() => {});
```

Add `isOnline` and `onlineRefreshTrigger` to the `useCallback` deps.

- [ ] **Step 5: Grey out write actions**

Key actions to grey out in stop-detail:
- "Edit stop" button
- "Delete stop" button
- "Add accommodation" button
- "Add transport" button
- "Add place" button
- All edit/delete icons on individual items

Apply the same pattern:
```typescript
onPress={() => {
  if (!isOnline) { showOfflineToast(); return; }
  // existing handler
}}
style={[style, !isOnline && { opacity: 0.4 }]}
```

- [ ] **Step 6: Verify on device**
  - Open a stop while online → loads normally
  - Enable airplane mode → open same stop → cached data loads
  - Write actions greyed out and show "You're offline" toast

- [ ] **Step 7: Commit**

```bash
git add app/stop-detail.tsx
git commit -m "feat: offline cache + greyed actions for stop detail screen"
```

---

### Task 10: Cache fallback in `app/booking-detail.tsx` + greyed-out actions

**Files:**
- Modify: `app/booking-detail.tsx`

Booking detail uses `useEffect` (not `useFocusEffect`) — this is pre-existing, leave it. Use its own cache key `waypoint_cache_booking_{id}` for simplicity (rather than extracting from the trip cache).

- [ ] **Step 1: Add imports**

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetworkStatus } from '@/context/NetworkContext';
```

- [ ] **Step 2: Consume network status**

```typescript
const { isOnline, showOfflineToast } = useNetworkStatus();
```

- [ ] **Step 3: Add a simple inline cache in the load function**

At the start of the `load` async function (inside `useEffect`), add:
```typescript
// Offline fallback — restore from per-record cache
if (!isOnline) {
  try {
    const raw = await AsyncStorage.getItem(`waypoint_cache_booking_${id}`);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached.accommodation) setAccommodation(cached.accommodation);
      if (cached.journeyDetail) setJourneyDetail(cached.journeyDetail);
      if (cached.savedItemTransport) setSavedItemTransport(cached.savedItemTransport);
    } else {
      setError('No saved data available.');
    }
  } catch {
    setError('No saved data available.');
  }
  setLoading(false);
  return;
}
```

At the end of each successful fetch branch (after the final setState call), add a cache write:
```typescript
// Cache for offline — fire and forget
AsyncStorage.setItem(
  `waypoint_cache_booking_${id}`,
  JSON.stringify({ accommodation, journeyDetail, savedItemTransport }),
).catch(() => {});
```

Note: each branch sets a different state var. Write the appropriate shape for each branch.

- [ ] **Step 4: Grey out edit/delete actions**

The screen has Edit and Delete buttons for accommodation and transport records. Apply the offline guard to each:
```typescript
onPress={() => {
  if (!isOnline) { showOfflineToast(); return; }
  // existing handler
}}
style={[style, !isOnline && { opacity: 0.4 }]}
```

- [ ] **Step 5: Commit**

```bash
git add app/booking-detail.tsx
git commit -m "feat: offline cache fallback + greyed actions for booking detail"
```

---

### Task 11: Cache fallback in `app/leg.tsx` + greyed-out actions

**Files:**
- Modify: `app/leg.tsx`

Leg uses `useEffect`. Same pattern as booking-detail. Cache key: `waypoint_cache_leg_{legId}`.

- [ ] **Step 1: Add imports**

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetworkStatus } from '@/context/NetworkContext';
```

- [ ] **Step 2: Consume network status**

```typescript
const { isOnline, showOfflineToast } = useNetworkStatus();
```

- [ ] **Step 3: Add offline fallback in the load function**

Find the `load` async function called by `useEffect`. At the top:
```typescript
if (!isOnline) {
  try {
    const raw = await AsyncStorage.getItem(`waypoint_cache_leg_${legId}`);
    if (raw) {
      const cached = JSON.parse(raw);
      // restore state vars — check what setLeg / setLegBookings etc are called
      setLeg(cached.leg);
      // set other state vars as needed
    } else {
      setError('No saved data available.');
    }
  } catch {
    setError('No saved data available.');
  }
  setLoading(false);
  return;
}
```

At the end of the successful fetch, after setState calls:
```typescript
AsyncStorage.setItem(
  `waypoint_cache_leg_${legId}`,
  JSON.stringify({ leg: legData /* + other state */ }),
).catch(() => {});
```

- [ ] **Step 4: Grey out write actions in leg screen**

Any edit buttons, add booking button etc:
```typescript
onPress={() => {
  if (!isOnline) { showOfflineToast(); return; }
  // existing handler
}}
style={[style, !isOnline && { opacity: 0.4 }]}
```

- [ ] **Step 5: Grey out the QuickCaptureFAB when offline**

In `components/QuickCaptureFAB.tsx`, the FAB `<Pressable>` already has `disabled={parsing}`. Extend:
```typescript
import { useNetworkStatus } from '@/context/NetworkContext';
// in component:
const { isOnline, showOfflineToast } = useNetworkStatus();

// on the FAB Pressable:
<Pressable
  style={[styles.fab, (!isOnline || parsing) && styles.fabPressed, !isOnline && { opacity: 0.4 }]}
  onPress={() => {
    if (!isOnline) { showOfflineToast("You're offline — can't add bookings"); return; }
    handleFABPress();
  }}
  disabled={parsing}
>
```

- [ ] **Step 6: Commit**

```bash
git add app/leg.tsx components/QuickCaptureFAB.tsx
git commit -m "feat: offline cache fallback for leg screen; FAB disabled when offline"
```

---

## ── PHASE 2: DOCUMENT PIPELINE ──

---

### Task 12: Create `lib/documentCache.ts`

This file needs to exist before Phase 2 features are wired up. The `downloadDocumentsForTrip` call in trip-detail.tsx (added in Task 8) will silently no-op until this is implemented — that's fine.

**Files:**
- Create: `lib/documentCache.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/documentCache.ts
//
// Document cache for offline document viewing.
// Downloads documents from Supabase Storage and stores them locally.
//
// Cache map key: waypoint_doc_cache_map
//   Value: { [documentId]: absoluteLocalPath }

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import type { SupabaseClient } from '@supabase/supabase-js';

const DOC_CACHE_MAP_KEY = 'waypoint_doc_cache_map';
const DOC_DIR = FileSystem.documentDirectory + 'waypoint_docs/';

// ─── Types ────────────────────────────────────────────────────────────────────

type DocCacheMap = Record<string, string>; // documentId → local absolute path

// ─── Map helpers ──────────────────────────────────────────────────────────────

async function readMap(): Promise<DocCacheMap> {
  try {
    const raw = await AsyncStorage.getItem(DOC_CACHE_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeMap(map: DocCacheMap): Promise<void> {
  try {
    await AsyncStorage.setItem(DOC_CACHE_MAP_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[documentCache] writeMap failed:', e);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the local file path for a cached document, or null if not cached.
 */
export async function getLocalDocumentPath(documentId: string): Promise<string | null> {
  const map = await readMap();
  const path = map[documentId];
  if (!path) return null;
  // Verify the file still exists (could have been cleared by OS)
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

/**
 * Downloads all documents for a trip that aren't already cached locally.
 * Called from trip-detail.tsx after a successful online fetch (fire and forget).
 */
export async function downloadDocumentsForTrip(
  tripId: string,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    // Ensure the docs directory exists
    const dirInfo = await FileSystem.getInfoAsync(DOC_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(DOC_DIR, { intermediates: true });
    }

    // Fetch all document_links for records belonging to this trip's stops/legs/bookings
    // We query document_files directly by trip_id for simplicity
    const { data: docFiles, error } = await supabase
      .from('document_files')
      .select('id, storage_path, file_type, original_filename')
      .eq('trip_id', tripId);

    if (error || !docFiles || docFiles.length === 0) return;

    const map = await readMap();
    let updated = false;

    for (const doc of docFiles) {
      // Skip if already cached
      if (map[doc.id]) {
        const info = await FileSystem.getInfoAsync(map[doc.id]);
        if (info.exists) continue;
      }

      // Get a signed URL (1 hour expiry — enough for a background download)
      const { data: signedData } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.storage_path, 3600);

      if (!signedData?.signedUrl) continue;

      const localPath = DOC_DIR + `${doc.id}_${doc.original_filename}`;
      try {
        await FileSystem.downloadAsync(signedData.signedUrl, localPath);
        map[doc.id] = localPath;
        updated = true;
      } catch (downloadErr) {
        console.warn(`[documentCache] Failed to download ${doc.id}:`, downloadErr);
      }
    }

    if (updated) await writeMap(map);
  } catch (e) {
    console.warn('[documentCache] downloadDocumentsForTrip failed:', e);
  }
}

/**
 * Downloads a single document on demand (used in booking-detail "View original" flow).
 * Returns the local path on success, or null on failure.
 */
export async function downloadDocumentOnDemand(
  documentId: string,
  storagePath: string,
  originalFilename: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(DOC_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(DOC_DIR, { intermediates: true });
    }

    const { data: signedData } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 3600);

    if (!signedData?.signedUrl) return null;

    const localPath = DOC_DIR + `${documentId}_${originalFilename}`;
    await FileSystem.downloadAsync(signedData.signedUrl, localPath);

    const map = await readMap();
    map[documentId] = localPath;
    await writeMap(map);

    return localPath;
  } catch (e) {
    console.warn('[documentCache] downloadDocumentOnDemand failed:', e);
    return null;
  }
}

/**
 * Deletes locally cached documents for a set of expired trip IDs.
 * Called from runCacheCleanup() in lib/offlineCache.ts.
 */
export async function cleanupDocumentCache(expiredTripIds: string[]): Promise<void> {
  if (expiredTripIds.length === 0) return;
  try {
    // We need to know which document IDs belong to each expired trip.
    // The map stores documentId → localPath. We can only clean up files we
    // know about. Query is not available here (no supabase instance), so we
    // delete all files in the DOC_DIR that belong to IDs listed in the map
    // that no longer have an associated cached trip.
    //
    // Simpler approach: run a full map cleanup — if the local file still exists
    // for any doc that is linked to an expired trip, delete it.
    // Since we don't have supabase here, we'll just scan all files and remove
    // map entries where the source trip is expired.
    //
    // In practice, this is called with expiredTripIds from offlineCache cleanup.
    // We trust that if a trip is expired, all its docs can be removed.
    // We iterate the map and delete files where the docId starts with a known
    // expiredTripId prefix — but we don't store tripId in the map.
    //
    // Practical resolution: store a separate trip→docIds index in AsyncStorage.
    // For now, skip cleanup of individual files and just log. A full cleanup
    // can be done by clearing DOC_DIR entirely when ALL trips are expired.
    //
    // TODO: Add trip→docIds index to enable per-trip cleanup.
    console.log('[documentCache] cleanupDocumentCache called for trips:', expiredTripIds);
  } catch (e) {
    console.warn('[documentCache] cleanupDocumentCache failed:', e);
  }
}
```

**Note on cleanup:** The per-trip document cleanup requires a `tripId → [documentId]` index that we don't currently have. The TODO comment in the code acknowledges this. For Phase 1 launch, document cleanup is a no-op (documents accumulate until OS clears the cache directory). A follow-up can add the index. This does not affect any user-facing functionality.

- [ ] **Step 2: Update `lib/offlineCache.ts` to call `cleanupDocumentCache`**

In `runCacheCleanup()`, after computing `expiredTripIds` and before returning:
```typescript
// Import at top of offlineCache.ts:
import { cleanupDocumentCache } from '@/lib/documentCache';

// In runCacheCleanup(), after the AsyncStorage.multiRemove call:
cleanupDocumentCache(expiredTripIds).catch(() => {});
```

- [ ] **Step 3: Commit**

```bash
git add lib/documentCache.ts lib/offlineCache.ts
git commit -m "feat: add documentCache utility (download, lookup, cleanup stubs)"
```

---

### Task 13: Supabase migration — `document_files` + `document_links` tables

**Files:**
- Create: `supabase/migrations/010_document_storage.sql`

- [ ] **Step 1: Check the current migration count to confirm the sequence number**

```bash
ls supabase/migrations/
```

Use the next available number (010 if 009 is the last, etc.).

- [ ] **Step 2: Write the migration file**

```sql
-- supabase/migrations/010_document_storage.sql
-- Document storage pipeline: stores original booking/accommodation source files
-- in Supabase Storage and links them to their parsed records.

-- ─── document_files ───────────────────────────────────────────────────────────

create table public.document_files (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users not null,
  trip_id           uuid references public.trips on delete cascade,  -- nullable for inbox documents
  storage_path      text not null,
  file_type         text not null check (file_type in ('pdf', 'jpg', 'png')),
  original_filename text not null,
  file_size_bytes   integer,
  created_at        timestamptz default now() not null
);

alter table public.document_files enable row level security;

-- Users can read documents for trips they are members of, or their own inbox docs
create policy "document_files: members can read"
  on public.document_files for select
  using (
    (trip_id is null and user_id = auth.uid())
    or is_trip_member(trip_id)
  );

-- Users can insert their own documents
create policy "document_files: authenticated can insert"
  on public.document_files for insert
  with check (user_id = auth.uid());

-- Users can delete their own documents
create policy "document_files: owner can delete"
  on public.document_files for delete
  using (user_id = auth.uid());

-- ─── document_links ───────────────────────────────────────────────────────────

create table public.document_links (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid references public.document_files on delete cascade not null,
  linkable_type  text not null check (linkable_type in ('leg_booking', 'accommodation', 'saved_place')),
  linkable_id    uuid not null,
  created_at     timestamptz default now() not null,
  unique (document_id, linkable_type, linkable_id)
);

alter table public.document_links enable row level security;

-- Inherit access from parent document_files via EXISTS subquery
create policy "document_links: members can read"
  on public.document_links for select
  using (
    exists (
      select 1 from public.document_files df
      where df.id = document_links.document_id
        and (
          (df.trip_id is null and df.user_id = auth.uid())
          or is_trip_member(df.trip_id)
        )
    )
  );

create policy "document_links: authenticated can insert"
  on public.document_links for insert
  with check (
    exists (
      select 1 from public.document_files df
      where df.id = document_links.document_id
        and df.user_id = auth.uid()
    )
  );

create policy "document_links: owner can delete"
  on public.document_links for delete
  using (
    exists (
      select 1 from public.document_files df
      where df.id = document_links.document_id
        and df.user_id = auth.uid()
    )
  );
```

- [ ] **Step 3: Apply the migration via Supabase MCP**

Use the Supabase MCP tool `mcp__supabase__apply_migration` with the SQL above, or paste it into the Supabase SQL Editor.

- [ ] **Step 4: Create the `documents` storage bucket**

In the Supabase dashboard → Storage → New bucket:
- Name: `documents`
- Public: **No** (private)

Then add storage policies via SQL Editor:
```sql
-- Allow authenticated users to upload to their own prefix
create policy "storage: users can upload own docs"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to read files they own (by user_id path prefix) or that belong to
-- a trip they are a member of. We join through document_files using storage_path.
create policy "storage: members can read docs"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and auth.role() = 'authenticated'
    and (
      -- User owns the file (first path segment is their user_id)
      auth.uid()::text = (storage.foldername(name))[1]
      -- Or the file is linked to a trip they are a member of
      or exists (
        select 1 from public.document_files df
        where df.storage_path = storage.objects.name
          and is_trip_member(df.trip_id)
      )
    )
  );

-- Allow users to delete their own files
create policy "storage: users can delete own docs"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
```

- [ ] **Step 5: Verify tables exist**

```sql
select table_name from information_schema.tables
where table_schema = 'public'
and table_name in ('document_files', 'document_links');
```

Expected: 2 rows returned.

- [ ] **Step 6: Commit migration file**

```bash
git add supabase/migrations/010_document_storage.sql
git commit -m "feat: add document_files and document_links tables with RLS"
```

---

### Task 14: Modify `QuickCaptureFAB.tsx` — document upload pipeline

The goal is: after `saveBooking()` succeeds, upload the source file to Supabase Storage in the background, then insert rows in `document_files` and `document_links`.

**Files:**
- Modify: `components/QuickCaptureFAB.tsx`

- [ ] **Step 1: Add `sourceFileUri` and `sourceMediaType` state**

Inside `QuickCaptureFAB`, add two new state variables:
```typescript
const [sourceFileUri, setSourceFileUri] = useState<string | null>(null);
const [sourceMediaType, setSourceMediaType] = useState<string | null>(null);
```

- [ ] **Step 2: Set these state vars in each pick/capture handler**

In `handleUploadFile`, after `const asset = result.assets[0]`:
```typescript
setSourceFileUri(asset.uri);
setSourceMediaType(rawMediaType); // before any manipulation
```

In `handleTakePhoto` and `handleChoosePhoto`, same pattern after getting `asset.uri`.

- [ ] **Step 3: Clear source state on discard**

In the `onDiscard` handler passed to `BookingPreviewSheet`:
```typescript
onDiscard={() => {
  setPreviewVisible(false);
  setParsedBooking(null);
  setSourceFileUri(null);      // add these two
  setSourceMediaType(null);
}}
```

- [ ] **Step 4: Create a `uploadSourceDocument` helper function inside the component**

```typescript
async function uploadSourceDocument(
  savedRecord: SavedRecord,
  fileUri: string,
  mimeType: string,
  tripId: string | null,
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const userId = session.user.id;

    // Get file info for size check
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSizeBytes = (fileInfo as any).size ?? 0;
    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    if (fileSizeBytes > MAX_SIZE) {
      console.warn('[uploadSourceDocument] File too large, skipping upload:', fileSizeBytes);
      return;
    }

    // Derive filename and file_type
    const ext = mimeType === 'application/pdf' ? 'pdf'
      : mimeType === 'image/jpeg' ? 'jpg'
      : 'png';
    const originalFilename = `booking_${Date.now()}.${ext}`;
    const uuid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const tripSegment = tripId ?? 'inbox';
    const storagePath = `${userId}/${tripSegment}/${uuid}_${originalFilename}`;

    // Upload file as blob via fetch
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, blob, { contentType: mimeType });

    if (uploadError) {
      console.warn('[uploadSourceDocument] Upload failed:', uploadError.message);
      return;
    }

    // Insert document_files row
    const { data: docFile, error: docFileError } = await supabase
      .from('document_files')
      .insert({
        user_id: userId,
        trip_id: tripId ?? null,
        storage_path: storagePath,
        file_type: ext,
        original_filename: originalFilename,
        file_size_bytes: fileSizeBytes,
      })
      .select('id')
      .single();

    if (docFileError || !docFile) {
      console.warn('[uploadSourceDocument] document_files insert failed:', docFileError?.message);
      return;
    }

    // Determine linkable_type from the saved record's table
    const linkableType =
      savedRecord.table === 'accommodation' ? 'accommodation'
      : savedRecord.table === 'leg_bookings' ? 'leg_booking'
      : 'saved_place'; // fallback for saved_items

    // Insert document_links row
    await supabase.from('document_links').insert({
      document_id: (docFile as any).id,
      linkable_type: linkableType,
      linkable_id: savedRecord.id,
    });
  } catch (e) {
    console.warn('[uploadSourceDocument] Unexpected error:', e);
  }
}
```

**Note:** Import `FileSystem` at the top: `import * as FileSystem from 'expo-file-system';`

- [ ] **Step 5: Trigger the background upload after successful saves**

Find the three places where a `SavedRecord` is obtained and a toast is shown:

**Auto-save path** (in `handleParsed`, after `const record = await saveBooking(...)`):
```typescript
if (record) {
  setLastSaved(record);
  // Background document upload
  if (sourceFileUri && sourceMediaType) {
    const tripId = stop?.tripId ?? null; // get tripId from matched stop if available
    uploadSourceDocument(record, sourceFileUri, sourceMediaType, tripId).catch(() => {});
    setSourceFileUri(null);
    setSourceMediaType(null);
  }
}
```

**Manual save path** (in `handleManualSave`, after the `saveBooking` call):
```typescript
// Background document upload
if (sourceFileUri && sourceMediaType) {
  const tripId = savedGap?.tripId ?? null;
  uploadSourceDocument(savedRecord, sourceFileUri, sourceMediaType, tripId).catch(() => {});
  setSourceFileUri(null);
  setSourceMediaType(null);
}
```

**Journey/connection paths** (in `handleStartConnection` and `handleAddNextLeg`): Apply same pattern after the journey is created.

- [ ] **Step 6: Verify document upload works end to end**

Test manually:
1. Use QuickCaptureFAB to upload a PDF
2. Confirm and save the booking
3. Open Supabase Table Editor → `document_files` → verify a row exists
4. Open Supabase Table Editor → `document_links` → verify a row exists
5. Open Supabase Storage → `documents` bucket → verify the file exists

- [ ] **Step 7: Commit**

```bash
git add components/QuickCaptureFAB.tsx
git commit -m "feat: background document upload to Supabase Storage after booking save"
```

---

### Task 15: Install `react-native-file-viewer` + rebuild dev build

`react-native-file-viewer` is a native module. It must be installed and the dev build rebuilt before the "View original" feature can be tested.

**Files:** `package.json`

- [ ] **Step 1: Install**

```bash
cd /Users/peterlancashire/waypoint
npm install react-native-file-viewer --legacy-peer-deps
```

- [ ] **Step 2: Verify install**

```bash
grep "react-native-file-viewer" package.json
```

- [ ] **Step 3: Rebuild the iOS dev build**

```bash
npx expo run:ios
```

Wait for the build to complete and the app to launch on the connected device. This is required because `react-native-file-viewer` includes native Swift/ObjC code that must be compiled.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-native-file-viewer for iOS Quick Look"
```

---

### Task 16: Add "View original" to `app/booking-detail.tsx`

**Files:**
- Modify: `app/booking-detail.tsx`

- [ ] **Step 1: Add imports**

```typescript
import FileViewer from 'react-native-file-viewer';
import {
  getLocalDocumentPath,
  downloadDocumentOnDemand,
} from '@/lib/documentCache';
```

- [ ] **Step 2: Add state for the linked document**

Inside the `BookingDetailScreen` component:
```typescript
interface LinkedDocument {
  id: string;
  storage_path: string;
  original_filename: string;
  file_type: string;
}
const [linkedDoc, setLinkedDoc] = useState<LinkedDocument | null>(null);
const [loadingDoc, setLoadingDoc] = useState(false);
```

- [ ] **Step 3: Query `document_links` after the main record loads**

At the end of the existing `load` function (inside `useEffect`), after the successful setState calls, add:
```typescript
// Query for an attached source document
const linkableType = type === 'accommodation' ? 'accommodation' : 'leg_booking';
const { data: linkRows } = await supabase
  .from('document_links')
  .select('document_id')
  .eq('linkable_type', linkableType)
  .eq('linkable_id', id)
  .limit(1);

if (linkRows && linkRows.length > 0) {
  const docId = (linkRows[0] as any).document_id;
  const { data: docFile } = await supabase
    .from('document_files')
    .select('id, storage_path, original_filename, file_type')
    .eq('id', docId)
    .single();
  if (docFile) setLinkedDoc(docFile as LinkedDocument);
}
```

- [ ] **Step 4: Create the `handleViewOriginal` function**

```typescript
async function handleViewOriginal() {
  if (!linkedDoc) return;
  setLoadingDoc(true);
  try {
    // 1. Check local cache first
    let localPath = await getLocalDocumentPath(linkedDoc.id);

    // 2. If not cached and online, download now
    if (!localPath && isOnline) {
      localPath = await downloadDocumentOnDemand(
        linkedDoc.id,
        linkedDoc.storage_path,
        linkedDoc.original_filename,
        supabase,
      );
    }

    if (!localPath) {
      showOfflineToast('Document not available offline');
      return;
    }

    await FileViewer.open(localPath, { showOpenWithDialog: false });
  } catch (e) {
    console.warn('[booking-detail] handleViewOriginal error:', e);
  } finally {
    setLoadingDoc(false);
  }
}
```

- [ ] **Step 5: Render the "View original" row**

Find a good place in the existing JSX — near the bottom of the content, below all the booking fields. Add conditionally:
```typescript
{linkedDoc && (
  <Pressable
    style={({ pressed }) => [styles.viewOriginalRow, pressed && { opacity: 0.7 }]}
    onPress={handleViewOriginal}
    disabled={loadingDoc}
  >
    <Feather name="file-text" size={18} color={colors.primary} />
    <Text style={styles.viewOriginalLabel}>
      {loadingDoc ? 'Opening…' : 'View original'}
    </Text>
    <Feather name="chevron-right" size={16} color={colors.border} />
  </Pressable>
)}
```

Add the corresponding styles:
```typescript
viewOriginalRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  paddingVertical: 16,
  paddingHorizontal: 20,
  borderTopWidth: 1,
  borderTopColor: colors.border,
},
viewOriginalLabel: {
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 15,
  color: colors.primary,
},
```

- [ ] **Step 6: Verify end to end**

1. Upload a PDF via QuickCaptureFAB and save a booking
2. Open that booking in booking-detail → "View original" row appears
3. Tap it → document opens in iOS Quick Look (full-screen, pinch-to-zoom)
4. Open a booking that has no document → no "View original" row

- [ ] **Step 7: Test offline document view**

1. Open a trip that has documents while online (triggers background download from Task 8)
2. Enable airplane mode
3. Open booking-detail → tap "View original" → document opens from local cache
4. Find a document that was NOT pre-downloaded → tap "View original" → "Document not available offline" toast

- [ ] **Step 8: Commit**

```bash
git add app/booking-detail.tsx
git commit -m "feat: View original document button in booking detail with Quick Look"
```

---

## Final verification checklist

- [ ] Phase 1: trips, trip-detail, stop-detail, booking-detail, leg all show cached data in airplane mode
- [ ] Phase 1: "You're offline — showing saved data" toast appears once per session, not on every screen
- [ ] Phase 1: Thin offline banner visible below status bar on all screens while offline
- [ ] Phase 1: All write actions greyed (opacity 0.4) and show "You're offline" toast
- [ ] Phase 1: "Back online" toast + automatic data refresh when connectivity restored
- [ ] Phase 2: Supabase `document_files` and `document_links` rows created after save
- [ ] Phase 2: File visible in Supabase Storage `documents` bucket
- [ ] Phase 2: "View original" button appears on bookings with attached documents only
- [ ] Phase 2: Quick Look opens correctly from both online (download-on-demand) and cached paths
- [ ] Phase 2: "Document not available offline" shown when document is not cached and device is offline

---

## Files created / modified (summary)

**Created:**
- `context/NetworkContext.tsx`
- `lib/offlineCache.ts`
- `lib/documentCache.ts`
- `components/ui/Toast.tsx`
- `components/ui/OfflineBanner.tsx`
- `supabase/migrations/010_document_storage.sql`

**Modified:**
- `app/_layout.tsx`
- `app/(main)/trips.tsx`
- `app/trip-detail.tsx`
- `app/stop-detail.tsx`
- `app/booking-detail.tsx`
- `app/leg.tsx`
- `components/QuickCaptureFAB.tsx`
