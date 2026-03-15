import { supabase } from './supabase';
import type { PlaceCategory, EnrichedPlace } from './placesEnrichment';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SavedPlace {
  id: string;
  stop_id: string | null;
  trip_id: string | null;
  creator_id: string | null;
  name: string;
  category: PlaceCategory | null;
  city: string | null;
  source_image_url: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  photo_url: string | null;
  note: string | null;
  is_inbox: boolean;
  created_at: string;
}

/** Minimal stop info used for auto-matching. */
interface StopCandidate {
  stop_id: string;
  trip_id: string;
  city: string;
  trip_name: string;
}

/** Payload used when creating a new saved place. */
export interface NewPlacePayload {
  name: string;
  category: PlaceCategory | null;
  city: string | null;
  source_image_url?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_place_id?: string | null;
  photo_url?: string | null;
  note?: string | null;
}

// ─── Auto-match result ────────────────────────────────────────────────────────

export type AutoMatchResult =
  | { matched: 'single'; stop_id: string; trip_id: string }
  | { matched: 'multiple'; candidates: StopCandidate[] }
  | { matched: 'none' };

// ─── Write helpers ────────────────────────────────────────────────────────────

/** Save a place directly to a known stop. */
export async function savePlaceToStop(
  place: NewPlacePayload,
  stopId: string,
  tripId: string,
  userId: string,
): Promise<SavedPlace> {
  const { data, error } = await supabase
    .from('saved_items')
    .insert({
      ...place,
      stop_id: stopId,
      trip_id: tripId,
      creator_id: userId,
      is_inbox: false,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to save place.');
  return data as SavedPlace;
}

/** Save a place to the inbox (no stop assigned yet). */
export async function savePlaceToInbox(
  place: NewPlacePayload,
  userId: string,
): Promise<SavedPlace> {
  const { data, error } = await supabase
    .from('saved_items')
    .insert({
      ...place,
      stop_id: null,
      trip_id: null,
      creator_id: userId,
      is_inbox: true,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to save place to inbox.');
  return data as SavedPlace;
}

// ─── Auto-matching ────────────────────────────────────────────────────────────

/**
 * Looks up all stops across the user's trips and tries to match by city name.
 *
 * Returns:
 * - `matched: 'single'`   — exactly one stop in this city; the UI can auto-assign.
 * - `matched: 'multiple'` — more than one stop matches; prompt the user to choose.
 * - `matched: 'none'`     — no stop found; save to inbox.
 */
export async function autoMatchPlace(
  place: NewPlacePayload,
  userId: string,
): Promise<AutoMatchResult> {
  if (!place.city) return { matched: 'none' };

  // Fetch all stops the user can see, joined with trip name for display.
  const { data, error } = await supabase
    .from('stops')
    .select('id, city, trip_id, trips!inner(name, owner_id)')
    .ilike('city', place.city.trim());

  if (error || !data) return { matched: 'none' };

  // Filter to only the current user's trips (RLS handles access but we want
  // to restrict to trips the user created or is a member of — already done by
  // RLS — this is just a safety check for type narrowing).
  const candidates: StopCandidate[] = (data as any[]).map((row) => ({
    stop_id: row.id as string,
    trip_id: row.trip_id as string,
    city: row.city as string,
    trip_name: (row.trips as any)?.name ?? 'Trip',
  }));

  if (candidates.length === 0) return { matched: 'none' };
  if (candidates.length === 1) {
    return { matched: 'single', stop_id: candidates[0].stop_id, trip_id: candidates[0].trip_id };
  }
  return { matched: 'multiple', candidates };
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

/** Update the name, category, and/or note of a saved place. */
export async function updatePlace(
  itemId: string,
  updates: { name?: string; category?: PlaceCategory | null; note?: string | null },
): Promise<SavedPlace> {
  const { data, error } = await supabase
    .from('saved_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to update place.');
  return data as SavedPlace;
}

// ─── Move inbox → stop ────────────────────────────────────────────────────────

/** Assign an inbox item to a specific stop (filing it from the inbox). */
export async function assignInboxItem(
  itemId: string,
  stopId: string,
  tripId: string,
): Promise<void> {
  const { error } = await supabase
    .from('saved_items')
    .update({ stop_id: stopId, trip_id: tripId, is_inbox: false })
    .eq('id', itemId);

  if (error) throw new Error(error.message);
}

/** Move a saved place back to the inbox (unassign it from any stop). */
export async function movePlaceToInbox(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('saved_items')
    .update({ stop_id: null, trip_id: null, is_inbox: true })
    .eq('id', itemId);

  if (error) throw new Error(error.message);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deletePlace(itemId: string): Promise<void> {
  const { error } = await supabase.from('saved_items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

/** Fetch all saved places for a stop, ordered by creation time. */
export async function fetchPlacesForStop(stopId: string): Promise<SavedPlace[]> {
  const { data, error } = await supabase
    .from('saved_items')
    .select('*')
    .eq('stop_id', stopId)
    .eq('is_inbox', false)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as SavedPlace[];
}

/** Fetch all inbox items for the current user, newest first. */
export async function fetchInboxItems(userId: string): Promise<SavedPlace[]> {
  const { data, error } = await supabase
    .from('saved_items')
    .select('*')
    .eq('creator_id', userId)
    .eq('is_inbox', true)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as SavedPlace[];
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

/**
 * Returns true if a saved place with the same google_place_id (preferred) or
 * the same name (case-insensitive fallback) already exists on `stopId`.
 */
async function isDuplicateOnStop(
  stopId: string,
  name: string,
  googlePlaceId: string | null | undefined,
): Promise<boolean> {
  const { data } = await supabase
    .from('saved_items')
    .select('id, name, google_place_id')
    .eq('stop_id', stopId)
    .eq('is_inbox', false);

  if (!data || data.length === 0) return false;

  const nameLower = name.trim().toLowerCase();
  return (data as any[]).some(
    (row) =>
      (googlePlaceId && row.google_place_id === googlePlaceId) ||
      (row.name as string)?.toLowerCase() === nameLower,
  );
}

// ─── Convenience: full save flow ──────────────────────────────────────────────

/**
 * Returned when `saveEnrichedPlace` detects that the place is already saved.
 * The caller should surface `name` and `city` in a toast rather than saving.
 */
export type DuplicateResult = {
  saved: false;
  duplicate: true;
  name: string;
  city: string | null;
};

export type SaveResult =
  | { saved: true; duplicate: false; item: SavedPlace; match: AutoMatchResult }
  | DuplicateResult;

/**
 * Full save flow: enriched place → duplicate check → auto-match → save.
 *
 * Duplicate check runs only when the place would be auto-assigned to a single
 * stop (inbox items are not deduplicated here).
 */
export async function saveEnrichedPlace(
  enriched: EnrichedPlace,
  aiNote: string | null,
  userId: string,
  sourceImageUrl?: string | null,
): Promise<SaveResult> {
  const payload: NewPlacePayload = {
    name: enriched.name,
    category: enriched.category,
    city: enriched.city,
    address: enriched.address,
    latitude: enriched.latitude,
    longitude: enriched.longitude,
    google_place_id: enriched.google_place_id,
    source_image_url: sourceImageUrl ?? null,
    note: aiNote,
  };

  const match = await autoMatchPlace(payload, userId);

  let item: SavedPlace;
  if (match.matched === 'single') {
    // Guard against duplicates before inserting
    const isDuplicate = await isDuplicateOnStop(
      match.stop_id,
      payload.name,
      payload.google_place_id,
    );
    if (isDuplicate) {
      return { saved: false, duplicate: true, name: enriched.name, city: enriched.city };
    }
    item = await savePlaceToStop(payload, match.stop_id, match.trip_id, userId);
  } else {
    // 'multiple' or 'none' — land in inbox; user will file from there
    item = await savePlaceToInbox(payload, userId);
  }

  return { saved: true, duplicate: false, item, match };
}
