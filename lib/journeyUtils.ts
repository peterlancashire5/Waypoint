import { supabase } from '@/lib/supabase';
import type { TransportBooking, ConnectionLeg } from '@/lib/claude';

/** Extracts transport-type-specific fields into an extra_data object for storage. */
export function buildExtraData(
  b: Pick<TransportBooking | ConnectionLeg,
    'gate' | 'terminal' | 'coach' | 'platform' | 'origin_station' | 'destination_station' |
    'pickup_point' | 'dropoff_point' | 'deck' | 'cabin' | 'port_terminal'>
): Record<string, string | null> | null {
  const data: Record<string, string | null> = {
    gate: b.gate ?? null,
    terminal: b.terminal ?? null,
    coach: b.coach ?? null,
    platform: b.platform ?? null,
    origin_station: b.origin_station ?? null,
    destination_station: b.destination_station ?? null,
    pickup_point: b.pickup_point ?? null,
    dropoff_point: b.dropoff_point ?? null,
    deck: b.deck ?? null,
    cabin: b.cabin ?? null,
    port_terminal: b.port_terminal ?? null,
  };
  // Only store if at least one field is non-null
  const hasData = Object.values(data).some((v) => v !== null);
  return hasData ? data : null;
}

/**
 * Creates a journey record and a leg_booking record in sequence.
 *
 * All new transport saves go through this function so that every leg_booking
 * is associated with a journey from the moment of creation.
 *
 * @returns The created leg_booking's id.
 */
export async function createTransportBooking(params: {
  tripId: string;
  legId: string;
  originCity: string;
  destinationCity: string;
  userId: string;
  operator: string | null;
  serviceNumber: string | null;
  seat: string | null;
  confirmationRef: string | null;
  departureDate?: string | null;
  departureTime?: string | null;
  arrivalDate?: string | null;
  arrivalTime?: string | null;
  extraData?: Record<string, string | null>;
}): Promise<string> {
  // 1. Create the journey
  const { data: journey, error: journeyErr } = await supabase
    .from('journeys')
    .insert({
      trip_id: params.tripId,
      leg_id: params.legId,
      origin_city: params.originCity,
      destination_city: params.destinationCity,
      is_complete: true,
    })
    .select('id')
    .single();
  if (journeyErr || !journey) {
    throw new Error(journeyErr?.message ?? 'Could not create journey');
  }

  // 2. Create the leg_booking linked to the journey
  const { data: lb, error: lbErr } = await supabase
    .from('leg_bookings')
    .insert({
      leg_id: params.legId,
      journey_id: (journey as any).id,
      owner_id: params.userId,
      origin_city: params.originCity,
      destination_city: params.destinationCity,
      operator: params.operator,
      reference: params.serviceNumber,
      seat: params.seat,
      confirmation_ref: params.confirmationRef,
      leg_order: 1,
      departure_date: params.departureDate ?? null,
      departure_time: params.departureTime ?? null,
      arrival_date: params.arrivalDate ?? null,
      arrival_time: params.arrivalTime ?? null,
      extra_data: params.extraData ? params.extraData : null,
    })
    .select('id')
    .single();
  if (lbErr || !lb) {
    throw new Error(lbErr?.message ?? 'Could not save booking');
  }

  return (lb as any).id;
}

/**
 * Creates a journey and multiple leg_bookings for a connection/layover itinerary.
 * All leg_bookings share the same journey_id.
 *
 * @returns The created journey's id.
 */
export async function saveConnectionBooking(params: {
  tripId: string;
  legId: string;
  originCity: string;       // first leg's origin
  destinationCity: string;  // last leg's destination
  userId: string;
  confirmationRef: string | null;
  legs: Array<{
    originCity: string;
    destinationCity: string;
    operator: string | null;
    serviceNumber: string | null;
    seat: string | null;
    legOrder: number;
    departureDate?: string | null;
    departureTime?: string | null;
    arrivalDate?: string | null;
    arrivalTime?: string | null;
    extraData?: Record<string, string | null>;
  }>;
}): Promise<string> {
  // 1. Create the journey
  const { data: journey, error: journeyErr } = await supabase
    .from('journeys')
    .insert({
      trip_id: params.tripId,
      leg_id: params.legId,
      origin_city: params.originCity,
      destination_city: params.destinationCity,
      is_complete: true,
    })
    .select('id')
    .single();
  if (journeyErr || !journey) {
    throw new Error(journeyErr?.message ?? 'Could not create journey');
  }
  const journeyId = (journey as any).id as string;

  // 2. Create one leg_booking per connection leg
  for (const leg of params.legs) {
    const { error: lbErr } = await supabase.from('leg_bookings').insert({
      leg_id: params.legId,
      journey_id: journeyId,
      owner_id: params.userId,
      origin_city: leg.originCity,
      destination_city: leg.destinationCity,
      operator: leg.operator,
      reference: leg.serviceNumber,
      seat: leg.seat,
      confirmation_ref: params.confirmationRef,
      leg_order: leg.legOrder,
      departure_date: leg.departureDate ?? null,
      departure_time: leg.departureTime ?? null,
      arrival_date: leg.arrivalDate ?? null,
      arrival_time: leg.arrivalTime ?? null,
      extra_data: leg.extraData ?? null,
    });
    if (lbErr) {
      // Roll back the journey since not all legs could be saved
      await supabase.from('journeys').delete().eq('id', journeyId);
      throw new Error(`Could not save leg ${leg.legOrder}: ${lbErr.message}`);
    }
  }

  return journeyId;
}

