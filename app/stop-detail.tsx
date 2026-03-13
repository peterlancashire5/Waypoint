import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import { parsePdfBooking, readUriAsBase64, type ParsedBooking, type FlightBooking, type AccommodationBooking } from '@/lib/claude';
import BookingPreviewSheet, { type StopOption } from '@/components/BookingPreviewSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StopDetail {
  id: string;
  city: string;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  nights: number | null;
  trip_id: string;
  trips: {
    name: string;
    start_date: string | null;
    end_date: string | null;
  } | null;
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

function computeNights(stop: StopDetail): number | null {
  if (stop.nights !== null) return stop.nights;
  if (!stop.start_date || !stop.end_date) return null;
  const s = new Date(stop.start_date + 'T00:00:00');
  const e = new Date(stop.end_date + 'T00:00:00');
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SegmentTabs({ active, onChange }: { active: string; onChange: (t: string) => void }) {
  const tabs = ['Logistics', 'Days', 'Saved'];
  return (
    <View style={styles.segmentWrapper}>
      <View style={styles.segmentTrack}>
        {tabs.map((tab) => (
          <Pressable
            key={tab}
            style={[styles.segmentTab, active === tab && styles.segmentTabActive]}
            onPress={() => onChange(tab)}
          >
            <Text style={[styles.segmentLabel, active === tab && styles.segmentLabelActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <View style={styles.placeholderWrap}>
      <Feather name="clock" size={28} color={colors.border} />
      <Text style={styles.placeholderHeading}>{label}</Text>
      <Text style={styles.placeholderBody}>Coming soon</Text>
    </View>
  );
}

// ─── Saved booking cards ──────────────────────────────────────────────────────

function SavedFlightCard({ booking }: { booking: FlightBooking }) {
  return (
    <View style={styles.savedCard}>
      <View style={styles.savedCardIconWrap}>
        <Feather name="send" size={16} color={colors.primary} />
      </View>
      <View style={styles.savedCardBody}>
        <View style={styles.savedCardTitleRow}>
          <Text style={styles.savedCardTitle}>
            {booking.origin_city || '—'} → {booking.destination_city || '—'}
          </Text>
          {booking.booking_ref ? (
            <View style={styles.refBadge}>
              <Text style={styles.refBadgeText}>{booking.booking_ref}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.savedCardMeta}>
          {[
            booking.airline,
            booking.flight_number,
            booking.departure_date ? shortDate(booking.departure_date) : null,
            booking.departure_time || null,
            booking.seat ? `Seat ${booking.seat}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

function SavedAccommodationCard({ booking }: { booking: AccommodationBooking }) {
  const nights = booking.nights;
  return (
    <View style={styles.savedCard}>
      <View style={styles.savedCardIconWrap}>
        <Feather name="home" size={16} color={colors.primary} />
      </View>
      <View style={styles.savedCardBody}>
        <View style={styles.savedCardTitleRow}>
          <Text style={styles.savedCardTitle}>{booking.hotel_name || '—'}</Text>
          {booking.booking_ref ? (
            <View style={styles.refBadge}>
              <Text style={styles.refBadgeText}>{booking.booking_ref}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.savedCardMeta}>
          {[
            booking.check_in_date ? `Check-in ${shortDate(booking.check_in_date)}` : null,
            nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

// ─── Upload card ──────────────────────────────────────────────────────────────

function UploadCard({
  icon,
  title,
  subtitle,
  loading,
  onPress,
  onDevTest,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  subtitle: string;
  loading: boolean;
  onPress: () => void;
  onDevTest?: () => void;
}) {
  return (
    <View>
      <Pressable
        style={({ pressed }) => [styles.uploadCard, pressed && styles.uploadCardPressed]}
        onPress={onPress}
        disabled={loading}
      >
        <View style={styles.uploadCardIcon}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name={icon} size={20} color={colors.primary} />
          )}
        </View>
        <View style={styles.uploadCardBody}>
          <Text style={styles.uploadCardTitle}>{loading ? 'Parsing PDF…' : title}</Text>
          <Text style={styles.uploadCardSubtitle}>{loading ? 'This may take a moment' : subtitle}</Text>
        </View>
        {!loading && <Feather name="plus" size={18} color={colors.primary} />}
      </Pressable>
      {__DEV__ && onDevTest && (
        <Pressable style={styles.devButton} onPress={onDevTest}>
          <Text style={styles.devButtonText}>DEV: inject test data</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Dev test fixtures ────────────────────────────────────────────────────────

const DEV_FLIGHT: ParsedBooking = {
  type: 'flight',
  airline: 'Thai Airways',
  flight_number: 'TG661',
  origin_city: 'Bangkok',
  destination_city: 'Chiang Mai',
  departure_date: '2025-04-02',
  departure_time: '09:15',
  arrival_date: '2025-04-02',
  arrival_time: '10:25',
  booking_ref: 'XK9A4T',
  seat: '14A',
};

const DEV_ACCOMMODATION: ParsedBooking = {
  type: 'accommodation',
  hotel_name: 'The Dhara Dhevi',
  city: 'Chiang Mai',
  check_in_date: '2025-04-02',
  check_out_date: '2025-04-05',
  booking_ref: 'HB-38821',
  nights: 3,
};

// ─── Logistics tab ────────────────────────────────────────────────────────────

function LogisticsTab({
  savedBookings,
  onPickFlight,
  onPickAccommodation,
  onDevFlight,
  onDevAccommodation,
  parsingFlight,
  parsingAccommodation,
}: {
  savedBookings: ParsedBooking[];
  onPickFlight: () => void;
  onPickAccommodation: () => void;
  onDevFlight: () => void;
  onDevAccommodation: () => void;
  parsingFlight: boolean;
  parsingAccommodation: boolean;
}) {
  const flights = savedBookings.filter((b): b is FlightBooking => b.type === 'flight');
  const accommodations = savedBookings.filter((b): b is AccommodationBooking => b.type === 'accommodation');

  return (
    <ScrollView
      style={styles.flex1}
      contentContainerStyle={styles.logisticsContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Saved flights */}
      {flights.length > 0 && (
        <>
          <Text style={styles.logisticsSectionLabel}>Flights</Text>
          {flights.map((b, i) => (
            <SavedFlightCard key={i} booking={b} />
          ))}
        </>
      )}

      {/* Saved accommodation */}
      {accommodations.length > 0 && (
        <>
          <Text style={[styles.logisticsSectionLabel, flights.length > 0 && styles.sectionLabelSpaced]}>
            Accommodation
          </Text>
          {accommodations.map((b, i) => (
            <SavedAccommodationCard key={i} booking={b} />
          ))}
        </>
      )}

      {/* Upload cards */}
      <Text style={[styles.logisticsSectionLabel, savedBookings.length > 0 && styles.sectionLabelSpaced]}>
        Add booking
      </Text>
      <UploadCard
        icon="send"
        title="Add flight"
        subtitle="Upload a flight confirmation PDF"
        loading={parsingFlight}
        onPress={onPickFlight}
        onDevTest={onDevFlight}
      />
      <UploadCard
        icon="home"
        title="Add accommodation"
        subtitle="Upload a hotel or rental confirmation PDF"
        loading={parsingAccommodation}
        onPress={onPickAccommodation}
        onDevTest={onDevAccommodation}
      />
    </ScrollView>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StopDetailScreen() {
  const router = useRouter();
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('Logistics');

  // Saved bookings shown in the Logistics tab
  const [savedBookings, setSavedBookings] = useState<ParsedBooking[]>([]);

  // PDF parsing state
  const [parsingFlight, setParsingFlight] = useState(false);
  const [parsingAccommodation, setParsingAccommodation] = useState(false);
  const [parsedBooking, setParsedBooking] = useState<ParsedBooking | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Fetch stop + existing saved bookings ──────────────────────────────────

  useEffect(() => {
    const fetchAll = async () => {
      if (!stopId) { setError('No stop specified.'); setLoading(false); return; }

      const { data, error: fetchError } = await supabase
        .from('stops')
        .select('*, trips(name, start_date, end_date)')
        .eq('id', stopId)
        .single();

      if (fetchError || !data) {
        setError('Could not load this stop.');
        setLoading(false);
        return;
      }

      const stopData = data as StopDetail;
      setStop(stopData);
      setLoading(false);

      // Load previously saved bookings for this stop
      await loadSavedBookings(stopData);
    };
    fetchAll();
  }, [stopId]);

  async function loadSavedBookings(stopData: StopDetail) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    const items: ParsedBooking[] = [];

    // Accommodation saved to this stop
    const { data: accs, error: accErr } = await supabase
      .from('accommodation')
      .select('id, name, confirmation_ref')
      .eq('stop_id', stopData.id)
      .eq('owner_id', userId);

    if (accErr) console.warn('[logistics] accommodation fetch error:', accErr.message);

    for (const a of accs ?? []) {
      items.push({
        type: 'accommodation',
        hotel_name: (a as any).name ?? '',
        city: stopData.city,
        check_in_date: stopData.start_date ?? '',
        check_out_date: stopData.end_date ?? '',
        booking_ref: (a as any).confirmation_ref ?? '',
        nights: null,
      });
    }

    // Flights: leg_bookings for legs terminating at this stop
    const { data: inboundLegs, error: legErr } = await supabase
      .from('legs')
      .select('id, from_stop:from_stop_id(city)')
      .eq('trip_id', stopData.trip_id)
      .eq('to_stop_id', stopData.id);

    if (legErr) console.warn('[logistics] legs fetch error:', legErr.message);

    if ((inboundLegs ?? []).length > 0) {
      const legIds = (inboundLegs as any[]).map((l) => l.id);
      const { data: lbs, error: lbErr } = await supabase
        .from('leg_bookings')
        .select('*')
        .in('leg_id', legIds)
        .eq('owner_id', userId);

      if (lbErr) console.warn('[logistics] leg_bookings fetch error:', lbErr.message);

      for (const lb of lbs ?? []) {
        const leg = (inboundLegs as any[]).find((l) => l.id === lb.leg_id);
        items.push({
          type: 'flight',
          airline: lb.operator ?? '',
          flight_number: lb.reference ?? '',
          origin_city: leg?.from_stop?.city ?? '',
          destination_city: stopData.city,
          departure_date: '',
          departure_time: '',
          arrival_date: '',
          arrival_time: '',
          booking_ref: lb.confirmation_ref ?? '',
          seat: lb.seat ?? null,
        });
      }
    }

    setSavedBookings(items);
  }

  // ── PDF pick + parse ───────────────────────────────────────────────────────

  async function handlePickPdf(type: 'flight' | 'accommodation') {
    const setter = type === 'flight' ? setParsingFlight : setParsingAccommodation;
    setter(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const base64 = await readUriAsBase64(result.assets[0].uri);
      const booking = await parsePdfBooking(base64);
      setParsedBooking(booking);
      setPreviewVisible(true);
    } catch (err: any) {
      Alert.alert('Could not read booking', err?.message ?? 'Please try again.');
    } finally {
      setter(false);
    }
  }

  // ── Save booking ──────────────────────────────────────────────────────────

  async function handleSave(booking: ParsedBooking, selectedStopId: string | null) {
    console.log('[handleSave] fired', { type: booking.type, selectedStopId });
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not authenticated.');

      if (booking.type === 'accommodation' && selectedStopId) {
        console.log('[handleSave] inserting accommodation', booking.hotel_name);
        const { error: insertErr } = await supabase.from('accommodation').insert({
          stop_id: selectedStopId,
          owner_id: userId,
          name: booking.hotel_name,
          confirmation_ref: booking.booking_ref || null,
          // check_in / check_out are time-of-day fields; dates come from the stop
        });
        if (insertErr) throw new Error(insertErr.message);
        console.log('[handleSave] accommodation saved OK');

      } else if (booking.type === 'flight') {
        // Try to find the inbound leg for this stop
        const { data: inboundLegs } = await supabase
          .from('legs')
          .select('id')
          .eq('trip_id', stop?.trip_id ?? '')
          .eq('to_stop_id', selectedStopId ?? stop?.id ?? '');

        const matchedLeg = (inboundLegs ?? [])[0] as any;

        if (matchedLeg) {
          console.log('[handleSave] inserting leg_booking for leg', matchedLeg.id);
          const { error: lbErr } = await supabase.from('leg_bookings').insert({
            leg_id: matchedLeg.id,
            owner_id: userId,
            operator: booking.airline,
            reference: booking.flight_number,
            seat: booking.seat,
            confirmation_ref: booking.booking_ref,
          });
          if (lbErr) throw new Error(lbErr.message);
          console.log('[handleSave] leg_booking saved OK');
        } else {
          console.log('[handleSave] no inbound leg found, falling back to saved_items');
          const { error: siErr } = await supabase.from('saved_items').insert({
            stop_id: selectedStopId ?? stop?.id ?? null,
            creator_id: userId,
            name: `${booking.airline} ${booking.flight_number}`,
            category: 'Transport',
            note: `Flight ${booking.origin_city} → ${booking.destination_city} on ${booking.departure_date}. Ref: ${booking.booking_ref}`,
          });
          if (siErr) throw new Error(siErr.message);
          console.log('[handleSave] saved_items fallback saved OK');
        }

      } else {
        console.log('[handleSave] inserting other/saved_item');
        const { error: siErr } = await supabase.from('saved_items').insert({
          stop_id: selectedStopId ?? stop?.id ?? null,
          creator_id: userId,
          name: booking.type === 'other' ? booking.description : 'Booking document',
          note: booking.type === 'other' ? (booking.description ?? '') : '',
        });
        if (siErr) throw new Error(siErr.message);
      }

      // Optimistically add to the displayed list
      setSavedBookings((prev) => [...prev, booking]);

      setPreviewVisible(false);
      setParsedBooking(null);
    } catch (err: any) {
      console.error('[handleSave] error:', err?.message);
      Alert.alert('Could not save booking', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
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

  if (error || !stop) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <SafeAreaView edges={['top']} style={styles.safeTop}>
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
              <Feather name="arrow-left" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.headerText} />
            <View style={styles.headerAction} />
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

  const nights = computeNights(stop);
  const dateRange = formatDateRange(stop.start_date, stop.end_date);
  const metaParts = [stop.country, dateRange, nights !== null ? `${nights} nights` : null].filter(Boolean);

  const stopOption: StopOption = {
    id: stop.id,
    city: stop.city,
    tripName: stop.trips?.name ?? 'Trip',
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerCity}>{stop.city}</Text>
            <Text style={styles.headerMeta}>{metaParts.join(' · ')}</Text>
          </View>
          <Pressable style={styles.headerAction} hitSlop={8}>
            <Feather name="more-horizontal" size={22} color={colors.text} />
          </Pressable>
        </View>
        <SegmentTabs active={activeTab} onChange={setActiveTab} />
      </SafeAreaView>

      {activeTab === 'Logistics' && (
        <LogisticsTab
          savedBookings={savedBookings}
          onPickFlight={() => handlePickPdf('flight')}
          onPickAccommodation={() => handlePickPdf('accommodation')}
          onDevFlight={() => { setParsedBooking(DEV_FLIGHT); setPreviewVisible(true); }}
          onDevAccommodation={() => { setParsedBooking(DEV_ACCOMMODATION); setPreviewVisible(true); }}
          parsingFlight={parsingFlight}
          parsingAccommodation={parsingAccommodation}
        />
      )}
      {activeTab === 'Days' && <PlaceholderTab label="Days" />}
      {activeTab === 'Saved' && <PlaceholderTab label="Saved" />}

      <BookingPreviewSheet
        visible={previewVisible}
        booking={parsedBooking}
        stops={[stopOption]}
        saving={saving}
        onSave={handleSave}
        onDiscard={() => { setPreviewVisible(false); setParsedBooking(null); }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  flex1: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  headerText: { flex: 1, alignItems: 'center' },
  headerCity: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text, letterSpacing: -0.2 },
  headerMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 1 },
  headerAction: { width: 36, alignItems: 'flex-end' },

  segmentWrapper: { paddingHorizontal: 16, paddingBottom: 12 },
  segmentTrack: {
    flexDirection: 'row', backgroundColor: colors.background,
    borderRadius: 10, padding: 3,
  },
  segmentTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segmentTabActive: {
    backgroundColor: colors.white,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  segmentLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.textMuted },
  segmentLabelActive: { color: colors.primary },

  logisticsContent: { padding: 16, paddingBottom: 40 },
  logisticsSectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 10,
  },
  sectionLabelSpaced: { marginTop: 24 },

  // Saved booking cards
  savedCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  savedCardIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#EBF3F6',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  savedCardBody: { flex: 1 },
  savedCardTitleRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: 8, marginBottom: 4,
  },
  savedCardTitle: {
    fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text,
    flex: 1,
  },
  savedCardMeta: {
    fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, lineHeight: 18,
  },
  refBadge: {
    backgroundColor: colors.background, borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: colors.border,
  },
  refBadgeText: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.textMuted, letterSpacing: 0.3 },

  // Upload cards
  uploadCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  uploadCardPressed: { opacity: 0.85 },
  uploadCardIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#EBF3F6',
    alignItems: 'center', justifyContent: 'center',
  },
  uploadCardBody: { flex: 1 },
  uploadCardTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text, marginBottom: 2 },
  uploadCardSubtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  devButton: {
    alignSelf: 'flex-end', marginTop: 4, marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, backgroundColor: '#FFE8A3',
  },
  devButtonText: { fontFamily: fonts.body, fontSize: 11, color: '#7A5C00' },

  placeholderWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingBottom: 60, gap: 10,
  },
  placeholderHeading: {
    fontFamily: fonts.displayBold, fontSize: 18, color: colors.text, letterSpacing: -0.2,
  },
  placeholderBody: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12, textAlign: 'center' },
  retryButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },
});
