import { File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { PlaceCategory } from './placesEnrichment';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransportType = 'flight' | 'train' | 'bus' | 'ferry';

export interface TransportBooking {
  type: 'transport';
  transport_type: TransportType;
  operator: string;               // airline, rail company, bus co, ferry operator
  service_number: string;         // flight #, train #, route #, etc.
  origin_city: string;
  destination_city: string;
  departure_date: string;         // YYYY-MM-DD
  departure_time: string;         // HH:MM
  arrival_date: string;
  arrival_time: string;
  booking_ref: string;
  seat: string | null;
  // Flight
  gate: string | null;
  terminal: string | null;
  // Train
  coach: string | null;
  platform: string | null;
  origin_station: string | null;
  destination_station: string | null;
  // Bus
  pickup_point: string | null;
  dropoff_point: string | null;
  // Ferry
  deck: string | null;
  cabin: string | null;
  port_terminal: string | null;
}

export type AccommodationType = 'airbnb' | 'booking_com' | 'hotels_com' | 'hostel' | 'hotel';

export interface AccommodationBooking {
  type: 'accommodation';
  accommodation_type: AccommodationType;
  hotel_name: string;
  address: string | null;         // full street address
  city: string;
  check_in_date: string;          // YYYY-MM-DD
  check_out_date: string;
  check_in_time: string | null;   // HH:MM (24h), e.g. "14:00"
  check_out_time: string | null;  // HH:MM (24h), e.g. "11:00"
  booking_ref: string;
  nights: number | null;
  wifi_name: string | null;
  wifi_password: string | null;
  // Provider-specific fields
  host_name: string | null;            // Airbnb: host name
  access_code: string | null;          // Airbnb: lockbox / door access code
  checkin_instructions: string | null; // Airbnb: free-text check-in notes
  room_type: string | null;            // Hotels / hostels: room type description
  checkin_hours: string | null;        // Hostels: reception check-in hours
}

export interface OtherBooking {
  type: 'other';
  description: string;
  city: string | null;
  date: string | null;
}

/** One leg within a connection/layover booking. Shares all transport fields. */
export interface ConnectionLeg {
  transport_type: TransportType;
  operator: string;
  service_number: string;
  origin_city: string;
  destination_city: string;
  departure_date: string;         // YYYY-MM-DD
  departure_time: string;         // HH:MM
  arrival_date: string;
  arrival_time: string;
  seat: string | null;
  gate: string | null;
  terminal: string | null;
  coach: string | null;
  platform: string | null;
  origin_station: string | null;
  destination_station: string | null;
  pickup_point: string | null;
  dropoff_point: string | null;
  deck: string | null;
  cabin: string | null;
  port_terminal: string | null;
  leg_order: number;
}

/** Multi-leg journey sharing a single booking reference (e.g. a flight with a layover). */
export interface ConnectionBooking {
  type: 'connection';
  is_connection: true;
  booking_ref: string | null;
  legs: ConnectionLeg[];
}

export type ParsedBooking = TransportBooking | AccommodationBooking | OtherBooking | ConnectionBooking;

// Keep the old name exported so any remaining references don't break at runtime
export type FlightBooking = TransportBooking;

/** A place recommendation extracted from a screenshot, photo, or social post. */
export interface PlaceResult {
  type: 'place';
  /** content_type discriminator — always "place" for this shape. */
  content_type: 'place';
  name: string;
  category: PlaceCategory;
  city: string | null;
  /** Any description, review snippet, or details visible in the image. */
  note: string | null;
}

/**
 * Union of everything the AI parser may return.
 * Check `parsed.type === 'place'` to branch into the place-saving flow;
 * all other type values are booking confirmations.
 */
export type ParsedContent = ParsedBooking | PlaceResult;

// ─── Media type helpers ───────────────────────────────────────────────────────

export type BookingMediaType = 'application/pdf' | 'image/jpeg' | 'image/png';

export function mediaTypeFromUri(uri: string, mimeType?: string | null): BookingMediaType {
  if (mimeType === 'image/png') return 'image/png';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'image/jpeg';
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/pdf';
}

// ─── File reading ─────────────────────────────────────────────────────────────
// The iOS simulator can return security-scoped URIs from the document picker
// that expo-file-system cannot open directly. Copying to cache first resolves this.

export async function readUriAsBase64(uri: string): Promise<string> {
  const ext = uri.split('.').pop()?.toLowerCase() ?? 'tmp';
  const cached = new File(Paths.cache, `booking_${Date.now()}.${ext}`);
  new File(uri).copy(cached);
  try {
    return await cached.base64();
  } finally {
    cached.delete();
  }
}

// ─── Image resize ─────────────────────────────────────────────────────────────

const IMAGE_RESIZE_THRESHOLD = 4 * 1024 * 1024; // 4 MB — resize anything larger
const IMAGE_MAX_WIDTH = 1500;
const IMAGE_COMPRESS_QUALITY = 0.7;

/**
 * Checks the byte size of a local image URI via fetch. If it exceeds
 * IMAGE_RESIZE_THRESHOLD (4 MB), resizes it to max 1500px wide at JPEG 0.7
 * using expo-image-manipulator and returns the new URI + updated media type.
 * Returns the original URI unchanged for PDFs or images already under the limit.
 */
async function maybeShrinkImage(
  uri: string,
  mediaType: BookingMediaType,
): Promise<{ uri: string; mediaType: BookingMediaType }> {
  if (mediaType === 'application/pdf') return { uri, mediaType };

  try {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    if (blob.size <= IMAGE_RESIZE_THRESHOLD) return { uri, mediaType };
  } catch {
    // Can't determine size — proceed without resizing rather than failing.
    return { uri, mediaType };
  }

  const result = await manipulateAsync(
    uri,
    [{ resize: { width: IMAGE_MAX_WIDTH } }],
    { compress: IMAGE_COMPRESS_QUALITY, format: SaveFormat.JPEG },
  );
  return { uri: result.uri, mediaType: 'image/jpeg' };
}

/**
 * Convenience: resize the image if needed, then read as base64.
 * Use this instead of the `readUriAsBase64` + manual mediaType pair at every call site.
 */
export async function readAndPrepareBase64(
  uri: string,
  mediaType: BookingMediaType,
): Promise<{ base64: string; mediaType: BookingMediaType }> {
  const { uri: finalUri, mediaType: finalMediaType } = await maybeShrinkImage(uri, mediaType);
  const base64 = await readUriAsBase64(finalUri);
  return { base64, mediaType: finalMediaType };
}

// ─── API call ─────────────────────────────────────────────────────────────────

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';

const SYSTEM_PROMPT = `You are a travel document and place parser. Given a PDF or image, first decide whether it is:

A) A booking confirmation (flight, train, bus, ferry, accommodation)
B) A place recommendation (restaurant, bar, café, museum, attraction, shop, activity, etc.)
   — this includes screenshots from Google Maps, Instagram, TikTok, TripAdvisor, travel blogs,
     and photos of restaurants, venues, or signs.

Return ONLY valid JSON (no markdown, no explanation).

━━━ PLACE RECOMMENDATION ━━━

If the image/document shows a place recommendation, return:
{"content_type":"place","type":"place","name":"...","category":"Restaurants","city":"...","note":"..."}

category must be exactly one of: "Restaurants", "Bars", "Museums", "Activities", "Sights", "Shopping", "Other"
- "Restaurants" — restaurant, café, bakery, food stall, takeaway
- "Bars" — bar, pub, cocktail lounge, nightclub, wine bar
- "Museums" — museum, gallery, exhibition space
- "Activities" — tour, experience, sport, theme park, spa, cooking class, boat trip
- "Sights" — landmark, monument, church, temple, viewpoint, historic site, nature spot
- "Shopping" — shop, market, boutique, mall, souvenir store
- "Other" — anything else

name = the venue name (extract from text, logo, or map pin — even a partial name is useful)
city = city where the place is located (null if not visible)
note = any description, review snippet, cuisine type, price range, opening hours, or tips visible in the image (null if nothing useful)

If the image is a photo of food or a building with minimal identifying text, still try to extract whatever is visible. A partial name is better than nothing.

━━━ BOOKING CONFIRMATION ━━━

For booking confirmations, always include "content_type":"booking" alongside the existing "type" field.

Single transport booking:
{"content_type":"booking","type":"transport","transport_type":"flight","operator":"...","service_number":"...","origin_city":"...","destination_city":"...","departure_date":"YYYY-MM-DD","departure_time":"HH:MM","arrival_date":"YYYY-MM-DD","arrival_time":"HH:MM","booking_ref":"...","seat":null,"gate":null,"terminal":null,"coach":null,"platform":null,"origin_station":null,"destination_station":null,"pickup_point":null,"dropoff_point":null,"deck":null,"cabin":null,"port_terminal":null}

Connection/layover booking (two or more legs on one itinerary):
{"content_type":"booking","type":"connection","is_connection":true,"booking_ref":"...","legs":[{"transport_type":"flight","operator":"...","service_number":"...","origin_city":"...","destination_city":"...","departure_date":"YYYY-MM-DD","departure_time":"HH:MM","arrival_date":"YYYY-MM-DD","arrival_time":"HH:MM","seat":null,"gate":null,"terminal":null,"coach":null,"platform":null,"origin_station":null,"destination_station":null,"pickup_point":null,"dropoff_point":null,"deck":null,"cabin":null,"port_terminal":null,"leg_order":1},{"leg_order":2,...}]}

Use the connection format when the document shows a multi-leg journey with a layover or connection. leg_order starts at 1.

Detect transport_type from context clues:
- "flight": airline name, boarding pass, airport, gate, terminal, IATA flight number (e.g. BA123, TG661)
- "train": railway, rail, train number, coach/carriage, platform, station name
- "bus": bus, coach, National Express, FlixBus, Megabus, pickup point, dropoff point
- "ferry": ferry, ship, vessel, port, deck, cabin, crossing, nautical

operator = company name (e.g. "Thai Airways", "Eurostar", "FlixBus", "Brittany Ferries")
service_number = the service identifier (flight number, train number, route number)
origin_city / destination_city = city names only, not airport/station codes
Populate only the fields relevant to the detected transport type; set irrelevant fields to null.

Accommodation booking:
{"content_type":"booking","type":"accommodation","accommodation_type":"hotel","hotel_name":"...","address":"full street address or null","city":"...","check_in_date":"YYYY-MM-DD","check_out_date":"YYYY-MM-DD","check_in_time":"HH:MM or null","check_out_time":"HH:MM or null","booking_ref":"...","nights":null,"wifi_name":null,"wifi_password":null,"host_name":null,"access_code":null,"checkin_instructions":null,"room_type":null,"checkin_hours":null}

accommodation_type: identify the provider using the rules below. Check each in order and use the first match.

"booking_com" — Booking.com logo/name present, or booking.com domain in email/text.
"hotels_com"  — Hotels.com logo/name present, or hotels.com domain in email/text.
"hostel"      — classify as hostel if ANY of these are present: "Hostelworld" branding or hostelworld.com domain; "HostelBookers"; the word "hostel" in the property name or document; "dorm", "dormitory", "bed in dorm", "mixed dorm", "female dorm", "male dorm"; "reception hours", "reception open", "check-in hours". Do NOT require multiple signals — one strong signal is enough.
"airbnb"      — score these signals, classify as "airbnb" if 2 or more are present:
  (1) "airbnb" appears anywhere in text, header, or branding
  (2) "airbnb.com" in any URL or email address
  (3) "Hosted by [name]", "Your Host", or "Meet your host" with a person's name
  (4) "Superhost" label or badge
  (5) "House Rules" section
  (6) Self check-in instructions: lockbox code, keypad code, key safe, smart lock, or access code for entering the property
  (7) "Message your host", "Contact your host", or "Message [name]"
  (8) Residential property name style: e.g. "Sunny Apartment", "Cosy Studio", "Bright Flat", "Room in [house]", "Entire home", "Private room in [house]" — as opposed to "Grand Hotel", "Marriott", "Hilton", etc.
  This also covers Vrbo, HomeAway, and any vacation rental with a host + self check-in.
"hotel"       — default: direct hotel email, unrecognised provider, or anything that doesn't match the above.

host_name: for Airbnb, the host's name (e.g. "Maria"). Null for all other types.
access_code: the primary door, lockbox, or key-safe code for getting into the property (e.g. "3847", "B2C9#"). Scan the entire document including check-in instructions — Airbnb often puts it in a "How to get in" or "Key access" section. If multiple codes exist (e.g. building code + lockbox code), prefer the lockbox/property entry code. Null if none found.
checkin_instructions: the full free-text check-in notes (e.g. "Key is under the mat", "Use the side entrance, ring bell 3, lockbox code is 1926"). Copy the complete instruction text. Null if not present.
room_type: the room/bed type string (e.g. "Deluxe Double Room", "Standard Twin", "6-bed mixed dorm", "Private room"). Null if not present.
checkin_hours: reception or check-in window (e.g. "8am–10pm", "14:00–22:00", "24-hour reception"). Null if not present.

address = full street address (e.g. "Cankarjevo Nabrezje 27, Ljubljana, Slovenia"). Set to null only if absent.
check_in_time / check_out_time = 24h HH:MM. Convert 12h AM/PM. Null if not shown.
wifi_name / wifi_password = Wi-Fi credentials if present. Null if not shown.
Handle confirmations written in any language (English, Spanish, French, Italian, German, Portuguese, etc.).

Other document (booking-like but unrecognised):
{"content_type":"booking","type":"other","description":"...","city":null,"date":null}

Use null for any field you cannot determine.`;

export async function parseBookingFile(
  base64: string,
  mediaType: BookingMediaType,
): Promise<ParsedContent> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key is not configured.');

  console.log('[claude] parseBookingFile called — mediaType:', mediaType, 'base64 length:', base64.length);

  const fileContent =
    mediaType === 'application/pdf'
      ? {
          type: 'document' as const,
          source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaType as 'image/jpeg' | 'image/png',
            data: base64,
          },
        };

  console.log('[claude] sending as content type:', fileContent.type);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            fileContent,
            { type: 'text', text: 'Extract the booking details from this document.' },
          ],
        },
      ],
    }),
  });

  console.log('[claude] API response status:', response.status);

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.error('[claude] API error body:', JSON.stringify(err));
    throw new Error((err as any)?.error?.message ?? `API error ${response.status}`);
  }

  const data = await response.json();
  const text: string = (data as any).content?.[0]?.text ?? '';
  console.log('[claude] raw response text:', text);

  try {
    const raw = JSON.parse(text);

    // Array response → normalise to ConnectionBooking (legacy model behaviour)
    if (Array.isArray(raw)) {
      const firstBookingRef = (raw[0] as any)?.booking_ref ?? null;
      const legs: ConnectionLeg[] = raw.map((item: any, i: number) => ({
        ...item,
        leg_order: item.leg_order ?? i + 1,
      }));
      return {
        content_type: 'booking',
        type: 'connection',
        is_connection: true,
        booking_ref: firstBookingRef,
        legs,
      } as ConnectionBooking & { content_type: 'booking' };
    }

    // Place recommendation — pass through directly
    if (raw.type === 'place') {
      return raw as PlaceResult;
    }

    // All other shapes are booking confirmations
    return raw as ParsedBooking;
  } catch {
    throw new Error('Could not parse booking details from this document.');
  }
}

// Alias so any remaining parsePdfBooking call sites still compile
export const parsePdfBooking = (base64: string) =>
  parseBookingFile(base64, 'application/pdf');
