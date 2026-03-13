import * as FileSystem from 'expo-file-system';

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
  // Ferry
  deck: string | null;
  cabin: string | null;
  port_terminal: string | null;
}

export interface AccommodationBooking {
  type: 'accommodation';
  hotel_name: string;
  city: string;
  check_in_date: string;          // YYYY-MM-DD
  check_out_date: string;
  booking_ref: string;
  nights: number | null;
}

export interface OtherBooking {
  type: 'other';
  description: string;
  city: string | null;
  date: string | null;
}

export type ParsedBooking = TransportBooking | AccommodationBooking | OtherBooking;

// Keep the old name exported so any remaining references don't break at runtime
export type FlightBooking = TransportBooking;

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
  const cacheUri = `${FileSystem.cacheDirectory}booking_${Date.now()}.${ext}`;
  await FileSystem.copyAsync({ from: uri, to: cacheUri });
  try {
    return await FileSystem.readAsStringAsync(cacheUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } finally {
    FileSystem.deleteAsync(cacheUri, { idempotent: true });
  }
}

// ─── API call ─────────────────────────────────────────────────────────────────

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';

const SYSTEM_PROMPT = `You are a travel booking parser. Extract structured data from booking confirmation documents (PDFs or images).

Return ONLY valid JSON (no markdown, no explanation) in one of these exact formats:

Transport booking:
{"type":"transport","transport_type":"flight","operator":"...","service_number":"...","origin_city":"...","destination_city":"...","departure_date":"YYYY-MM-DD","departure_time":"HH:MM","arrival_date":"YYYY-MM-DD","arrival_time":"HH:MM","booking_ref":"...","seat":null,"gate":null,"terminal":null,"coach":null,"platform":null,"origin_station":null,"destination_station":null,"pickup_point":null,"deck":null,"cabin":null,"port_terminal":null}

Detect transport_type from context clues:
- "flight": airline name, boarding pass, airport, gate, terminal, IATA flight number (e.g. BA123, TG661)
- "train": railway, rail, train number, coach/carriage, platform, station name
- "bus": bus, coach, National Express, FlixBus, Megabus, pickup point
- "ferry": ferry, ship, vessel, port, deck, cabin, crossing, nautical

operator = company name (e.g. "Thai Airways", "Eurostar", "FlixBus", "Brittany Ferries")
service_number = the service identifier (flight number, train number, route number)
origin_city / destination_city = city names only, not airport/station codes
Populate only the fields relevant to the detected type; set irrelevant fields to null.

Accommodation booking:
{"type":"accommodation","hotel_name":"...","city":"...","check_in_date":"YYYY-MM-DD","check_out_date":"YYYY-MM-DD","booking_ref":"...","nights":null}

Other document:
{"type":"other","description":"...","city":null,"date":null}

Use null for any field you cannot determine.`;

export async function parseBookingFile(
  base64: string,
  mediaType: BookingMediaType,
): Promise<ParsedBooking> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key is not configured.');

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

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `API error ${response.status}`);
  }

  const data = await response.json();
  const text: string = (data as any).content?.[0]?.text ?? '';

  try {
    return JSON.parse(text) as ParsedBooking;
  } catch {
    throw new Error('Could not parse booking details from this document.');
  }
}

// Alias so any remaining parsePdfBooking call sites still compile
export const parsePdfBooking = (base64: string) =>
  parseBookingFile(base64, 'application/pdf');
