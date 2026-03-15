import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { ParsedBooking } from '@/lib/claude';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cityMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return x.includes(y) || y.includes(x);
}

// ─── Duplicate check ──────────────────────────────────────────────────────────

/**
 * Returns a human-readable reason string if a duplicate is found, or null if
 * the booking appears to be new. Checks (in order):
 *   1. Booking reference match (any type)
 *   2. Operator + origin/destination + departure date (transport)
 *   3. Property name + check-in date (accommodation)
 */
export async function checkDuplicate(
  booking: ParsedBooking,
  userId: string,
): Promise<string | null> {
  if (booking.type === 'accommodation') {
    // 1. Booking ref
    if (booking.booking_ref) {
      const { data } = await supabase
        .from('accommodation')
        .select('id')
        .eq('owner_id', userId)
        .eq('confirmation_ref', booking.booking_ref)
        .limit(1);
      if (data?.length) {
        return `A booking with reference ${booking.booking_ref} already exists in this trip.`;
      }
    }
    // 2. Property name + check-in date
    if (booking.hotel_name && booking.check_in_date) {
      const { data } = await supabase
        .from('accommodation')
        .select('id')
        .eq('owner_id', userId)
        .ilike('name', booking.hotel_name)
        .eq('check_in_date', booking.check_in_date)
        .limit(1);
      if (data?.length) {
        return `${booking.hotel_name} checking in on ${booking.check_in_date} is already saved.`;
      }
    }
    return null;
  }

  if (booking.type === 'transport') {
    // 1a. Booking ref — check leg_bookings
    if (booking.booking_ref) {
      const { data: lb } = await supabase
        .from('leg_bookings')
        .select('id')
        .eq('owner_id', userId)
        .eq('confirmation_ref', booking.booking_ref)
        .limit(1);
      if (lb?.length) {
        return `A booking with reference ${booking.booking_ref} already exists in this trip.`;
      }
    }

    // Fetch all user transport saved_items once (used for ref + route checks)
    const { data: si } = await supabase
      .from('saved_items')
      .select('note')
      .eq('creator_id', userId)
      .eq('category', 'Transport')
      .limit(100);
    const transportNotes = (si ?? []).map((item: any) => {
      try { return JSON.parse(item.note ?? '{}'); } catch { return {}; }
    });

    // 1b. Booking ref — check saved_items note JSON
    if (booking.booking_ref) {
      const refMatch = transportNotes.find((n: any) => n.booking_ref === booking.booking_ref);
      if (refMatch) {
        return `A booking with reference ${booking.booking_ref} already exists in this trip.`;
      }
    }

    // 2. Route + date: cities + departure date + (operator OR service_number).
    // Only run when departure_date is a valid calendar date — service numbers
    // are reused daily so route alone without a date is not reliable.
    // We gate on *either* operator or service_number so manual entries that
    // only supply a flight/train number (no operator name) are still caught.
    const departureDateValid =
      !!booking.departure_date && !isNaN(new Date(booking.departure_date).getTime());
    const hasIdentifier = !!(booking.operator || booking.service_number);
    if (departureDateValid && hasIdentifier && booking.origin_city && booking.destination_city) {
      const routeMatch = transportNotes.find((n: any) => {
        if (!cityMatches(booking.origin_city, n.origin_city)) return false;
        if (!cityMatches(booking.destination_city, n.destination_city)) return false;
        if (n.departure_date !== booking.departure_date) return false;
        // At least one identifier must match
        const operatorMatch =
          !!booking.operator && !!n.operator &&
          n.operator.toLowerCase() === booking.operator.toLowerCase();
        const serviceMatch =
          !!booking.service_number && !!n.service_number &&
          n.service_number.toLowerCase() === booking.service_number.toLowerCase();
        return operatorMatch || serviceMatch;
      });
      if (routeMatch) {
        const label = booking.service_number ?? booking.operator;
        return `${label} from ${booking.origin_city} to ${booking.destination_city} on ${booking.departure_date} is already saved.`;
      }
    }
    return null;
  }

  if (booking.type === 'connection') {
    // Check the shared booking_ref against leg_bookings
    if (booking.booking_ref) {
      const { data: lb } = await supabase
        .from('leg_bookings')
        .select('id')
        .eq('owner_id', userId)
        .eq('confirmation_ref', booking.booking_ref)
        .limit(1);
      if (lb?.length) {
        return `A booking with reference ${booking.booking_ref} already exists in this trip.`;
      }
    }
    return null;
  }

  return null;
}

// ─── Confirm prompt ───────────────────────────────────────────────────────────

/** Promisified Alert asking the user whether to save despite a detected duplicate. */
export function confirmDuplicate(reason: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "This booking looks like it's already saved",
      reason,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Add anyway', onPress: () => resolve(true) },
      ],
    );
  });
}
