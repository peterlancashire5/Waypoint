import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import QuickCaptureFAB from '@/components/QuickCaptureFAB';
import { useNetworkStatus } from '@/context/NetworkContext';
import { readTripListCache, writeTripListCache } from '@/lib/offlineCache';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripSummary {
  id: string;
  name: string;
  status: 'Upcoming' | 'Past';
  dateRange: string;
  stopCount: number;
  chips: string[];
  collaboratorCount: number;
}

interface DbTrip {
  id: string;
  name: string;
  type: 'single' | 'multi';
  start_date: string | null;
  end_date: string | null;
  status: 'upcoming' | 'active' | 'past';
  created_at: string;
  stops: { city: string }[];
  trip_members: { user_id: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return '—';
  const s = new Date(start + 'T00:00:00');
  const sStr = `${s.getDate()} ${MONTHS[s.getMonth()]}`;
  if (!end) return sStr;
  const e = new Date(end + 'T00:00:00');
  const eStr = `${e.getDate()} ${MONTHS[e.getMonth()]}`;
  if (s.getFullYear() !== e.getFullYear()) {
    return `${sStr} ${s.getFullYear()} – ${eStr} ${e.getFullYear()}`;
  }
  return `${sStr} – ${eStr}`;
}

function toTripSummary(t: DbTrip): TripSummary {
  return {
    id: t.id,
    name: t.name,
    status: t.status === 'past' ? 'Past' : 'Upcoming',
    dateRange: formatDateRange(t.start_date, t.end_date),
    stopCount: t.stops.length,
    chips: t.stops.map((s) => s.city).filter(Boolean),
    collaboratorCount: t.trip_members.length,
  };
}

// ─── Components ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: 'Upcoming' | 'Past' }) {
  const isUpcoming = status === 'Upcoming';
  return (
    <View style={[styles.pill, isUpcoming ? styles.pillUpcoming : styles.pillPast]}>
      <Text style={[styles.pillLabel, isUpcoming ? styles.pillLabelUpcoming : styles.pillLabelPast]}>
        {status}
      </Text>
    </View>
  );
}

