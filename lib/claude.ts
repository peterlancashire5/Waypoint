import { File, Paths } from 'expo-file-system';

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

export interface AccommodationBooking {
  type: 'accommodation';
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

// ─── API call ─────────────────────────────────────────────────────────────────

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';

const SYSTEM_PROMPT = `You are a travel booking parser. Extract structured data from booking confirmation documents (PDFs or images).

Return ONLY valid JSON (no markdown, no explanation) in one of these exact formats:

Single transport booking:
{"type":"transport","transport_type":"flight","operator":"...","service_number":"...","origin_city":"...","destination_city":"...","departure_date":"YYYY-MM-DD","departure_time":"HH:MM","arrival_date":"YYYY-MM-DD","arrival_time":"HH:MM","booking_ref":"...","seat":null,"gate":null,"terminal":null,"coach":null,"platform":null,"origin_station":null,"destination_station":null,"pickup_point":null,"dropoff_point":null,"deck":null,"cabin":null,"port_terminal":null}

Connection/layover booking (two or more legs on one itinerary):
{"type":"connection","is_connection":true,"booking_ref":"...","legs":[{"transport_type":"flight","operator":"...","service_number":"...","origin_city":"...","destination_city":"...","departure_date":"YYYY-MM-DD","departure_time":"HH:MM","arrival_date":"YYYY-MM-DD","arrival_time":"HH:MM","seat":null,"gate":null,"terminal":null,"coach":null,"platform":null,"origin_station":null,"destination_station":null,"pickup_point":null,"dropoff_point":null,"deck":null,"cabin":null,"port_terminal":null,"leg_order":1},{"leg_order":2,...}]}

Use the connection format when the document shows a multi-leg journey with a layover or connection — e.g. LHR→FRA→BKK on one booking, or a train journey with a required change. Each leg gets its own origin/destination, service number, and times. leg_order starts at 1.

Detect transport_type from context clues:
- "flight": airline name, boarding pass, airport, gate, terminal, IATA flight number (e.g. BA123, TG661)
- "train": railway, rail, train number, coach/carriage, platform, station name
- "bus": bus, coach, National Express, FlixBus, Megabus, pickup point, dropoff point
- "ferry": ferry, ship, vessel, port, deck, cabin, crossing, nautical

operator = company name (e.g. "Thai Airways", "Eurostar", "FlixBus", "Brittany Ferries")
service_number = the service identifier (flight number, train number, route number)
origin_city / destination_city = city names only, not airport/station codes
pickup_point / dropoff_point = bus boarding and alighting locations (stop name, address, or terminal)
origin_station / destination_station = train station names (e.g. "London St Pancras", "Paris Gare du Nord")
platform = train platform number; coach = train coach/carriage number
gate / terminal = flight gate and terminal identifiers
deck / cabin / port_terminal = ferry-specific details
Populate only the fields relevant to the detected type; set irrelevant fields to null.

Accommodation booking:
{"type":"accommodation","hotel_name":"...","address":"full street address or null","city":"...","check_in_date":"YYYY-MM-DD","check_out_date":"YYYY-MM-DD","check_in_time":"HH:MM or null","check_out_time":"HH:MM or null","booking_ref":"...","nights":null,"wifi_name":null,"wifi_password":null}

address = full street address of the property (e.g. "Cankarjevo Nabrezje 27, Ljubljana, Slovenia"). Include street, number, and city/country if present. Set to null only if no address appears in the document.
check_in_time / check_out_time = time of day in 24h HH:MM format (e.g. "14:00" for 2:00 PM, "11:00" for 11:00 AM). Convert 12h AM/PM to 24h. Set to null if not shown in the document.
wifi_name / wifi_password = Wi-Fi credentials if present in the document (some Airbnb and hotel confirmations include these). Set to null if not shown.

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
    const raw = JSON.parse(text);

    // Array response → normalise to ConnectionBooking
    if (Array.isArray(raw)) {
      const firstBookingRef = (raw[0] as any)?.booking_ref ?? null;
      const legs: ConnectionLeg[] = raw.map((item: any, i: number) => ({
        ...item,
        leg_order: item.leg_order ?? i + 1,
      }));
      return {
        type: 'connection',
        is_connection: true,
        booking_ref: firstBookingRef,
        legs,
      } as ConnectionBooking;
    }

    return raw as ParsedBooking;
  } catch {
    throw new Error('Could not parse booking details from this document.');
  }
}

// Alias so any remaining parsePdfBooking call sites still compile
export const parsePdfBooking = (base64: string) =>
  parseBookingFile(base64, 'application/pdf');
