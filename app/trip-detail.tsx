import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import { createTransportBooking } from '@/lib/journeyUtils';
import { transportIcon } from '@/components/BookingPreviewSheet';
import ManualTransportSheet from '@/components/ManualTransportSheet';
import type { StopOption } from '@/components/BookingPreviewSheet';
import type { ParsedBooking } from '@/lib/claude';

// ─── Types ────────────────────────────────────────────────────────────────────

type TransportType = 'flight' | 'train' | 'bus' | 'car' | 'ferry' | 'other';

interface DbStop {
  id: string;
  city: string;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  nights: number | null;
  order_index: number | null;
}

interface DbLeg {
  id: string;
  transport_type: TransportType | null;
  from_stop_id: string | null;
  to_stop_id: string | null;
  order_index: number | null;
}

interface DbTrip {
  id: string;
  name: string;
  type: 'single' | 'multi';
  start_date: string | null;
  end_date: string | null;
  stops: DbStop[];
  legs: DbLeg[];
}

interface TransportItem {
  id: string;
  source: 'leg_bookings' | 'saved_items';
  transport_type: string;
  operator: string;
  service_number: string;
  origin_city: string;
  destination_city: string;
  departure_date: string | null;
  departure_time: string | null;
}

type ItineraryItem =
  | { kind: 'stop'; stop: DbStop; stopIndex: number }
  | { kind: 'leg'; leg: DbLeg; fromCity: string; toCity: string; transport: TransportItem[] }
  | { kind: 'gap'; fromCity: string; toCity: string; toStopId: string; transport: TransportItem[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return '';
  const s = new Date(start + 'T00:00:00');
  const sStr = `${s.getDate()} ${MONTHS[s.getMonth()]}`;
  if (!end) return sStr;
  const e = new Date(end + 'T00:00:00');
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]}`;
  }
  return `${sStr} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
}

function stopNights(s: DbStop): number {
  if (s.nights !== null) return s.nights;
  if (!s.start_date || !s.end_date) return 0;
  const diff = Math.round(
    (new Date(s.end_date + 'T00:00:00').getTime() - new Date(s.start_date + 'T00:00:00').getTime()) /
    (1000 * 60 * 60 * 24),
  );
  return diff > 0 ? diff : 0;
}