function TripCard({ trip, onPress }: { trip: TripSummary; onPress?: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardTopLeft}>
          <StatusPill status={trip.status} />
          <Text style={styles.cardTitle}>{trip.name}</Text>
        </View>
        <Feather name="arrow-right" size={18} color={colors.border} />
      </View>

      <View style={styles.cardMeta}>
        <Feather name="calendar" size={13} color={colors.textMuted} />
        <Text style={styles.cardDateRange}>{trip.dateRange || '—'}</Text>
        <Text style={styles.cardDot}>·</Text>
        <Feather name="map-pin" size={13} color={colors.textMuted} />
        <Text style={styles.cardStops}>
          {trip.stopCount} {trip.stopCount === 1 ? 'stop' : 'stops'}
        </Text>
        {trip.collaboratorCount > 0 && (
          <>
            <Text style={styles.cardDot}>·</Text>
            <Feather name="users" size={13} color={colors.textMuted} />
            <Text style={styles.cardShared}>Shared</Text>
          </>
        )}
      </View>

      {trip.chips.length > 0 && (
        <View style={styles.chips}>
          {trip.chips.map((c) => (
            <View key={c} style={styles.chip}>
              <Text style={styles.chipText}>{c}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function EmptyState({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <Feather name="map" size={30} color={colors.textMuted} />
      </View>
      <Text style={styles.emptyHeading}>No trips yet</Text>
      <Text style={styles.emptySubtitle}>Tap the button above to plan your first trip</Text>
      <Pressable style={styles.emptyButton} onPress={onPress}>
        <Feather name="plus" size={16} color={colors.white} />
        <Text style={styles.emptyButtonText}>Create a trip</Text>
      </Pressable>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripsScreen() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isOnline, onlineRefreshTrigger, showOfflineToast } = useNetworkStatus();

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError(null);

    // ── Offline fallback ──────────────────────────────────────────────────────
    if (!isOnline) {
      const cached = await readTripListCache<TripSummary[]>();
      if (cached) {
        setTrips(cached);
      } else {
        setError('No saved data available.');
      }
      setLoading(false);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) { setLoading(false); return; }

    // Query 1: trips owned by this user
    const { data: ownedData, error: ownedError } = await supabase
      .from('trips')
      .select('*, stops(city), trip_members(user_id)')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (ownedError) {
      setError('Could not load trips.');
      setLoading(false);
      return;
    }

    // Query 2: trips where user is a non-owner member
    const { data: memberRows } = await supabase
      .from('trip_members')
      .select('trip_id')
      .eq('user_id', user.id);

    const memberTripIds = (memberRows ?? []).map((r: { trip_id: string }) => r.trip_id);

    let sharedData: DbTrip[] = [];
    if (memberTripIds.length > 0) {
      const { data } = await supabase
        .from('trips')
        .select('*, stops(city), trip_members(user_id)')
        .in('id', memberTripIds)
        .order('created_at', { ascending: false });
      sharedData = (data ?? []) as DbTrip[];
    }

    // Merge: owned first, then shared trips not already in owned set
    const ownedIds = new Set((ownedData ?? []).map((t: DbTrip) => t.id));
    const allTrips = [
      ...(ownedData ?? []) as DbTrip[],
      ...sharedData.filter((t) => !ownedIds.has(t.id)),
    ];

    const summaries = allTrips.map(toTripSummary);
    setTrips(summaries);
    setLoading(false);

    // Write to cache in background (fire and forget)
    writeTripListCache(summaries).catch(() => {});
  }, [isOnline, onlineRefreshTrigger]);

  useFocusEffect(
    useCallback(() => {
      fetchTrips();
    }, [fetchTrips])
  );

  const upcoming = trips.filter((t) => t.status === 'Upcoming');
  const past = trips.filter((t) => t.status === 'Past');

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Trips</Text>
          <Pressable
            style={[styles.addButton, !isOnline && { opacity: 0.4 }]}
            hitSlop={8}
            onPress={() => {
              if (!isOnline) { showOfflineToast(); return; }
              router.push('/create-trip');
            }}
          >
            <Feather name="plus" size={22} color={colors.primary} />
          </Pressable>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={fetchTrips} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : trips.length === 0 ? (
        <EmptyState onPress={() => router.push('/create-trip')} />
      ) : (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {upcoming.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Upcoming</Text>
              {upcoming.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onPress={() => router.push({ pathname: '/trip-detail', params: { tripId: trip.id } })}
                />
              ))}
            </>
          )}

          {past.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, upcoming.length > 0 && styles.sectionLabelSpaced]}>
                Past trips
              </Text>
              {past.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onPress={() => router.push({ pathname: '/trip-detail', params: { tripId: trip.id } })}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
      <QuickCaptureFAB />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  flex1: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
  },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.text, letterSpacing: -0.3 },
  addButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#EBF3F6', alignItems: 'center', justifyContent: 'center',
  },

  scrollContent: { padding: 16, paddingBottom: 32 },

  sectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 10,
  },
  sectionLabelSpaced: { marginTop: 28 },

  card: {
    backgroundColor: colors.white, borderRadius: 16,
    padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  cardPressed: { opacity: 0.85 },
  cardTop: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: 10,
  },
  cardTopLeft: { flex: 1, gap: 6 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text, letterSpacing: -0.2 },

  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12 },
  cardDateRange: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
  cardDot: { fontFamily: fonts.body, fontSize: 13, color: colors.border },
  cardStops: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: colors.background, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  chipText: { fontFamily: fonts.body, fontSize: 12, color: colors.text },

  pill: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillUpcoming: { backgroundColor: '#EBF3F6' },
  pillPast: { backgroundColor: colors.background },
  pillLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
  pillLabelUpcoming: { color: colors.primary },
  pillLabelPast: { color: colors.textMuted },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  retryButton: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },

  emptyWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, paddingBottom: 60,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyHeading: {
    fontFamily: fonts.displayBold, fontSize: 22, color: colors.text,
    letterSpacing: -0.2, marginBottom: 8, textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.body, fontSize: 14, color: colors.textMuted,
    textAlign: 'center', lineHeight: 20, marginBottom: 24,
  },
  emptyButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 14,
  },
  emptyButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },
  cardShared: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
});
