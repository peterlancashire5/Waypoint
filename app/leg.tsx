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

interface LegBooking {
  id: string;
  operator: string | null;
  reference: string | null;
  seat: string | null;
  confirmation_ref: string | null;
}

interface LegDetail {
  id: string;
  transport_type: TransportType | null;
  departure_time: string | null;
  arrival_time: string | null;
  from_stop: { city: string; country: string | null } | null;
  to_stop: { city: string; country: string | null } | null;
  leg_bookings: LegBooking[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatTime(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDate(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function computeDuration(dep: string | null, arr: string | null): string {
  if (!dep || !arr) return '';
  const ms = new Date(arr).getTime() - new Date(dep).getTime();
  if (ms <= 0) return '';
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function transportLabel(type: TransportType | null): string {
  if (!type) return 'Transfer';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function referenceLabel(type: TransportType | null): string {
  if (type === 'flight') return 'Flight number';
  if (type === 'train') return 'Train number';
  if (type === 'bus') return 'Service number';
  return 'Reference';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TransportIcon({ type, size = 20, color = colors.primary }: {
  type: TransportType | null;
  size?: number;
  color?: string;
}) {
  const iconMap: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
    flight: 'airplane',
    train: 'train',
    bus: 'bus',
    ferry: 'ferry',
    car: 'car',
    other: 'dots-horizontal',
  };
  const name = (type && iconMap[type]) ? iconMap[type] : 'dots-horizontal';
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

function InfoRow({ icon, label, value, mono = false }: {
  icon: string;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon as any} size={15} color={colors.textMuted} style={styles.infoIcon} />
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, mono && styles.infoValueMono]}>{value}</Text>
      </View>
    </View>
  );
}

function RouteTimeline({ leg }: { leg: LegDetail }) {
  const duration = computeDuration(leg.departure_time, leg.arrival_time);
  return (
    <View style={styles.routeTimeline}>
      <View style={styles.routeEndpoint}>
        <Text style={styles.routeTime}>{formatTime(leg.departure_time)}</Text>
        <Text style={styles.routeCity}>{leg.from_stop?.city ?? '—'}</Text>
        {leg.from_stop?.country && (
          <Text style={styles.routeCountry}>{leg.from_stop.country}</Text>
        )}
      </View>
      <View style={styles.routeMiddle}>
        <View style={styles.routeDot} />
        <View style={styles.routeLine} />
        <TransportIcon type={leg.transport_type} size={18} color={colors.primary} />
        <View style={styles.routeLine} />
        <View style={styles.routeDot} />
        {duration ? <Text style={styles.routeDuration}>{duration}</Text> : null}
      </View>
      <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
        <Text style={styles.routeTime}>{formatTime(leg.arrival_time)}</Text>
        <Text style={styles.routeCity}>{leg.to_stop?.city ?? '—'}</Text>
        {leg.to_stop?.country && (
          <Text style={[styles.routeCountry, styles.routeCountryRight]}>{leg.to_stop.country}</Text>
        )}
      </View>
    </View>
  );
}

function EmptyBooking() {
  return (
    <View style={styles.emptyBooking}>
      <Feather name="file-text" size={24} color={colors.border} />
      <Text style={styles.emptyBookingHeading}>No booking added yet</Text>
      <Text style={styles.emptyBookingBody}>Add a flight, train or transfer</Text>
    </View>
  );
}

function BookingCard({ booking, type }: { booking: LegBooking; type: TransportType | null }) {
  const hasAny = booking.operator || booking.reference || booking.seat || booking.confirmation_ref;
  if (!hasAny) return <EmptyBooking />;
  return (
    <>
      {booking.operator && (
        <InfoRow icon="tag" label="Operator" value={booking.operator} />
      )}
      {booking.reference && (
        <InfoRow icon="hash" label={referenceLabel(type)} value={booking.reference} />
      )}
      {booking.seat && (
        <InfoRow icon="user" label="Seat" value={booking.seat} />
      )}
      {booking.confirmation_ref && (
        <InfoRow icon="file-text" label="Confirmation" value={booking.confirmation_ref} mono />
      )}
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LegScreen() {
  const router = useRouter();
  const { legId } = useLocalSearchParams<{ legId: string }>();
  const [leg, setLeg] = useState<LegDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeg = async () => {
      if (!legId) {
        setError('No leg specified.');
        setLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('legs')
        .select('*, from_stop:from_stop_id(city, country), to_stop:to_stop_id(city, country), leg_bookings(*)')
        .eq('id', legId)
        .single();

      if (fetchError || !data) {
        setError('Could not load this leg.');
      } else {
        setLeg(data as LegDetail);
      }
      setLoading(false);
    };

    fetchLeg();
  }, [legId]);

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
  if (error || !leg) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.handleBar}><View style={styles.handle} /></View>
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error ?? 'Something went wrong.'}</Text>
        </View>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <Pressable style={styles.closeButton} onPress={() => router.back()}>
            <Text style={styles.closeButtonLabel}>Close</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const fromCity = leg.from_stop?.city ?? '—';
  const toCity = leg.to_stop?.city ?? '—';
  const date = formatDate(leg.departure_time);
  const duration = computeDuration(leg.departure_time, leg.arrival_time);
  const booking = leg.leg_bookings[0] ?? null;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.handleBar}><View style={styles.handle} /></View>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.transportBadge}>
              <TransportIcon type={leg.transport_type} size={14} color={colors.primary} />
              <Text style={styles.transportLabel}>{transportLabel(leg.transport_type)}</Text>
            </View>
          </View>
          <Text style={styles.routeTitle}>{fromCity} → {toCity}</Text>
          {(date || duration) ? (
            <Text style={styles.routeMeta}>
              {[date, duration].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>

        {/* Route timeline card */}
        <View style={styles.card}>
          <RouteTimeline leg={leg} />
        </View>

        {/* Booking details card */}
        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>Booking details</Text>
          <View style={styles.divider} />
          {booking ? (
            <BookingCard booking={booking} type={leg.transport_type} />
          ) : (
            <EmptyBooking />
          )}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.closeButton} onPress={() => router.back()}>
          <Text style={styles.closeButtonLabel}>Close</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  flex1: { flex: 1 },

  handleBar: { paddingTop: 12, paddingBottom: 4, alignItems: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },

  scrollContent: { padding: 20, paddingBottom: 8 },

  // Header
  header: { marginBottom: 20 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  transportBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#EBF3F6', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  transportLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary },
  routeTitle: {
    fontFamily: fonts.displayBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.3, marginBottom: 4,
  },
  routeMeta: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },

  // Cards
  card: {
    backgroundColor: colors.white, borderRadius: 16, marginBottom: 16,
    borderWidth: 1, borderColor: colors.border,
    padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  cardSectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase',
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },

  // Route timeline
  routeTimeline: { flexDirection: 'row', alignItems: 'flex-start' },
  routeEndpoint: { flex: 1 },
  routeEndpointRight: { alignItems: 'flex-end' },
  routeTime: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.text, letterSpacing: -0.3 },
  routeCity: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text, marginTop: 3 },
  routeCountry: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginTop: 1 },
  routeCountryRight: { textAlign: 'right' },
  routeMiddle: {
    flex: 1, alignItems: 'center', gap: 4, paddingTop: 8, paddingHorizontal: 8,
  },
  routeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  routeLine: { flex: 1, width: 1, backgroundColor: colors.border, minHeight: 12 },
  routeDuration: {
    fontFamily: fonts.body, fontSize: 11, color: colors.textMuted,
    marginTop: 4, textAlign: 'center',
  },

  // Info rows
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  infoIcon: { marginTop: 1, marginRight: 10, width: 16 },
  infoContent: { flex: 1 },
  infoLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginBottom: 1 },
  infoValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  infoValueMono: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.5 },

  // Empty booking
  emptyBooking: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  emptyBookingHeading: {
    fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text,
  },
  emptyBookingBody: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  // Loading / error
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, textAlign: 'center' },

  // Footer
  footer: {
    paddingHorizontal: 20, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12,
  },
  closeButton: {
    backgroundColor: colors.background, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  closeButtonLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
});
