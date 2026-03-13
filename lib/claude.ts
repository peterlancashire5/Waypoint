import * as FileSystem from 'expo-file-system';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FlightBooking {
  type: 'flight';
  airline: string;
  flight_number: string;
  origin_city: string;
  destination_city: string;
  departure_date: string;   // YYYY-MM-DD
  departure_time: string;   // HH:MM
  arrival_date: string;
  arrival_time: string;
  booking_ref: string;
  seat: string | null;
}

export interface AccommodationBooking {
  type: 'accommodation';
  hotel_name: string;
  city: string;
  check_in_date: string;    // YYYY-MM-DD
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

export type ParsedBooking = FlightBooking | AccommodationBooking | OtherBooking;

// ─── File reading ─────────────────────────────────────────────────────────────
// The iOS simulator can return security-scoped URIs from the document picker
// that expo-file-system cannot open directly. Copying to cache first resolves this.

export async function readUriAsBase64(uri: string): Promise<string> {
  const cacheUri = `${FileSystem.cacheDirectory}booking_${Date.now()}.pdf`;
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

const SYSTEM_PROMPT = `You are a travel booking parser. Extract structured data from booking confirmation PDFs.

Return ONLY valid JSON (no markdown, no explanation) in one of these exact formats:

Flight booking:
{"type":"flight","airline":"...","flight_number":"...","origin_city":"...","destination_city":"...","departure_date":"YYYY-MM-DD","departure_time":"HH:MM","arrival_date":"YYYY-MM-DD","arrival_time":"HH:MM","booking_ref":"...","seat":null}

Accommodation booking:
{"type":"accommodation","hotel_name":"...","city":"...","check_in_date":"YYYY-MM-DD","check_out_date":"YYYY-MM-DD","booking_ref":"...","nights":null}

Other document:
{"type":"other","description":"...","city":null,"date":null}

Use null for any field you cannot determine. city should be just the city name, not a country or airport code.`;

export async function parsePdfBooking(base64: string): Promise<ParsedBooking> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key is not configured.');

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
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            {
              type: 'text',
              text: 'Extract the booking details from this document.',
            },
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