function transportLabel(type: TransportType | null): string {
  if (!type) return 'Transfer';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function cityEq(a: string, b: string): boolean {
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}

function buildItinerary(
  stops: DbStop[],
  legs: DbLeg[],
  allTransport: TransportItem[],
): ItineraryItem[] {
  const legByStops = new Map(
    legs
      .filter(l => l.from_stop_id && l.to_stop_id)
      .map(l => [`${l.from_stop_id}:${l.to_stop_id}`, l]),
  );

  const items: ItineraryItem[] = [];
  for (let i = 0; i < stops.length; i++) {
    items.push({ kind: 'stop', stop: stops[i], stopIndex: i });
    if (i < stops.length - 1) {
      const fromStop = stops[i];
      const toStop = stops[i + 1];
      const key = `${fromStop.id}:${toStop.id}`;
      const leg = legByStops.get(key);
      // Match transports whose origin→destination aligns with this gap/leg
      const matched = allTransport.filter(
        (t) => cityEq(t.origin_city, fromStop.city) && cityEq(t.destination_city, toStop.city),
      );
      if (leg) {
        items.push({ kind: 'leg', leg, fromCity: fromStop.city, toCity: toStop.city, transport: matched });
      } else {
        items.push({
          kind: 'gap',
          fromCity: fromStop.city,
          toCity: toStop.city,
          toStopId: toStop.id,
          transport: matched,
        });
      }
    }
  }
  return items;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TransportIcon({ type, size = 15, color = colors.textMuted }: {
  type: TransportType | null;
  size?: number;
  color?: string;
}) {
  const map: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
    flight: 'airplane', train: 'train', bus: 'bus',
    ferry: 'ferry', car: 'car', other: 'dots-horizontal',
  };
  const name = (type && map[type]) ? map[type] : 'dots-horizontal';
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

function StopRow({ item, onPress }: {
  item: Extract<ItineraryItem, { kind: 'stop' }>;
  onPress: () => void;
}) {
  const { stop, stopIndex } = item;
  const nights = stopNights(stop);
  const dateRange = formatDateRange(stop.start_date, stop.end_date);
  const meta = [dateRange, nights > 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      style={({ pressed }) => [styles.stopRow, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.stopCircle}>
        <Text style={styles.stopNumber}>{stopIndex + 1}</Text>
      </View>
      <View style={styles.stopBody}>
        <Text style={styles.stopCity}>{stop.city}</Text>
        {meta ? <Text style={styles.stopMeta}>{meta}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={colors.border} />
    </Pressable>
  );
}

function LegRow({ item, onPress }: {
  item: Extract<ItineraryItem, { kind: 'leg' }>;
  onPress: () => void;
}) {
  const { leg, fromCity, toCity } = item;
  return (
    <Pressable
      style={({ pressed }) => [styles.legRow, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.legIconWrap}>
        <TransportIcon type={leg.transport_type} />
      </View>
      <Text style={styles.legRoute} numberOfLines={1}>
        {fromCity} → {toCity}
      </Text>
      <Text style={styles.legType}>{transportLabel(leg.transport_type)}</Text>
    </Pressable>
  );
}

function GapRow({ item, onAddTransport, onTransportPress }: {
  item: Extract<ItineraryItem, { kind: 'gap' }>;
  onAddTransport: () => void;
  onTransportPress: (t: TransportItem) => void;
}) {
  const { fromCity, toCity, transport } = item;

  if (transport.length > 0) {
    // Show the first (best) matched transport booking
    const t = transport[0];
    const icon = transportIcon(t.transport_type);
    const meta = [
      t.departure_date
        ? (() => { const d = new Date(t.departure_date + 'T00:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; })()
        : null,
      t.departure_time || null,
    ].filter(Boolean).join(' · ');

    return (
      <Pressable
        style={({ pressed }) => [styles.gapRow, styles.gapRowFilled, pressed && styles.rowPressed]}
        onPress={() => onTransportPress(t)}
      >
        <View style={styles.gapIconWrapFilled}>
          <Feather name={icon} size={13} color={colors.primary} />
        </View>
        <View style={styles.gapTransportBody}>
          <Text style={styles.gapTransportRoute} numberOfLines={1}>
            {fromCity} → {toCity}
          </Text>
          <Text style={styles.gapTransportMeta} numberOfLines={1}>
            {[t.operator, t.service_number].filter(Boolean).join(' ')}
            {meta ? `  ·  ${meta}` : ''}
          </Text>
        </View>
        <Feather name="chevron-right" size={15} color={colors.border} />
      </Pressable>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.gapRow, pressed && styles.rowPressed]}
      onPress={onAddTransport}
    >
      <View style={styles.gapIconWrap}>
        <Feather name="plus" size={12} color={colors.primary} />
      </View>
      <Text style={styles.gapText} numberOfLines={1}>
        {fromCity} → {toCity}
      </Text>
      <Text style={styles.gapAction}>Add transport</Text>
    </Pressable>
  );
}

function Connector() {
  return (
    <View style={styles.connector}>
      <View style={styles.connectorLine} />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripDetailScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<DbTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [stopOptions, setStopOptions] = useState<StopOption[]>([]);

  // Manual transport sheet state
  const [manualVisible, setManualVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeToStopId, setActiveToStopId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const fetchTrip = async () => {
        if (!tripId) {
          setError('No trip specified.');
          setLoading(false);
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id ?? null;

        const { data, error: fetchError } = await supabase
          .from('trips')
          .select('*, stops(*), legs(*)')
          .eq('id', tripId)
          .single();

        if (fetchError || !data) {
          setError('Could not load this trip.');
          setLoading(false);
          return;
        }

        const raw = data as any;
        const sortedStops = (raw.stops as DbStop[])
          .slice()
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        const sortedLegs = (raw.legs as DbLeg[])
          .slice()
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

        setTrip({ ...raw, stops: sortedStops, legs: sortedLegs });
        setStopOptions(sortedStops.map((s) => ({ id: s.id, city: s.city, tripName: raw.name ?? '' })));

        const stopIds = sortedStops.map((s) => s.id);
        if (stopIds.length === 0 || !userId) {
          setItinerary(buildItinerary(sortedStops, sortedLegs, []));
          setLoading(false);
          return;
        }

        // Leg IDs whose destination is one of this trip's stops (needed for
        // backward-compat fetch of old leg_bookings without journey_id).
        const inboundLegIds = sortedLegs
          .filter((l) => l.to_stop_id && stopIds.includes(l.to_stop_id))
          .map((l) => l.id);

        // Step 1: fetch journeys for this trip + saved_items transport
        const [journeyResult, savedTResult] = await Promise.all([
          supabase
            .from('journeys')
            .select('id, origin_city, destination_city, leg_id')
            .eq('trip_id', tripId!),
          supabase
            .from('saved_items')
            .select('id, stop_id, note')
            .in('stop_id', stopIds)
            .eq('creator_id', userId)
            .eq('category', 'Transport'),
        ]);

        const journeys = (journeyResult.data ?? []) as any[];
        const journeyIds = journeys.map((j: any) => j.id);

        // Step 2: fetch leg_bookings — new records (via journey_id) and old
        // records without journey_id (backward compat)
        const [journeyLbResult, oldLbResult] = await Promise.all([
          journeyIds.length > 0
            ? supabase
                .from('leg_bookings')
                .select('id, journey_id, leg_id, operator, reference')
                .in('journey_id', journeyIds)
                .eq('owner_id', userId)
            : Promise.resolve({ data: [], error: null }),
          inboundLegIds.length > 0
            ? supabase
                .from('leg_bookings')
                .select('id, leg_id, operator, reference')
                .in('leg_id', inboundLegIds)
                .eq('owner_id', userId)
                .is('journey_id', null)
            : Promise.resolve({ data: [], error: null }),
        ]);

        // Build flat transport list for city-based gap matching
        const allTransport: TransportItem[] = [];

        // Journey-backed leg_bookings: use the journey's stored cities.
        // Deduplicate by journey_id — connections create N leg_bookings per journey
        // but we only want one transport item per journey.
        const seenJourneys = new Set<string>();
        for (const lb of (journeyLbResult.data ?? []) as any[]) {
          const journey = journeys.find((j: any) => j.id === lb.journey_id);
          if (!journey) continue;
          if (seenJourneys.has(lb.journey_id)) continue;
          seenJourneys.add(lb.journey_id);
          allTransport.push({
            id: lb.id,
            source: 'leg_bookings',
            transport_type: 'flight',
            operator: lb.operator ?? '',
            service_number: lb.reference ?? '',
            origin_city: journey.origin_city,
            destination_city: journey.destination_city,
            departure_date: null,
            departure_time: null,
          });
        }

        // Old leg_bookings (no journey_id) — derive cities from stop records
        for (const lb of (oldLbResult.data ?? []) as any[]) {
          const leg = sortedLegs.find((l) => l.id === lb.leg_id);
          if (!leg || !leg.to_stop_id || !leg.from_stop_id) continue;
          const fromStop = sortedStops.find((s) => s.id === leg.from_stop_id);
          const toStop = sortedStops.find((s) => s.id === leg.to_stop_id);
          if (!fromStop || !toStop) continue;
          allTransport.push({
            id: lb.id,
            source: 'leg_bookings',
            transport_type: 'flight',
            operator: lb.operator ?? '',
            service_number: lb.reference ?? '',
            origin_city: fromStop.city,
            destination_city: toStop.city,
            departure_date: null,
            departure_time: null,
          });
        }

        for (const sf of savedTResult.data ?? []) {
          try {
            const parsed = JSON.parse((sf as any).note ?? '{}');

            // Connection bookings store legs in a nested array
            const isConnection = parsed.is_connection === true && Array.isArray(parsed.legs) && parsed.legs.length > 0;
            const firstLeg = isConnection ? parsed.legs[0] : parsed;
            const lastLeg  = isConnection ? parsed.legs[parsed.legs.length - 1] : parsed;

            const originCity: string = firstLeg?.origin_city ?? '';
            const destinationCity: string = lastLeg?.destination_city ?? '';
            if (!originCity || !destinationCity) continue;

            allTransport.push({
              id: (sf as any).id,
              source: 'saved_items',
              transport_type: firstLeg?.transport_type ?? 'flight',
              operator: firstLeg?.operator ?? firstLeg?.airline ?? '',
              service_number: firstLeg?.service_number ?? firstLeg?.flight_number ?? '',
              origin_city: originCity,
              destination_city: destinationCity,
              departure_date: firstLeg?.departure_date ?? null,
              departure_time: firstLeg?.departure_time ?? null,
            });
          } catch { /* skip malformed */ }
        }

        setItinerary(buildItinerary(sortedStops, sortedLegs, allTransport));
        setLoading(false);
      };

      setLoading(true);
      setError(null);
      fetchTrip();
    }, [tripId])
  );

  // ── Add transport (manual) ────────────────────────────────────────────────

  async function handleSaveManualTransport(booking: ParsedBooking, stopId: string | null) {
    if (booking.type !== 'transport') return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not signed in.');

      const targetStopId = stopId ?? activeToStopId;

      // Try to match a leg by destination city first
      const { data: legs } = await supabase
        .from('legs')
        .select('id, from_stop:from_stop_id(city), to_stop:to_stop_id(city)')
        .eq('trip_id', tripId)
        .limit(50);

      const matchedLeg = (legs ?? []).find(
        (l: any) => cityEq(l.to_stop?.city ?? '', booking.destination_city ?? ''),
      );

      if (matchedLeg) {
        await createTransportBooking({
          tripId: tripId!,
          legId: matchedLeg.id,
          originCity: booking.origin_city ?? (matchedLeg as any).from_stop?.city ?? '',
          destinationCity: booking.destination_city ?? (matchedLeg as any).to_stop?.city ?? '',
          userId,
          operator: booking.operator,
          serviceNumber: booking.service_number,
          seat: booking.seat,
          confirmationRef: booking.booking_ref,
        });
      } else {
        await supabase.from('saved_items').insert({
          stop_id: targetStopId,
          creator_id: userId,
          name: `${booking.operator} ${booking.service_number}`.trim(),
          category: 'Transport',
          note: JSON.stringify({
            transport_type: booking.transport_type,
            operator: booking.operator,
            service_number: booking.service_number,
            origin_city: booking.origin_city,
            destination_city: booking.destination_city,
            departure_date: booking.departure_date,
            departure_time: booking.departure_time,
            arrival_date: booking.arrival_date,
            arrival_time: booking.arrival_time,
            booking_ref: booking.booking_ref,
            seat: booking.seat,
          }),
        });
      }

      setManualVisible(false);
      setActiveToStopId(null);
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !trip) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <SafeAreaView edges={['top']} style={styles.safeTop}>
          <View style={styles.navRow}>
            <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
              <Feather name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          </View>
        </SafeAreaView>
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error ?? 'Something went wrong.'}</Text>
          <Pressable style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryText}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const tripDateRange = formatDateRange(trip.start_date, trip.end_date);
  const nights = trip.stops.reduce((sum, s) => sum + stopNights(s), 0);
  const meta = [tripDateRange, nights > 0 ? `${nights} nights` : ''].filter(Boolean).join(' · ');

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.navRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.navSpacer} />
        </View>
        <View style={styles.tripMeta}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeLabel}>
              {trip.type === 'multi' ? 'MULTI-STOP' : 'SINGLE'}
            </Text>
          </View>
          <Text style={styles.tripName}>{trip.name}</Text>
          {meta ? <Text style={styles.tripDetails}>{meta}</Text> : null}
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {itinerary.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Feather name="map-pin" size={24} color={colors.border} />
            <Text style={styles.emptyText}>No stops added yet</Text>
          </View>
        ) : (
          itinerary.map((item, index) => (
            <React.Fragment key={index}>
              {index > 0 && <Connector />}
              {item.kind === 'stop' && (
                <StopRow
                  item={item}
                  onPress={() =>
                    router.push({ pathname: '/stop-detail', params: { stopId: item.stop.id } })
                  }
                />
              )}
              {item.kind === 'leg' && (
                <LegRow
                  item={item}
                  onPress={() => {
                    const t = item.transport[0];
                    if (t) {
                      router.push({
                        pathname: '/booking-detail',
                        params: { type: 'transport', id: t.id, source: t.source },
                      });
                    } else {
                      router.push({ pathname: '/leg', params: { legId: item.leg.id } });
                    }
                  }}
                />
              )}
              {item.kind === 'gap' && (
                <GapRow
                  item={item}
                  onAddTransport={() => {
                    setActiveToStopId(item.toStopId);
                    setManualVisible(true);
                  }}
                  onTransportPress={(t) =>
                    router.push({
                      pathname: '/booking-detail',
                      params: { type: 'transport', id: t.id, source: t.source },
                    })
                  }
                />
              )}
            </React.Fragment>
          ))
        )}
      </ScrollView>

      <ManualTransportSheet
        visible={manualVisible}
        stops={stopOptions}
        saving={saving}
        onSave={handleSaveManualTransport}
        onDiscard={() => { setManualVisible(false); setActiveToStopId(null); }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  safeTop: {
    backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },

  navRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  navSpacer: { flex: 1 },

  tripMeta: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18 },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EBF3F6', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8,
  },
  typeBadgeLabel: {
    fontFamily: fonts.bodyBold, fontSize: 10,
    color: colors.primary, letterSpacing: 0.8,
  },
  tripName: {
    fontFamily: fonts.displayBold, fontSize: 28,
    color: colors.text, letterSpacing: -0.3, marginBottom: 4,
  },
  tripDetails: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },

  scrollContent: { padding: 16, paddingBottom: 48 },

  connector: { alignItems: 'center', height: 20 },
  connectorLine: { width: 2, flex: 1, backgroundColor: colors.border },

  // Stop row
  stopRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  rowPressed: { opacity: 0.8 },
  stopCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12, flexShrink: 0,
  },
  stopNumber: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.white },
  stopBody: { flex: 1 },
  stopCity: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text, marginBottom: 2 },
  stopMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  // Leg row (existing leg record)
  legRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.background,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  legIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  legRoute: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  legType: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, flexShrink: 0 },

  // Gap row — empty state
  gapRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  gapIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  gapText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
  gapAction: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary, flexShrink: 0 },

  // Gap row — filled with transport
  gapRowFilled: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  gapIconWrapFilled: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#EBF3F6',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  gapTransportBody: { flex: 1 },
  gapTransportRoute: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text, marginBottom: 2 },
  gapTransportMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },

  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: {
    fontFamily: fonts.body, fontSize: 14,
    color: colors.textMuted, marginBottom: 12, textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
  },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },
});
