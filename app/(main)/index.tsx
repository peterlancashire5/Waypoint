import React, { useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeInDown,
  FadeInUp,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import QuickCaptureFAB from '@/components/QuickCaptureFAB';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stop {
  id: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  nights: number;
  start_date: string | null;
  end_date: string | null;
}

interface Trip {
  id: string;
  name: string;
  dateRange: string;
  stops: Stop[];
  firstLegId: string | null;
}

interface DbStop {
  id: string;
  city: string;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  nights: number | null;
  order_index: number | null;
  start_date: string | null;
  end_date: string | null;
}

interface DbLeg {
  id: string;
  order_index: number | null;
}

interface DbTrip {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  stops: DbStop[];
  legs: DbLeg[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return '—';
  const s = new Date(start + 'T00:00:00');
  const sStr = `${s.getDate()} ${MONTHS[s.getMonth()]}`;
  if (!end) return sStr;
  const e = new Date(end + 'T00:00:00');
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]}`;
  }
  return `${sStr} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
}

function regionForStops(stops: Stop[]) {
  const pinned = stops.filter((s) => s.lat !== null && s.lng !== null);
  if (pinned.length === 0) {
    return { latitude: 20, longitude: 15, latitudeDelta: 80, longitudeDelta: 80 };
  }
  if (pinned.length === 1) {
    return { latitude: pinned[0].lat!, longitude: pinned[0].lng!, latitudeDelta: 4, longitudeDelta: 4 };
  }
  const lats = pinned.map((s) => s.lat!);
  const lngs = pinned.map((s) => s.lng!);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const pad = 2;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(maxLat - minLat + pad * 2, 4),
    longitudeDelta: Math.max(maxLng - minLng + pad * 2, 4),
  };
}

function toStop(s: DbStop): Stop {
  return {
    id: s.id,
    city: s.city,
    country: s.country ?? '',
    lat: s.latitude,
    lng: s.longitude,
    nights: s.nights ?? 0,
    start_date: s.start_date,
    end_date: s.end_date,
  };
}

// ─── Map Pin ──────────────────────────────────────────────────────────────────

