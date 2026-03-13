import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import {
  parseBookingFile,
  readUriAsBase64,
  mediaTypeFromUri,
  type ParsedBooking,
  type TransportBooking,
  type AccommodationBooking,
} from '@/lib/claude';
import BookingPreviewSheet, { transportIcon, type StopOption } from '@/components/BookingPreviewSheet';
import ManualTransportSheet from '@/components/ManualTransportSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

// ParsedBooking extended with DB row id and source table so booking-detail knows
// where to fetch/edit/delete from.
type SavedBookingItem = ParsedBooking & {
  _dbId: string;
  _source: 'accommodation' | 'leg_bookings' | 'saved_items';
};

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
  // Prefer calculating from dates — the stored nights column can be stale
  if (stop.start_date && stop.end_date) {
    const s = new Date(stop.start_date + 'T00:00:00');
    const e = new Date(stop.end_date + 'T00:00:00');
    const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : null;
  }
  return stop.nights;
}

function computeNightsFromDates(start: string, end: string): number | null {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
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

function SavedTransportCard({ booking, onPress }: { booking: TransportBooking; onPress: () => void }) {
  const icon = transportIcon(booking.transport_type);
  return (
    <Pressable
      style={({ pressed }) => [styles.savedCard, pressed && styles.savedCardPressed]}
      onPress={onPress}
    >
      <View style={styles.savedCardIconWrap}>
        <Feather name={icon} size={16} color={colors.primary} />
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
            booking.operator,
            booking.service_number,
            booking.departure_date ? shortDate(booking.departure_date) : null,
            booking.departure_time || null,
            booking.seat ? `Seat ${booking.seat}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

function SavedAccommodationCard({ booking, onPress }: { booking: AccommodationBooking; onPress: () => void }) {
  const nights = booking.nights;
  return (
    <Pressable
      style={({ pressed }) => [styles.savedCard, pressed && styles.savedCardPressed]}
      onPress={onPress}
    >
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
            (booking.check_in_date || booking.check_out_date)
              ? formatDateRange(booking.check_in_date || null, booking.check_out_date || null)
              : null,
            nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
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
          <Text style={styles.uploadCardTitle}>{loading ? 'Parsing…' : title}</Text>
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

// ─── Transport source picker modal ────────────────────────────────────────────

function TransportSourceModal({
  visible,
  onUpload,
  onManual,
  onClose,
}: {
  visible: boolean;
  onUpload: () => void;
  onManual: () => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.sourceOverlay} />
      </TouchableWithoutFeedback>
      <View style={styles.sourceSheet}>
        <View style={styles.sourceHandle} />
        <Text style={styles.sourceTitle}>Add transport</Text>
        <Pressable
          style={({ pressed }) => [styles.sourceOption, pressed && styles.sourceOptionPressed]}
          onPress={() => { onClose(); onUpload(); }}
        >
          <View style={styles.sourceOptionIcon}>
            <Feather name="upload" size={18} color={colors.primary} />
          </View>
          <View style={styles.sourceOptionBody}>
            <Text style={styles.sourceOptionTitle}>Upload a file</Text>
            <Text style={styles.sourceOptionSub}>PDF, JPG or PNG booking confirmation</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.sourceOption, pressed && styles.sourceOptionPressed]}
          onPress={() => { onClose(); onManual(); }}
        >
          <View style={styles.sourceOptionIcon}>
            <Feather name="edit-2" size={18} color={colors.primary} />
          </View>
          <View style={styles.sourceOptionBody}>
            <Text style={styles.sourceOptionTitle}>Enter manually</Text>
            <Text style={styles.sourceOptionSub}>Type in booking details yourself</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
    </Modal>
  );
}

// ─── Dev test fixtures ────────────────────────────────────────────────────────

const DEV_FLIGHT: ParsedBooking = {
  type: 'transport',
  transport_type: 'flight',
  operator: 'Thai Airways',
  service_number: 'TG661',
  origin_city: 'Bangkok',
  destination_city: 'Chiang Mai',
  departure_date: '2025-04-02',
  departure_time: '09:15',
  arrival_date: '2025-04-02',
  arrival_time: '10:25',
  booking_ref: 'XK9A4T',
  seat: '14A',
  gate: 'B7', terminal: 'T1',
  coach: null, platform: null, origin_station: null, destination_station: null,
  pickup_point: null,
  deck: null, cabin: null, port_terminal: null,
};

const DEV_TRAIN: ParsedBooking = {
  type: 'transport',
  transport_type: 'train',
  operator: 'Eurostar',
  service_number: '9001',
  origin_city: 'London',
  destination_city: 'Paris',
  departure_date: '2025-04-10',
  departure_time: '08:31',
  arrival_date: '2025-04-10',
  arrival_time: '11:47',
  booking_ref: 'ES-88472',
  seat: '42C',
  gate: null, terminal: null,
  coach: 'Coach 3', platform: '5', origin_station: 'St Pancras International', destination_station: 'Paris Gare du Nord',
  pickup_point: null,
  deck: null, cabin: null, port_terminal: null,
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
  onPickTransport,
  onPickAccommodation,
  onDevFlight,
  onDevTrain,
  onDevAccommodation,
  parsingTransport,
  parsingAccommodation,
  onBookingPress,
}: {
  savedBookings: SavedBookingItem[];
  onPickTransport: () => void;
  onPickAccommodation: () => void;
  onDevFlight: () => void;
  onDevTrain: () => void;
  onDevAccommodation: () => void;
  parsingTransport: boolean;
  parsingAccommodation: boolean;
  onBookingPress: (booking: SavedBookingItem) => void;
}) {
  const transports = savedBookings.filter((b): b is SavedBookingItem & TransportBooking => b.type === 'transport');
  const accommodations = savedBookings.filter((b): b is SavedBookingItem & AccommodationBooking => b.type === 'accommodation');

  return (
    <ScrollView
      style={styles.flex1}
      contentContainerStyle={styles.logisticsContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Saved transport */}
      {transports.length > 0 && (
        <>
          <Text style={styles.logisticsSectionLabel}>Transport</Text>
          {transports.map((b, i) => (
            <SavedTransportCard key={i} booking={b} onPress={() => onBookingPress(b)} />
          ))}
        </>
      )}

      {/* Saved accommodation */}
      {accommodations.length > 0 && (
        <>
          <Text style={[styles.logisticsSectionLabel, transports.length > 0 && styles.sectionLabelSpaced]}>
            Accommodation
          </Text>
          {accommodations.map((b, i) => (
            <SavedAccommodationCard key={i} booking={b} onPress={() => onBookingPress(b)} />
          ))}
        </>
      )}

      {/* Upload cards */}
      <Text style={[styles.logisticsSectionLabel, savedBookings.length > 0 && styles.sectionLabelSpaced]}>
        Add booking
      </Text>
      <UploadCard
        icon="send"
        title="Add transport"
        subtitle="Upload a booking confirmation"
        loading={parsingTransport}
        onPress={onPickTransport}
        onDevTest={onDevFlight}
      />
      {__DEV__ && (
        <Pressable style={[styles.devButton, { alignSelf: 'flex-end', marginTop: -4, marginBottom: 8 }]} onPress={onDevTrain}>
          <Text style={styles.devButtonText}>DEV: inject train data</Text>
        </Pressable>
      )}
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
  const [savedBookings, setSavedBookings] = useState<SavedBookingItem[]>([]);

  // Transport source picker
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false);
  const [manualSheetVisible, setManualSheetVisible] = useState(false);

  // PDF/image parsing state
  const [parsingTransport, setParsingTransport] = useState(false);
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

    const items: SavedBookingItem[] = [];

    // Accommodation saved to this stop
    const { data: accs, error: accErr } = await supabase
      .from('accommodation')
      .select('id, name, confirmation_ref, check_in_date, check_out_date')
      .eq('stop_id', stopData.id)
      .eq('owner_id', userId);

    if (accErr) console.warn('[logistics] accommodation fetch error:', accErr.message);

    for (const a of accs ?? []) {
      const checkInDate: string = (a as any).check_in_date ?? '';
      const checkOutDate: string = (a as any).check_out_date ?? '';
      // Compute nights from the booking's own dates; fall back to the stop's dates
      const nights = checkInDate && checkOutDate
        ? computeNightsFromDates(checkInDate, checkOutDate)
        : computeNights(stopData);
      items.push({
        _dbId: (a as any).id,
        _source: 'accommodation',
        type: 'accommodation',
        hotel_name: (a as any).name ?? '',
        city: stopData.city,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        booking_ref: (a as any).confirmation_ref ?? '',
        nights,
      });
    }

    // Transport: leg_bookings for legs terminating at this stop
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
          _dbId: lb.id,
          _source: 'leg_bookings',
          type: 'transport',
          transport_type: 'flight', // legacy leg_bookings don't store transport_type
          operator: lb.operator ?? '',
          service_number: lb.reference ?? '',
          origin_city: leg?.from_stop?.city ?? '',
          destination_city: stopData.city,
          departure_date: '',
          departure_time: '',
          arrival_date: '',
          arrival_time: '',
          booking_ref: lb.confirmation_ref ?? '',
          seat: lb.seat ?? null,
          gate: null, terminal: null,
          coach: null, platform: null, origin_station: null, destination_station: null,
          pickup_point: null,
          deck: null, cabin: null, port_terminal: null,
        });
      }
    }

    // Fallback transport saved to saved_items (no matching leg at save time)
    const { data: savedTransports, error: sfErr } = await supabase
      .from('saved_items')
      .select('id, note')
      .eq('stop_id', stopData.id)
      .eq('creator_id', userId)
      .eq('category', 'Transport');

    if (sfErr) console.warn('[logistics] saved_items transport fetch error:', sfErr.message);

    for (const sf of savedTransports ?? []) {
      try {
        const parsed = JSON.parse((sf as any).note ?? '{}');
        if (!parsed.origin_city) continue; // not our JSON format
        items.push({
          _dbId: (sf as any).id,
          _source: 'saved_items',
          type: 'transport',
          transport_type: parsed.transport_type ?? 'flight',
          operator: parsed.operator ?? parsed.airline ?? '',
          service_number: parsed.service_number ?? parsed.flight_number ?? '',
          origin_city: parsed.origin_city ?? '',
          destination_city: parsed.destination_city ?? '',
          departure_date: parsed.departure_date ?? '',
          departure_time: parsed.departure_time ?? '',
          arrival_date: parsed.arrival_date ?? '',
          arrival_time: parsed.arrival_time ?? '',
          booking_ref: parsed.booking_ref ?? '',
          seat: parsed.seat ?? null,
          gate: parsed.gate ?? null, terminal: parsed.terminal ?? null,
          coach: parsed.coach ?? null, platform: parsed.platform ?? null,
          origin_station: parsed.origin_station ?? null, destination_station: parsed.destination_station ?? null,
          pickup_point: parsed.pickup_point ?? null,
          deck: parsed.deck ?? null, cabin: parsed.cabin ?? null, port_terminal: parsed.port_terminal ?? null,
        });
      } catch {
        // note wasn't our JSON — skip
      }
    }

    setSavedBookings(items);
  }

  // Reload saved bookings whenever this screen comes back into focus (e.g. after
  // returning from booking-detail where a booking may have been deleted).
  useFocusEffect(
    useCallback(() => {
      if (!stop) return;
      loadSavedBookings(stop);
    }, [stop]),
  );

  // ── Navigate to booking detail ─────────────────────────────────────────────

  function handleBookingPress(booking: SavedBookingItem) {
    router.push({
      pathname: '/booking-detail',
      params: { type: booking.type, id: booking._dbId, source: booking._source },
    });
  }

  // ── File pick + parse ──────────────────────────────────────────────────────

  async function handlePickFile(bookingType: 'transport' | 'accommodation') {
    const setter = bookingType === 'transport' ? setParsingTransport : setParsingAccommodation;
    setter(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const mediaType = mediaTypeFromUri(asset.uri, asset.mimeType);
      const base64 = await readUriAsBase64(asset.uri);
      const booking = await parseBookingFile(base64, mediaType);
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
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not authenticated.');

      if (booking.type === 'accommodation' && selectedStopId) {
        const { error: insertErr } = await supabase.from('accommodation').insert({
          stop_id: selectedStopId,
          owner_id: userId,
          name: booking.hotel_name,
          confirmation_ref: booking.booking_ref || null,
          check_in_date: booking.check_in_date || null,
          check_out_date: booking.check_out_date || null,
        });
        if (insertErr) throw new Error(insertErr.message);

      } else if (booking.type === 'transport') {
        // Try to find the inbound leg for this stop
        const { data: inboundLegs } = await supabase
          .from('legs')
          .select('id')
          .eq('trip_id', stop?.trip_id ?? '')
          .eq('to_stop_id', selectedStopId ?? stop?.id ?? '');

        const matchedLeg = (inboundLegs ?? [])[0] as any;

        if (matchedLeg) {
          const { error: lbErr } = await supabase.from('leg_bookings').insert({
            leg_id: matchedLeg.id,
            owner_id: userId,
            operator: booking.operator,
            reference: booking.service_number,
            seat: booking.seat,
            confirmation_ref: booking.booking_ref,
          });
          if (lbErr) throw new Error(lbErr.message);
        } else {
          const transportLabel = booking.transport_type === 'flight' ? booking.service_number
            : booking.transport_type === 'train' ? `Train ${booking.service_number}`
            : booking.transport_type === 'bus' ? `Bus ${booking.service_number}`
            : `Ferry ${booking.service_number}`;
          const { error: siErr } = await supabase.from('saved_items').insert({
            stop_id: selectedStopId ?? stop?.id ?? null,
            creator_id: userId,
            name: `${booking.operator} ${transportLabel}`.trim(),
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
              gate: booking.gate,
              terminal: booking.terminal,
              coach: booking.coach,
              platform: booking.platform,
              origin_station: booking.origin_station,
              destination_station: booking.destination_station,
              pickup_point: booking.pickup_point,
              deck: booking.deck,
              cabin: booking.cabin,
              port_terminal: booking.port_terminal,
            }),
          });
          if (siErr) throw new Error(siErr.message);
        }

      } else {
        const { error: siErr } = await supabase.from('saved_items').insert({
          stop_id: selectedStopId ?? stop?.id ?? null,
          creator_id: userId,
          name: booking.type === 'other' ? booking.description : 'Booking document',
          note: booking.type === 'other' ? (booking.description ?? '') : '',
        });
        if (siErr) throw new Error(siErr.message);
      }

      // Reload from DB so the new item gets its proper _dbId
      if (stop) await loadSavedBookings(stop);

      setPreviewVisible(false);
      setManualSheetVisible(false);
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
          onPickTransport={() => setSourcePickerVisible(true)}
          onPickAccommodation={() => handlePickFile('accommodation')}
          onDevFlight={() => { setParsedBooking(DEV_FLIGHT); setPreviewVisible(true); }}
          onDevTrain={() => { setParsedBooking(DEV_TRAIN); setPreviewVisible(true); }}
          onDevAccommodation={() => { setParsedBooking(DEV_ACCOMMODATION); setPreviewVisible(true); }}
          parsingTransport={parsingTransport}
          parsingAccommodation={parsingAccommodation}
          onBookingPress={handleBookingPress}
        />
      )}
      {activeTab === 'Days' && <PlaceholderTab label="Days" />}
      {activeTab === 'Saved' && <PlaceholderTab label="Saved" />}

      {/* Transport source picker */}
      <TransportSourceModal
        visible={sourcePickerVisible}
        onUpload={() => handlePickFile('transport')}
        onManual={() => setManualSheetVisible(true)}
        onClose={() => setSourcePickerVisible(false)}
      />

      {/* Manual transport entry */}
      <ManualTransportSheet
        visible={manualSheetVisible}
        stops={[stopOption]}
        saving={saving}
        onSave={handleSave}
        onDiscard={() => setManualSheetVisible(false)}
      />

      {/* AI-parsed booking preview */}
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
  savedCardPressed: { opacity: 0.85 },
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

  // Transport source modal
  sourceOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sourceSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20, paddingBottom: 40,
  },
  sourceHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16,
  },
  sourceTitle: {
    fontFamily: fonts.displayBold, fontSize: 20,
    color: colors.text, letterSpacing: -0.2, marginBottom: 16,
  },
  sourceOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.background, borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  sourceOptionPressed: { opacity: 0.8 },
  sourceOptionIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#EBF3F6', alignItems: 'center', justifyContent: 'center',
  },
  sourceOptionBody: { flex: 1 },
  sourceOptionTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text, marginBottom: 2 },
  sourceOptionSub: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

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
