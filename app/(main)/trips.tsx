import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { getTrips, type StoredTrip } from '@/lib/tripStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripSummary {
  id: string;
  name: string;
  status: 'Upcoming' | 'Past';
  dateRange: string;
  stopCount: number;
  chips: string[];
  route?: string | null;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_TRIPS: TripSummary[] = [
  {
    id: 't1',
    name: 'Southeast Asia',
    status: 'Upcoming',
    dateRange: '14 Mar – 8 Apr',
    stopCount: 5,
    chips: ['Thailand', 'Laos', 'Vietnam'],
    route: '/(main)/',
  },
  {
    id: 't2',
    name: 'Japan Winter',
    status: 'Past',
    dateRange: '10 Jan – 22 Jan',
    stopCount: 4,
    chips: ['Japan'],
  },
  {
    id: 't3',
    name: 'Portugal Road Trip',
    status: 'Past',
    dateRange: '3 Sep – 12 Sep 2025',
    stopCount: 3,
    chips: ['Portugal'],
  },
];

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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripsScreen() {
  const router = useRouter();
  const [userTrips, setUserTrips] = useState<StoredTrip[]>([]);

  useFocusEffect(
    useCallback(() => {
      setUserTrips(getTrips());
    }, [])
  );

  const upcoming = MOCK_TRIPS.filter((t) => t.status === 'Upcoming');
  const past = MOCK_TRIPS.filter((t) => t.status === 'Past');

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Trips</Text>
          <Pressable style={styles.addButton} hitSlop={8} onPress={() => router.push('/create-trip')}>
            <Feather name="plus" size={22} color={colors.primary} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Upcoming</Text>

        {/* User-created trips first */}
        {userTrips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}

        {/* Mock upcoming trips */}
        {upcoming.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            onPress={trip.route ? () => router.push(trip.route as any) : undefined}
          />
        ))}

        <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Past trips</Text>
        {past.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </ScrollView>
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
});
