// lib/documentCache.ts
//
// Document cache for offline document viewing.
// Downloads documents from Supabase Storage and stores them locally.
//
// Cache map key: waypoint_doc_cache_map
//   Value: { [documentId]: absoluteLocalPath }

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';
import type { SupabaseClient } from '@supabase/supabase-js';

const DOC_CACHE_MAP_KEY = 'waypoint_doc_cache_map';

// ─── Types ────────────────────────────────────────────────────────────────────

type DocCacheMap = Record<string, string>; // documentId → local absolute path

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the waypoint_docs Directory, creating it if it doesn't exist yet.
 * Directory.create() and Directory.exists are synchronous in the new API.
 */
function ensureDocDir(): Directory {
  const dir = new Directory(Paths.document, 'waypoint_docs');
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

/**
 * Downloads a signed URL to a local File and returns the File.
 * Logs diagnostics so empty-body or error responses are immediately visible.
 * Uses fetch → arrayBuffer → file.write() rather than File.downloadFileAsync
 * because Supabase signed URLs can involve redirects that downloadFileAsync
 * doesn't handle reliably, resulting in zero-byte files.
 */
async function fetchAndWrite(signedUrl: string, localFile: File): Promise<void> {
  const response = await fetch(signedUrl);
  console.log('[documentCache] download response:', response.status, response.statusText);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  console.log('[documentCache] bytes received:', bytes.byteLength);

  if (bytes.byteLength === 0) {
    throw new Error('Server returned an empty body');
  }

  // write() creates the file if it does not exist, or overwrites it.
  localFile.write(bytes);
}

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
  // Verify the file still exists (could have been cleared by OS).
  // File.exists is a synchronous boolean property in the new API.
  return new File(path).exists ? path : null;
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
    const docDir = ensureDocDir();

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
      if (map[doc.id] && new File(map[doc.id]).exists) continue;

      // Get a signed URL (1 hour expiry — enough for a background download)
      const { data: signedData } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.storage_path, 3600);

      if (!signedData?.signedUrl) continue;

      try {
        // Name the local file with the correct extension so file viewers
        // (Quick Look, etc.) can open it without a "no app" error.
        const localFile = new File(docDir, `${doc.id}.${doc.file_type}`);
        await fetchAndWrite(signedData.signedUrl, localFile);
        map[doc.id] = localFile.uri;
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
    const docDir = ensureDocDir();

    const { data: signedData } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 3600);

    if (!signedData?.signedUrl) {
      console.error('[documentCache] createSignedUrl returned no URL for path:', storagePath);
      return null;
    }

    console.log('[documentCache] signed URL generated for:', storagePath);

    // Derive extension from the storage path (e.g. 'userId/uuid.pdf' → 'pdf').
    // This ensures Quick Look receives a file with the correct extension.
    const ext = storagePath.split('.').pop() ?? 'pdf';
    const localFile = new File(docDir, `${documentId}.${ext}`);

    await fetchAndWrite(signedData.signedUrl, localFile);

    const map = await readMap();
    map[documentId] = localFile.uri;
    await writeMap(map);

    return localFile.uri;
  } catch (e) {
    console.error('[documentCache] downloadDocumentOnDemand failed:', e);
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