function MapPin({ stop, index, isSelected, onPress }: {
  stop: Stop;
  index: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function handlePress() {
    scale.value = withSpring(1.3, { damping: 6, stiffness: 300 }, () => {
      scale.value = withSpring(1, { damping: 8, stiffness: 200 });
    });
    onPress();
  }

  if (stop.lat === null || stop.lng === null) return null;

  return (
    <Marker
      coordinate={{ latitude: stop.lat, longitude: stop.lng }}
      onPress={handlePress}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
    >
      <Animated.View style={[styles.pinWrapper, animStyle]}>
        <View style={[styles.pin, isSelected && styles.pinSelected]}>
          <Text style={[styles.pinNumber, isSelected && styles.pinNumberSelected]}>
            {index + 1}
          </Text>
        </View>
        <View style={[styles.pinTail, isSelected && styles.pinTailSelected]} />
        {isSelected && (
          <View style={styles.pinLabel}>
            <Text style={styles.pinLabelText}>{stop.city}</Text>
          </View>
        )}
      </Animated.View>
    </Marker>
  );
}

// ─── City Chip ────────────────────────────────────────────────────────────────

function CityChip({ stop, index, isSelected, onPress }: {
  stop: Stop;
  index: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.chip, isSelected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipNumber, isSelected && styles.chipNumberSelected]}>{index + 1}</Text>
      <Text style={[styles.chipCity, isSelected && styles.chipCitySelected]}>{stop.city}</Text>
      {stop.nights > 0 && (
        <Text style={[styles.chipNights, isSelected && styles.chipNightsSelected]}>{stop.nights}n</Text>
      )}
    </Pressable>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onCreateTrip }: { onCreateTrip: () => void }) {
  return (
    <View style={styles.centred}>
      <View style={styles.emptyIconWrap}>
        <Feather name="map" size={32} color={colors.textMuted} />
      </View>
      <Text style={styles.emptyHeading}>No trips yet</Text>
      <Text style={styles.emptySubtitle}>Create your first trip to get started</Text>
      <Pressable style={styles.emptyButton} onPress={onCreateTrip}>
        <Feather name="plus" size={16} color={colors.white} />
        <Text style={styles.emptyButtonText}>New Trip</Text>
      </Pressable>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const fetch = async () => {
        setLoading(true);
        setError(null);
        setSelectedStopId(null);

        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) { setLoading(false); return; }

        const { data, error: fetchError } = await supabase
          .from('trips')
          .select('*, stops(*), legs(id, order_index)')
          .eq('owner_id', user.id)
          .in('status', ['upcoming', 'active'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fetchError) {
          setError('Could not load your trip.');
          setLoading(false);
          return;
        }

        if (!data) {
          setTrip(null);
          setLoading(false);
          return;
        }

        const dbTrip = data as DbTrip;
        let stops = (dbTrip.stops as DbStop[])
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
          .map(toStop);

        // Re-geocode any stops that are missing coordinates (silent fallback at create time)
        const missing = stops.filter((s) => s.lat === null || s.lng === null);
        if (missing.length > 0) {
          const geocodedMap = new Map<string, { lat: number; lng: number }>();
          await Promise.all(
            missing.map(async (s) => {
              try {
                const res = await globalThis.fetch(
                  `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(s.city)}&count=1&language=en&format=json`
                );
                const json = await res.json();
                const r = json.results?.[0];
                if (r) {
                  geocodedMap.set(s.id, { lat: r.latitude, lng: r.longitude });
                  supabase
                    .from('stops')
                    .update({ latitude: r.latitude, longitude: r.longitude })
                    .eq('id', s.id)
                    .then(() => {}); // fire and forget
                }
              } catch { /* silent */ }
            })
          );
          if (geocodedMap.size > 0) {
            stops = stops.map((s) => {
              const g = geocodedMap.get(s.id);
              return g ? { ...s, ...g } : s;
            });
          }
        }

        const firstLegId = (dbTrip.legs as DbLeg[])
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))[0]?.id ?? null;

        setTrip({
          id: dbTrip.id,
          name: dbTrip.name,
          dateRange: formatDateRange(dbTrip.start_date, dbTrip.end_date),
          stops,
          firstLegId,
        });
        setLoading(false);

        // Fit map to stops after render
        const region = regionForStops(stops);
        setTimeout(() => mapRef.current?.animateToRegion(region, 600), 300);
      };

      fetch();
    }, [])
  );

  function handleStopSelect(stop: Stop) {
    const isAlreadySelected = selectedStopId === stop.id;
    setSelectedStopId(isAlreadySelected ? null : stop.id);
    if (!isAlreadySelected && stop.lat !== null && stop.lng !== null) {
      mapRef.current?.animateToRegion(
        { latitude: stop.lat - 0.5, longitude: stop.lng, latitudeDelta: 4, longitudeDelta: 4 },
        400,
      );
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <View style={[styles.container, styles.centred]}>
        <StatusBar style="dark" />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => { setLoading(true); setError(null); }}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (!trip) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <SafeAreaView style={styles.flex1}>
          <EmptyState onCreateTrip={() => router.push('/create-trip')} />
        </SafeAreaView>
      </View>
    );
  }

  // ── Trip map ───────────────────────────────────────────────────────────────
  const pinnedStops = trip.stops.filter((s) => s.lat !== null && s.lng !== null);
  const polylineCoords = pinnedStops.map((s) => ({ latitude: s.lat!, longitude: s.lng! }));
  const totalNights = trip.stops.reduce((n, s) => n + s.nights, 0);
  const selectedStop = trip.stops.find((s) => s.id === selectedStopId) ?? null;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        initialRegion={regionForStops(trip.stops)}
        showsUserLocation={false}
        showsCompass={false}
        pitchEnabled={false}
      >
        {polylineCoords.length > 1 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor={colors.primary}
            strokeWidth={2.5}
            lineDashPattern={[8, 6]}
            tappable
            onPress={() => {
              if (!trip.firstLegId) return;
              router.push({ pathname: '/leg', params: { legId: trip.firstLegId } });
            }}
          />
        )}
        {trip.stops.map((stop, index) => (
          <MapPin
            key={stop.id}
            stop={stop}
            index={index}
            isSelected={selectedStopId === stop.id}
            onPress={() => handleStopSelect(stop)}
          />
        ))}
      </MapView>

      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <Animated.View style={styles.topBar} entering={FadeInDown.delay(100).springify()} pointerEvents="box-none">
          <View style={styles.topBarPill} pointerEvents="none">
            <Text style={styles.topBarLabel}>UPCOMING</Text>
            <Text style={styles.topBarTitle}>{trip.name}</Text>
            <Text style={styles.topBarDates}>{trip.dateRange}</Text>
          </View>
          <Pressable style={styles.settingsButton} onPress={() => router.push('/settings')} hitSlop={8}>
            <Feather name="user" size={18} color={colors.text} />
          </Pressable>
        </Animated.View>
      </SafeAreaView>

      <Animated.View style={styles.bottomSheet} entering={FadeInUp.delay(200).springify()}>
        <View style={styles.bottomHandle} />
        <Text style={styles.bottomLabel}>
          {trip.stops.length} {trip.stops.length === 1 ? 'stop' : 'stops'}
          {totalNights > 0 ? ` · ${totalNights} nights` : ''}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          {trip.stops.map((stop, index) => (
            <CityChip
              key={stop.id}
              stop={stop}
              index={index}
              isSelected={selectedStopId === stop.id}
              onPress={() => handleStopSelect(stop)}
            />
          ))}
        </ScrollView>
        <Pressable
          style={styles.viewTripButton}
          onPress={() => {
            if (selectedStop) {
              router.push({ pathname: '/stop-detail', params: { stopId: selectedStop.id } });
            } else {
              router.push({ pathname: '/trip-detail', params: { tripId: trip.id } });
            }
          }}
        >
          <Text style={styles.viewTripLabel}>
            {selectedStop ? 'View stop details' : 'View trip details'}
          </Text>
          <Feather name="arrow-right" size={15} color={colors.primary} />
        </Pressable>
      </Animated.View>

      <QuickCaptureFAB />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // Error
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12, textAlign: 'center' },
  retryButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },

  // Empty
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  emptyHeading: {
    fontFamily: fonts.displayBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.2, marginBottom: 8, textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.body, fontSize: 15, color: colors.textMuted,
    textAlign: 'center', lineHeight: 22, marginBottom: 28,
  },
  emptyButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14,
  },
  emptyButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },

  // Top bar
  topBar: {
    paddingHorizontal: 20, paddingTop: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  settingsButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  topBarPill: {
    alignSelf: 'flex-start', backgroundColor: colors.white, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  topBarLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.2, color: colors.accent, marginBottom: 2 },
  topBarTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text, letterSpacing: -0.2 },
  topBarDates: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 2 },

  // Pins
  pinWrapper: { alignItems: 'center' },
  pin: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.white, borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  pinSelected: { backgroundColor: colors.primary },
  pinNumber: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary },
  pinNumberSelected: { color: colors.white },
  pinTail: { width: 2, height: 6, backgroundColor: colors.primary, borderRadius: 1, marginTop: -1 },
  pinTailSelected: { backgroundColor: colors.primary },
  pinLabel: { marginTop: 4, backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pinLabelText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.white },

  // Bottom sheet
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 12,
  },
  bottomHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 },
  bottomLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, letterSpacing: 0.3, paddingHorizontal: 20, marginBottom: 12 },
  chipsScroll: { paddingHorizontal: 16, gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.background, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipNumber: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted },
  chipNumberSelected: { color: 'rgba(255,255,255,0.7)' },
  chipCity: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  chipCitySelected: { color: colors.white },
  chipNights: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  chipNightsSelected: { color: 'rgba(255,255,255,0.65)' },
  viewTripButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 16, paddingTop: 14, marginHorizontal: 20,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  viewTripLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },


});
