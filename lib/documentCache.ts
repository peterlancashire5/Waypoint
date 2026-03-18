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

    // Fetch all document_files for this trip
    const { data: docFiles, error } = await supabase
      .from('document_files')
      .select('id, storage_path, file_type, original_filename')
      .eq('trip_id', tripId);

    if (error || !docFiles || docFiles.length === 0) return;

    const map = await readMap();
    let updated = false;

    for (const doc of docFiles) {
      // Skip if already cached and file still exists
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
 *
 * TODO: Add trip→docIds index to enable per-trip cleanup. Currently a no-op
 * because the doc cache map stores documentId→localPath but not which tripId
 * owns each document.
 */
export async function cleanupDocumentCache(expiredTripIds: string[]): Promise<void> {
  if (expiredTripIds.length === 0) return;
  try {
    console.log('[documentCache] cleanupDocumentCache called for trips:', expiredTripIds);
  } catch (e) {
    console.warn('[documentCache] cleanupDocumentCache failed:', e);
  }
}
