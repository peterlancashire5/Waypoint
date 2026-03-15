// ─── Place Categories ─────────────────────────────────────────────────────────

export type PlaceCategory =
  | 'Restaurants'
  | 'Bars'
  | 'Museums'
  | 'Activities'
  | 'Sights'
  | 'Shopping'
  | 'Other';

// ─── Result shape ─────────────────────────────────────────────────────────────

export interface EnrichedPlace {
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  category: PlaceCategory;
}

// ─── Google Places (New) API types ────────────────────────────────────────────

interface GPlaceDisplayName {
  text: string;
  languageCode: string;
}

interface GPlaceAddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

interface GPlace {
  id: string;
  displayName: GPlaceDisplayName;
  formattedAddress: string | null;
  addressComponents: GPlaceAddressComponent[];
  location: { latitude: number; longitude: number } | null;
  types: string[];
}

interface GTextSearchResponse {
  places: GPlace[];
}

// ─── Category mapping ─────────────────────────────────────────────────────────

// Maps from Google Places type strings to our seven categories.
// We check the types array in order — first match wins.
const TYPE_MAP: Array<{ patterns: string[]; category: PlaceCategory }> = [
  {
    patterns: ['restaurant', 'food', 'cafe', 'bakery', 'meal_takeaway', 'meal_delivery', 'coffee_shop'],
    category: 'Restaurants',
  },
  {
    patterns: ['bar', 'night_club', 'liquor_store', 'wine_bar', 'pub'],
    category: 'Bars',
  },
  {
    patterns: ['museum', 'art_gallery'],
    category: 'Museums',
  },
  {
    patterns: [
      'amusement_park', 'aquarium', 'bowling_alley', 'casino',
      'gym', 'movie_theater', 'spa', 'stadium', 'zoo',
      'tourist_attraction', 'park', 'natural_feature',
      'campground', 'rv_park',
    ],
    category: 'Activities',
  },
  {
    patterns: [
      'church', 'hindu_temple', 'mosque', 'synagogue', 'place_of_worship',
      'cemetery', 'city_hall', 'courthouse', 'embassy',
      'local_government_office', 'monument', 'historical_landmark',
      'cultural_landmark',
    ],
    category: 'Sights',
  },
  {
    patterns: [
      'clothing_store', 'department_store', 'electronics_store',
      'furniture_store', 'jewelry_store', 'shoe_store', 'shopping_mall',
      'store', 'supermarket', 'book_store', 'convenience_store',
      'gift_shop',
    ],
    category: 'Shopping',
  },
];

export function mapGoogleTypeToCategory(types: string[]): PlaceCategory {
  for (const { patterns, category } of TYPE_MAP) {
    if (types.some((t) => patterns.includes(t))) return category;
  }
  return 'Other';
}

// ─── City extraction from address components ──────────────────────────────────

function extractCity(components: GPlaceAddressComponent[]): string | null {
  // Prefer locality, fall back to sublocality or administrative_area_level_1
  const priority = ['locality', 'sublocality', 'administrative_area_level_2', 'administrative_area_level_1'];
  for (const type of priority) {
    const comp = components.find((c) => c.types.includes(type));
    if (comp) return comp.longText;
  }
  return null;
}

// ─── Main enrichment function ─────────────────────────────────────────────────

/**
 * Takes the AI-extracted place name (and optional city) and queries the
 * Google Places Text Search (New) API to get a confirmed name, address,
 * coordinates, and category.
 *
 * Uses only Essentials-tier fields to minimise cost.
 * Falls back gracefully if the API returns no results or errors.
 */
export async function enrichPlace(
  name: string,
  city?: string | null,
  fallbackCategory?: PlaceCategory,
): Promise<EnrichedPlace> {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

  const fallback: EnrichedPlace = {
    name,
    address: null,
    city: city ?? null,
    latitude: null,
    longitude: null,
    google_place_id: null,
    category: fallbackCategory ?? 'Other',
  };

  if (!apiKey) {
    console.warn('[placesEnrichment] EXPO_PUBLIC_GOOGLE_PLACES_API_KEY is not set');
    return fallback;
  }

  const query = city ? `${name}, ${city}` : name;

  // Essentials-tier field mask — keeps us in the cheapest pricing bucket.
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.addressComponents',
    'places.location',
    'places.types',
  ].join(',');

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'en',
          maxResultCount: 1,
        }),
      },
    );

    if (!response.ok) {
      console.warn(`[placesEnrichment] Text Search failed: ${response.status}`);
      return fallback;
    }

    const data: GTextSearchResponse = await response.json();
    const place = data.places?.[0];

    if (!place) {
      // No results — fall back to AI-extracted data
      return fallback;
    }

    return {
      name: place.displayName?.text ?? name,
      address: place.formattedAddress ?? null,
      city: extractCity(place.addressComponents ?? []) ?? city ?? null,
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      google_place_id: place.id ?? null,
      category: mapGoogleTypeToCategory(place.types ?? []),
    };
  } catch (err) {
    console.warn('[placesEnrichment] Enrichment error:', err);
    return fallback;
  }
}
