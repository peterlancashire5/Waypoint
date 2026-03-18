// lib/offlineCache.ts
//
// AsyncStorage cache for offline itinerary data.
// Metadata key: waypoint_cache_meta
//   Value: { [tripId]: { lastOpenedAt: string; stopIds: string[] } }
// Trip cache:  waypoint_cache_trip_{tripId}
// Stop cache:  waypoint_cache_stop_{stopId}
// Trip list:   waypoint_cache_trip_list

import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanupDocumentCache } from '@/lib/documentCache';

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

    cleanupDocumentCache(expiredTripIds).catch(() => {});

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
