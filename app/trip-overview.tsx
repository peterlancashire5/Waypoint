import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import { transportIcon } from '@/components/BookingPreviewSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewStop {
  id: string;
  city: string;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  nights: number | null;
  order_index: number;
}

interface OverviewLeg {
  id: string;
  from_stop_id: string;
  to_stop_id: string;
}

interface AccommodationItem {
  id: string;
  hotel_name: string;
  check_in_date: string | null;
  check_out_date: string | null;
  booking_ref: string | null;
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
  booking_ref: string | null;
}

type TimelineNode =
  | {
      kind: 'stop';
      stop: OverviewStop;
      index: number;
      accommodation: AccommodationItem[];
      transport: TransportItem[];
    }
  | {
      kind: 'leg';
      fromStop: OverviewStop;
      toStop: OverviewStop;
      legId: string | null;
      matchedTransport: TransportItem[];
    };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = new Date(start + 'T00:00:00');
  const sStr = `${s.getDate()} ${MONTHS[s.getMonth()]}`;
  if (!end) return sStr;
  const e = new Date(end + 'T00:00:00');
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]}`;
  }
  return `${sStr} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
}

function stopNights(s: OverviewStop): number | null {
  if (s.start_date && s.end_date) {
    const diff = Math.round(
      (new Date(s.end_date + 'T00:00:00').getTime() - new Date(s.start_date + 'T00:00:00').getTime()) /
        86_400_000
    );
    return diff > 0 ? diff : null;
  }
  return s.nights;
}