/**
 * Creates an incomplete journey (is_complete = false) with a single first leg.
 * Used when a transport booking's destination doesn't match the next stop —
 * the user confirms it's the first segment of a connection.
 *
 * @returns The created journey's id.
 */
export async function startIncompleteJourney(params: {
  tripId: string;
  legId: string;
  /** The full journey's intended start city (e.g. Nice). */
  journeyOriginCity: string;
  /** The full journey's intended end city (e.g. Rome). */
  journeyDestinationCity: string;
  /** This leg's actual origin (same as journeyOriginCity for leg 1). */
  legOriginCity: string;
  /** This leg's actual destination (e.g. Milan — the layover city). */
  legDestinationCity: string;
  userId: string;
  operator: string | null;
  serviceNumber: string | null;
  seat: string | null;
  confirmationRef: string | null;
  departureDate?: string | null;
  departureTime?: string | null;
  arrivalDate?: string | null;
  arrivalTime?: string | null;
  extraData?: Record<string, string | null>;
}): Promise<string> {
  const { data: journey, error: journeyErr } = await supabase
    .from('journeys')
    .insert({
      trip_id: params.tripId,
      leg_id: params.legId,
      origin_city: params.journeyOriginCity,
      destination_city: params.journeyDestinationCity,
      is_complete: false,
    })
    .select('id')
    .single();
  if (journeyErr || !journey) {
    throw new Error(journeyErr?.message ?? 'Could not create journey');
  }
  const journeyId = (journey as any).id as string;

  const { error: lbErr } = await supabase.from('leg_bookings').insert({
    journey_id: journeyId,
    leg_id: params.legId,
    owner_id: params.userId,
    origin_city: params.legOriginCity,
    destination_city: params.legDestinationCity,
    operator: params.operator,
    reference: params.serviceNumber,
    seat: params.seat,
    confirmation_ref: params.confirmationRef,
    leg_order: 1,
    departure_date: params.departureDate ?? null,
    departure_time: params.departureTime ?? null,
    arrival_date: params.arrivalDate ?? null,
    arrival_time: params.arrivalTime ?? null,
    extra_data: params.extraData ?? null,
  });
  if (lbErr) {
    await supabase.from('journeys').delete().eq('id', journeyId);
    throw new Error(lbErr.message);
  }

  return journeyId;
}

/**
 * Appends a new leg_booking to an existing incomplete journey and updates
 * its is_complete flag.
 *
 * @returns The new leg_booking's id (used for undo).
 */
export async function addLegToJourney(params: {
  journeyId: string;
  legId: string;
  userId: string;
  originCity: string;
  destinationCity: string;
  operator: string | null;
  serviceNumber: string | null;
  seat: string | null;
  confirmationRef: string | null;
  legOrder: number;
  departureDate?: string | null;
  departureTime?: string | null;
  arrivalDate?: string | null;
  arrivalTime?: string | null;
  extraData?: Record<string, string | null>;
  isComplete: boolean;
}): Promise<string> {
  const { data: lb, error: lbErr } = await supabase
    .from('leg_bookings')
    .insert({
      journey_id: params.journeyId,
      leg_id: params.legId,
      owner_id: params.userId,
      origin_city: params.originCity,
      destination_city: params.destinationCity,
      operator: params.operator,
      reference: params.serviceNumber,
      seat: params.seat,
      confirmation_ref: params.confirmationRef,
      leg_order: params.legOrder,
      departure_date: params.departureDate ?? null,
      departure_time: params.departureTime ?? null,
      arrival_date: params.arrivalDate ?? null,
      arrival_time: params.arrivalTime ?? null,
      extra_data: params.extraData ?? null,
    })
    .select('id')
    .single();
  if (lbErr || !lb) {
    throw new Error(lbErr?.message ?? 'Could not add leg');
  }

  const { error: journeyErr } = await supabase
    .from('journeys')
    .update({ is_complete: params.isComplete })
    .eq('id', params.journeyId);
  if (journeyErr) {
    throw new Error(journeyErr.message);
  }

  return (lb as any).id as string;
}

/**
 * Deletes all leg_bookings for a journey, then the journey itself.
 * Used for undo of connection bookings.
 */
export async function deleteConnectionBooking(journeyId: string): Promise<void> {
  await supabase.from('leg_bookings').delete().eq('journey_id', journeyId);
  await supabase.from('journeys').delete().eq('id', journeyId);
}

/**
 * Deletes a leg_booking and its parent journey (when the journey has only
 * this one leg, which is always true for phase-1 saves).
 * Safe to call on old records without journey_id — the journey deletion
 * step is skipped when journey_id is null.
 */
export async function deleteTransportBooking(legBookingId: string): Promise<void> {
  // Fetch journey_id before deleting (it won't be available after)
  const { data: lb } = await supabase
    .from('leg_bookings')
    .select('journey_id')
    .eq('id', legBookingId)
    .maybeSingle();

  const journeyId: string | null = (lb as any)?.journey_id ?? null;

  await supabase.from('leg_bookings').delete().eq('id', legBookingId);

  if (journeyId) {
    await supabase.from('journeys').delete().eq('id', journeyId);
  }
}
