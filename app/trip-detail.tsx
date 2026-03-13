import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';

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

type ItineraryItem =
  | { kind: 'stop'; stop: DbStop; stopIndex: number }
  | { kind: 'leg'; leg: DbLeg; fromCity: string; toCity: string }
  | { kind: 'gap'; fromCity: string; toCity: string };

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

function buildItinerary(stops: DbStop[], legs: DbLeg[]): ItineraryItem[] {
  // Map "fromId:toId" → leg for O(1) lookup
  const legByStops = new Map(
    legs
      .filter(l => l.from_stop_id && l.to_stop_id)
      .map(l => [`${l.from_stop_id}:${l.to_stop_id}`, l]),
  );

  const items: ItineraryItem[] = [];
  for (let i = 0; i < stops.length; i++) {
    items.push({ kind: 'stop', stop: stops[i], stopIndex: i });
    if (i < stops.length - 1) {
      const key = `${stops[i].id}:${stops[i + 1].id}`;
      const leg = legByStops.get(key);
      if (leg) {
        items.push({ kind: 'leg', leg, fromCity: stops[i].city, toCity: stops[i + 1].city });
      } else {
        items.push({ kind: 'gap', fromCity: stops[i].city, toCity: stops[i + 1].city });
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

function StopRow({
  item, onPress,
}: {
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

function LegRow({
  item, onPress,
}: {
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

function GapRow({ fromCity, toCity }: { fromCity: string; toCity: string }) {
  return (
    <View style={styles.gapRow}>
      <View style={styles.gapIconWrap}>
        <Feather name="plus" size={12} color={colors.border} />
      </View>
      <Text style={styles.gapText} numberOfLines={1}>
        {fromCity} → {toCity}
      </Text>
      <Text style={styles.gapAction}>Add transport</Text>
    </View>
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

  useEffect(() => {
    const fetchTrip = async () => {
      if (!tripId) {
        setError('No trip specified.');
        setLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('trips')
        .select('*, stops(*), legs(*)')
        .eq('id', tripId)
        .single();

      if (fetchError || !data) {
        setError('Could not load this trip.');
      } else {
        const raw = data as any;
        setTrip({
          ...raw,
          stops: (raw.stops as DbStop[])
            .slice()
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
          legs: (raw.legs as DbLeg[])
            .slice()
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
        });
      }
      setLoading(false);
    };

    fetchTrip();
  }, [tripId]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
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

  // ── Render ───────────────────────────────────────────────────────────────
  const tripDateRange = formatDateRange(trip.start_date, trip.end_date);
  const nights = trip.stops.reduce((sum, s) => sum + stopNights(s), 0);
  const meta = [tripDateRange, nights > 0 ? `${nights} nights` : ''].filter(Boolean).join(' · ');
  const itinerary = buildItinerary(trip.stops, trip.legs);

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
                  onPress={() =>
                    router.push({ pathname: '/leg', params: { legId: item.leg.id } })
                  }
                />
              )}
              {item.kind === 'gap' && (
                <GapRow fromCity={item.fromCity} toCity={item.toCity} />
              )}
            </React.Fragment>
          ))
        )}
      </ScrollView>
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

  // Nav row
  navRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  navSpacer: { flex: 1 },

  // Trip meta (inside safeTop, below nav)
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

  // Scroll
  scrollContent: { padding: 16, paddingBottom: 48 },

  // Connector between items
  connector: { alignItems: 'center', height: 20 },
  connectorLine: { width: 2, flex: 1, backgroundColor: colors.border },

  // Stop row
  stopRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: 14,
    padding: 14,
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
  stopCity: {
    fontFamily: fonts.bodyBold, fontSize: 17,
    color: colors.text, marginBottom: 2,
  },
  stopMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  // Leg row
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
  legRoute: {
    flex: 1, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text,
  },
  legType: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, flexShrink: 0 },

  // Gap row
  gapRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  gapIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  gapText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
  gapAction: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary, flexShrink: 0 },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },

  // Error / loading
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