function buildTimeline(
  stops: OverviewStop[],
  legs: OverviewLeg[],
  accommodationByStop: Map<string, AccommodationItem[]>,
  transportByStop: Map<string, TransportItem[]>,
  allTransport: TransportItem[],
): TimelineNode[] {
  const legByKey = new Map(
    legs
      .filter((l) => l.from_stop_id && l.to_stop_id)
      .map((l) => [`${l.from_stop_id}:${l.to_stop_id}`, l])
  );

  const nodes: TimelineNode[] = [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    nodes.push({
      kind: 'stop',
      stop,
      index: i,
      accommodation: accommodationByStop.get(stop.id) ?? [],
      transport: transportByStop.get(stop.id) ?? [],
    });

    if (i < stops.length - 1) {
      const fromStop = stops[i];
      const toStop = stops[i + 1];
      const leg = legByKey.get(`${fromStop.id}:${toStop.id}`) ?? null;

      // Match transport whose origin→destination matches the stop cities (case-insensitive)
      const fromCity = fromStop.city.toLowerCase().trim();
      const toCity = toStop.city.toLowerCase().trim();
      const matchedTransport = allTransport.filter(
        (t) =>
          t.origin_city.toLowerCase().trim() === fromCity &&
          t.destination_city.toLowerCase().trim() === toCity
      );

      nodes.push({
        kind: 'leg',
        fromStop,
        toStop,
        legId: leg?.id ?? null,
        matchedTransport,
      });
    }
  }
  return nodes;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AccommodationRow({
  item,
  onPress,
}: {
  item: AccommodationItem;
  onPress: () => void;
}) {
  const dateStr = formatDateRange(item.check_in_date, item.check_out_date);
  return (
    <Pressable
      style={({ pressed }) => [styles.subRow, pressed && styles.subRowPressed]}
      onPress={onPress}
    >
      <View style={styles.subRowIconWrap}>
        <Feather name="home" size={13} color={colors.primary} />
      </View>
      <View style={styles.subRowBody}>
        <Text style={styles.subRowTitle} numberOfLines={1}>{item.hotel_name || 'Accommodation'}</Text>
        {dateStr ? <Text style={styles.subRowMeta}>{dateStr}</Text> : null}
      </View>
      <Feather name="chevron-right" size={14} color={colors.border} />
    </Pressable>
  );
}

function TransportRow({
  item,
  onPress,
}: {
  item: TransportItem;
  onPress: () => void;
}) {
  const icon = transportIcon(item.transport_type);
  const meta = [
    item.departure_date
      ? (() => {
          const d = new Date(item.departure_date + 'T00:00:00');
          return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
        })()
      : null,
    item.departure_time || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      style={({ pressed }) => [styles.subRow, pressed && styles.subRowPressed]}
      onPress={onPress}
    >
      <View style={styles.subRowIconWrap}>
        <Feather name={icon} size={13} color={colors.primary} />
      </View>
      <View style={styles.subRowBody}>
        <Text style={styles.subRowTitle} numberOfLines={1}>
          {[item.operator, item.service_number].filter(Boolean).join(' ')}
        </Text>
        <Text style={styles.subRowMeta} numberOfLines={1}>
          {item.origin_city} → {item.destination_city}
          {meta ? `  ·  ${meta}` : ''}
        </Text>
      </View>
      <Feather name="chevron-right" size={14} color={colors.border} />
    </Pressable>
  );
}

function StopNode({
  node,
  onStopPress,
  onAccommodationPress,
  onTransportPress,
}: {
  node: Extract<TimelineNode, { kind: 'stop' }>;
  onStopPress: () => void;
  onAccommodationPress: (item: AccommodationItem) => void;
  onTransportPress: (item: TransportItem) => void;
}) {
  const { stop, index, accommodation, transport } = node;
  const nights = stopNights(stop);
  const dateStr = formatDateRange(stop.start_date, stop.end_date);
  const meta = [
    stop.country,
    dateStr,
    nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.stopNode}>
      {/* Left rail: circle */}
      <View style={styles.stopRail}>
        <View style={styles.stopCircle}>
          <Text style={styles.stopCircleNum}>{index + 1}</Text>
        </View>
      </View>

      {/* Right content */}
      <View style={styles.stopContent}>
        <Pressable
          style={({ pressed }) => [styles.stopHeader, pressed && styles.stopHeaderPressed]}
          onPress={onStopPress}
        >
          <View style={styles.stopHeaderText}>
            <Text style={styles.stopCity}>{stop.city}</Text>
            {meta ? <Text style={styles.stopMeta}>{meta}</Text> : null}
          </View>
          <Feather name="chevron-right" size={16} color={colors.border} />
        </Pressable>

        {(accommodation.length > 0 || transport.length > 0) && (
          <View style={styles.subRows}>
            {accommodation.map((a) => (
              <AccommodationRow
                key={a.id}
                item={a}
                onPress={() => onAccommodationPress(a)}
              />
            ))}
            {transport.map((t) => (
              <TransportRow
                key={t.id}
                item={t}
                onPress={() => onTransportPress(t)}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function LegNode({ node }: { node: Extract<TimelineNode, { kind: 'leg' }> }) {
  const { fromStop, toStop, matchedTransport } = node;

  return (
    <View style={styles.legNode}>
      {/* Left rail: just the line */}
      <View style={styles.legRail}>
        <View style={styles.legLine} />
      </View>

      {/* Right content */}
      <View style={styles.legContent}>
        <View style={styles.legRow}>
          <View style={styles.legRouteWrap}>
            <Text style={styles.legRoute} numberOfLines={1}>
              {fromStop.city} → {toStop.city}
            </Text>
          </View>
        </View>

        {matchedTransport.length > 0 ? (
          matchedTransport.map((t) => {
            const icon = transportIcon(t.transport_type);
            const meta = [t.operator, t.service_number, t.departure_time].filter(Boolean).join(' · ');
            return (
              <View key={t.id} style={styles.legTransportRow}>
                <Feather name={icon} size={12} color={colors.primary} />
                <Text style={styles.legTransportText} numberOfLines={1}>{meta}</Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.legNoTransport}>No transport added</Text>
        )}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripOverviewScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tripName, setTripName] = useState('');
  const [timeline, setTimeline] = useState<TimelineNode[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!tripId) {
        setError('No trip specified.');
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setError('Not signed in.');
        setLoading(false);
        return;
      }

      // 1. Trip + stops + legs
      const { data: tripData, error: tripErr } = await supabase
        .from('trips')
        .select('id, name, stops(id, city, country, start_date, end_date, nights, order_index), legs(id, from_stop_id, to_stop_id, order_index)')
        .eq('id', tripId)
        .single();

      if (tripErr || !tripData) {
        setError('Could not load trip.');
        setLoading(false);
        return;
      }

      const raw = tripData as any;
      setTripName(raw.name ?? '');

      const stops: OverviewStop[] = (raw.stops as any[])
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

      const legs: OverviewLeg[] = (raw.legs as any[])
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

      const stopIds = stops.map((s) => s.id);
      if (stopIds.length === 0) {
        setTimeline([]);
        setLoading(false);
        return;
      }

      // 2. Parallel: accommodation + inbound leg_bookings + saved_items transport
      const inboundLegIds = legs
        .filter((l) => stopIds.includes(l.to_stop_id))
        .map((l) => l.id);

      const [accsResult, lbsResult, savedTResult] = await Promise.all([
        supabase
          .from('accommodation')
          .select('id, stop_id, name, confirmation_ref, check_in_date, check_out_date')
          .in('stop_id', stopIds)
          .eq('owner_id', userId),
        inboundLegIds.length > 0
          ? supabase
              .from('leg_bookings')
              .select('id, leg_id, operator, reference, seat, confirmation_ref')
              .in('leg_id', inboundLegIds)
              .eq('owner_id', userId)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('saved_items')
          .select('id, stop_id, note')
          .in('stop_id', stopIds)
          .eq('creator_id', userId)
          .eq('category', 'Transport'),
      ]);

      // Build accommodation map: stop_id → items
      const accommodationByStop = new Map<string, AccommodationItem[]>();
      for (const a of accsResult.data ?? []) {
        const list = accommodationByStop.get((a as any).stop_id) ?? [];
        list.push({
          id: (a as any).id,
          hotel_name: (a as any).name ?? '',
          check_in_date: (a as any).check_in_date ?? null,
          check_out_date: (a as any).check_out_date ?? null,
          booking_ref: (a as any).confirmation_ref ?? null,
        });
        accommodationByStop.set((a as any).stop_id, list);
      }

      // Build transport map: stop_id → items (combining leg_bookings + saved_items)
      const transportByStop = new Map<string, TransportItem[]>();

      // From leg_bookings
      for (const lb of lbsResult.data ?? []) {
        const leg = legs.find((l) => l.id === (lb as any).leg_id);
        if (!leg) continue;
        const stopId = leg.to_stop_id;
        const toStop = stops.find((s) => s.id === stopId);
        const fromStop = stops.find((s) => s.id === leg.from_stop_id);
        const list = transportByStop.get(stopId) ?? [];
        list.push({
          id: (lb as any).id,
          source: 'leg_bookings',
          transport_type: 'flight', // legacy leg_bookings don't store type
          operator: (lb as any).operator ?? '',
          service_number: (lb as any).reference ?? '',
          origin_city: fromStop?.city ?? '',
          destination_city: toStop?.city ?? '',
          departure_date: null,
          departure_time: null,
          booking_ref: (lb as any).confirmation_ref ?? null,
        });
        transportByStop.set(stopId, list);
      }

      // From saved_items
      for (const sf of savedTResult.data ?? []) {
        try {
          const parsed = JSON.parse((sf as any).note ?? '{}');
          if (!parsed.origin_city) continue;
          const stopId = (sf as any).stop_id;
          const list = transportByStop.get(stopId) ?? [];
          list.push({
            id: (sf as any).id,
            source: 'saved_items',
            transport_type: parsed.transport_type ?? 'flight',
            operator: parsed.operator ?? parsed.airline ?? '',
            service_number: parsed.service_number ?? parsed.flight_number ?? '',
            origin_city: parsed.origin_city ?? '',
            destination_city: parsed.destination_city ?? '',
            departure_date: parsed.departure_date ?? null,
            departure_time: parsed.departure_time ?? null,
            booking_ref: parsed.booking_ref ?? null,
          });
          transportByStop.set(stopId, list);
        } catch { /* skip malformed */ }
      }

      // Flatten all transport items for leg matching
      const allTransport = Array.from(transportByStop.values()).flat();

      setTimeline(buildTimeline(stops, legs, accommodationByStop, transportByStop, allTransport));
      setLoading(false);
    };

    load();
  }, [tripId]);

  // ── Navigate to booking detail ─────────────────────────────────────────────

  function handleAccommodationPress(item: AccommodationItem) {
    router.push({
      pathname: '/booking-detail',
      params: { type: 'accommodation', id: item.id, source: 'accommodation' },
    });
  }

  function handleTransportPress(item: TransportItem) {
    router.push({
      pathname: '/booking-detail',
      params: { type: 'transport', id: item.id, source: item.source },
    });
  }

  // ── Loading / error ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <SafeAreaView edges={['top']} style={styles.safeTop}>
          <View style={styles.navRow}>
            <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
              <Feather name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          </View>
        </SafeAreaView>
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => router.back()}>
            <Text style={styles.retryText}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.navRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.navTitle}>{tripName}</Text>
          <View style={styles.navSpacer} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {timeline.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Feather name="map-pin" size={24} color={colors.border} />
            <Text style={styles.emptyText}>No stops added yet</Text>
          </View>
        ) : (
          timeline.map((node, i) => {
            if (node.kind === 'stop') {
              return (
                <StopNode
                  key={node.stop.id}
                  node={node}
                  onStopPress={() =>
                    router.push({ pathname: '/stop-detail', params: { stopId: node.stop.id } })
                  }
                  onAccommodationPress={handleAccommodationPress}
                  onTransportPress={handleTransportPress}
                />
              );
            }
            return (
              <LegNode key={`leg-${i}`} node={node} />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const RAIL_WIDTH = 44; // width of the left rail column
const CIRCLE_SIZE = 28;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },

  navRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 8,
  },
  backBtn: { width: 32, alignItems: 'flex-start' },
  navTitle: {
    flex: 1, fontFamily: fonts.displayBold, fontSize: 19,
    color: colors.text, letterSpacing: -0.2, textAlign: 'center',
  },
  navSpacer: { width: 32 },

  scrollContent: { paddingVertical: 20, paddingHorizontal: 16, paddingBottom: 48 },

  // ── Stop node ─────────────────────────────────────────────────────────────
  stopNode: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 0 },

  stopRail: {
    width: RAIL_WIDTH, alignItems: 'center', paddingTop: 14, flexShrink: 0,
  },
  stopCircle: {
    width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  stopCircleNum: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.white },

  stopContent: { flex: 1, paddingBottom: 4 },

  stopHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  stopHeaderPressed: { opacity: 0.8 },
  stopHeaderText: { flex: 1 },
  stopCity: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text, marginBottom: 2 },
  stopMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },

  subRows: { marginTop: 6, gap: 4 },

  subRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.white, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  subRowPressed: { opacity: 0.75 },
  subRowIconWrap: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#EBF3F6', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  subRowBody: { flex: 1 },
  subRowTitle: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  subRowMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 1 },

  // ── Leg node ──────────────────────────────────────────────────────────────
  legNode: { flexDirection: 'row', alignItems: 'stretch', minHeight: 56 },

  legRail: { width: RAIL_WIDTH, alignItems: 'center', flexShrink: 0 },
  legLine: { width: 2, flex: 1, backgroundColor: colors.border },

  legContent: {
    flex: 1, justifyContent: 'center',
    paddingVertical: 10, paddingLeft: 2, paddingRight: 0,
  },
  legRow: { flexDirection: 'row', alignItems: 'center' },
  legRouteWrap: { flex: 1 },
  legRoute: {
    fontFamily: fonts.bodyBold, fontSize: 13, color: colors.textMuted,
  },
  legTransportRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3,
  },
  legTransportText: {
    fontFamily: fonts.body, fontSize: 12, color: colors.primary, flex: 1,
  },
  legNoTransport: {
    fontFamily: fonts.body, fontSize: 12, color: colors.border, marginTop: 2,
  },

  // ── Empty / error ─────────────────────────────────────────────────────────
  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },
});
