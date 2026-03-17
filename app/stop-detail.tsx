import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  fetchPlacesForStop,
  savePlaceToStop,
  type SavedPlace,
} from '@/lib/savedPlaceUtils';
import PlaceDetailSheet from '@/components/PlaceDetailSheet';
import type { PlaceCategory } from '@/lib/placesEnrichment';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import {
  parseBookingFile,
  readAndPrepareBase64,
  mediaTypeFromUri,
  type ParsedBooking,
  type ParsedContent,
  type TransportBooking,
  type AccommodationBooking,
} from '@/lib/claude';
import { checkDuplicate, confirmDuplicate } from '@/lib/duplicateCheck';
import { createTransportBooking, saveConnectionBooking, buildExtraData } from '@/lib/journeyUtils';
import BookingPreviewSheet, { transportIcon, type StopOption, type LegGapOption } from '@/components/BookingPreviewSheet';
import ManualTransportSheet from '@/components/ManualTransportSheet';
import ManualAccommodationSheet, { type ManualAccommodationData } from '@/components/ManualAccommodationSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// Suggestion to apply accommodation dates to the stop (shown as a banner)
interface DateSuggestion {
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

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

function computeNights(stop: StopDetail): number | null {
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

function buildHeaderMeta(stop: StopDetail): string {
  const dateRange = formatDateRange(stop.start_date, stop.end_date);
  const nights = computeNights(stop);
  const parts = [
    stop.country,
    dateRange,
    nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SegmentTabs({
  active,
  onChange,
  savedCount,
}: {
  active: string;
  onChange: (t: string) => void;
  savedCount: number;
}) {
  const tabs = ['Logistics', 'Days', 'Saved'];
  return (
    <View style={styles.segmentWrapper}>
      <View style={styles.segmentTrack}>
        {tabs.map((tab) => {
          const label =
            tab === 'Saved' && savedCount > 0 ? `Saved (${savedCount})` : tab;
          return (
            <Pressable
              key={tab}
              style={[styles.segmentTab, active === tab && styles.segmentTabActive]}
              onPress={() => onChange(tab)}
            >
              <Text style={[styles.segmentLabel, active === tab && styles.segmentLabelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
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

// ─── Stop action menu ─────────────────────────────────────────────────────────

function StopActionMenu({
  visible,
  onEditDates,
  onRename,
  onDelete,
  onClose,
}: {
  visible: boolean;
  onEditDates: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.menuOverlay} />
      </TouchableWithoutFeedback>
      <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.menuHandle} />
        <Pressable
          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          onPress={() => { onClose(); onEditDates(); }}
        >
          <Feather name="calendar" size={18} color={colors.text} style={styles.menuItemIcon} />
          <Text style={styles.menuItemText}>Edit dates</Text>
        </Pressable>
        <View style={styles.menuDivider} />
        <Pressable
          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          onPress={() => { onClose(); onRename(); }}
        >
          <Feather name="edit-2" size={18} color={colors.text} style={styles.menuItemIcon} />
          <Text style={styles.menuItemText}>Rename stop</Text>
        </Pressable>
        <View style={styles.menuDivider} />
        <Pressable
          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          onPress={() => { onClose(); onDelete(); }}
        >
          <Feather name="trash-2" size={18} color={colors.error} style={styles.menuItemIcon} />
          <Text style={[styles.menuItemText, { color: colors.error }]}>Delete stop</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ─── Edit dates sheet ─────────────────────────────────────────────────────────

function EditDatesSheet({
  visible,
  initialStart,
  initialEnd,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialStart: string | null;
  initialEnd: string | null;
  onSave: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [start, setStart] = useState(initialStart ?? '');
  const [end, setEnd] = useState(initialEnd ?? '');

  useEffect(() => {
    if (visible) {
      setStart(initialStart ?? '');
      setEnd(initialEnd ?? '');
    }
  }, [visible]);

  function handleSave() {
    onSave(start.trim(), end.trim());
  }

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.sheetOverlay} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavWrapper}
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Edit dates</Text>

          <View style={styles.datesCard}>
            <View style={styles.dateFieldRow}>
              <Text style={styles.dateFieldLabel}>Start date</Text>
              <TextInput
                style={styles.dateFieldInput}
                value={start}
                onChangeText={setStart}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.border}
                keyboardType="numbers-and-punctuation"
                returnKeyType="next"
              />
            </View>
            <View style={styles.dateDivider} />
            <View style={styles.dateFieldRow}>
              <Text style={styles.dateFieldLabel}>End date</Text>
              <TextInput
                style={styles.dateFieldInput}
                value={end}
                onChangeText={setEnd}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.border}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
            </View>
          </View>

          <View style={styles.sheetActions}>
            <Pressable
              style={({ pressed }) => [styles.sheetCancelBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.sheetSaveBtn, pressed && { opacity: 0.85 }]}
              onPress={handleSave}
            >
              <Text style={styles.sheetSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Rename sheet ─────────────────────────────────────────────────────────────

function RenameSheet({
  visible,
  initialCity,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialCity: string;
  onSave: (city: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [city, setCity] = useState(initialCity);

  useEffect(() => {
    if (visible) setCity(initialCity);
  }, [visible]);

  function handleSave() {
    const trimmed = city.trim();
    if (trimmed) onSave(trimmed);
  }

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.sheetOverlay} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavWrapper}
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Rename stop</Text>

          <View style={styles.datesCard}>
            <View style={styles.dateFieldRow}>
              <Text style={styles.dateFieldLabel}>City</Text>
              <TextInput
                style={styles.dateFieldInput}
                value={city}
                onChangeText={setCity}
                placeholder="City name"
                placeholderTextColor={colors.border}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
            </View>
          </View>

          <View style={styles.sheetActions}>
            <Pressable
              style={({ pressed }) => [styles.sheetCancelBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.sheetSaveBtn, pressed && { opacity: 0.85 }]}
              onPress={handleSave}
            >
              <Text style={styles.sheetSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Date suggestion banner ───────────────────────────────────────────────────

function DateSuggestionBanner({
  city,
  suggestion,
  onApply,
  onDismiss,
}: {
  city: string;
  suggestion: DateSuggestion;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const dateStr = formatDateRange(suggestion.startDate, suggestion.endDate);
  return (
    <View style={styles.suggestionBanner}>
      <Feather name="calendar" size={14} color={colors.primary} style={{ marginTop: 1 }} />
      <Text style={styles.suggestionText} numberOfLines={2}>
        <Text style={styles.suggestionBold}>{city}</Text>
        {' '}has no dates — use{' '}
        <Text style={styles.suggestionBold}>{dateStr}</Text>
        {' '}from this booking?
      </Text>
      <Pressable
        style={({ pressed }) => [styles.suggestionApply, pressed && { opacity: 0.75 }]}
        onPress={onApply}
        hitSlop={8}
      >
        <Text style={styles.suggestionApplyText}>Apply</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.suggestionDismiss, pressed && { opacity: 0.6 }]}
        onPress={onDismiss}
        hitSlop={8}
      >
        <Feather name="x" size={14} color={colors.textMuted} />
      </Pressable>
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

function accommodationTypeLabel(t: AccommodationBooking['accommodation_type']): string {
  switch (t) {
    case 'airbnb':      return 'Airbnb';
    case 'booking_com': return 'Booking.com';
    case 'hotels_com':  return 'Hotels.com';
    case 'hostel':      return 'Hostel';
    default:            return 'Hotel';
  }
}

function SavedAccommodationCard({ booking, onPress }: { booking: AccommodationBooking; onPress: () => void }) {
  const nights = booking.nights;
  const typeLabel = accommodationTypeLabel(booking.accommodation_type);
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
            typeLabel,
            (booking.check_in_date || booking.check_out_date)
              ? formatDateRange(booking.check_in_date || null, booking.check_out_date || null)
              : null,
            nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
        {booking.accommodation_type === 'airbnb' && (
          <>
            {booking.host_name ? (
              <Text style={styles.savedCardDetail}>Host: {booking.host_name}</Text>
            ) : null}
            {booking.access_code ? (
              <View style={styles.accessCodeRow}>
                <Feather name="key" size={12} color={colors.accent} />
                <Text style={styles.accessCodeText}>{booking.access_code}</Text>
              </View>
            ) : null}
            {booking.checkin_instructions ? (
              <Text style={styles.savedCardDetail} numberOfLines={2}>{booking.checkin_instructions}</Text>
            ) : null}
          </>
        )}
        {booking.accommodation_type === 'hostel' && (
          <>
            {booking.room_type ? (
              <Text style={styles.savedCardDetail}>{booking.room_type}</Text>
            ) : null}
            {booking.checkin_hours ? (
              <Text style={styles.savedCardDetail}>Check-in: {booking.checkin_hours}</Text>
            ) : null}
          </>
        )}
        {(booking.accommodation_type === 'hotel' || booking.accommodation_type === 'booking_com' || booking.accommodation_type === 'hotels_com') && booking.room_type ? (
          <Text style={styles.savedCardDetail}>{booking.room_type}</Text>
        ) : null}
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

// ─── Source picker modal (shared by transport and accommodation) ───────────────

function SourcePickerModal({
  visible,
  title,
  onUploadFile,
  onChoosePhoto,
  onTakePhoto,
  onManual,
  onClose,
}: {
  visible: boolean;
  title: string;
  onUploadFile: () => void;
  onChoosePhoto: () => void;
  onTakePhoto: () => void;
  onManual?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.sourceOverlay} />
      </TouchableWithoutFeedback>
      <View style={styles.sourceSheet}>
        <View style={styles.sourceHandle} />
        <Text style={styles.sourceTitle}>{title}</Text>

        <Pressable
          style={({ pressed }) => [styles.sourceOption, pressed && styles.sourceOptionPressed]}
          onPress={() => { onClose(); onUploadFile(); }}
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
          onPress={() => { onClose(); onChoosePhoto(); }}
        >
          <View style={styles.sourceOptionIcon}>
            <Feather name="image" size={18} color={colors.primary} />
          </View>
          <View style={styles.sourceOptionBody}>
            <Text style={styles.sourceOptionTitle}>Choose from photos</Text>
            <Text style={styles.sourceOptionSub}>Pick from your camera roll</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.sourceOption, pressed && styles.sourceOptionPressed]}
          onPress={() => { onClose(); onTakePhoto(); }}
        >
          <View style={styles.sourceOptionIcon}>
            <Feather name="camera" size={18} color={colors.primary} />
          </View>
          <View style={styles.sourceOptionBody}>
            <Text style={styles.sourceOptionTitle}>Take a photo</Text>
            <Text style={styles.sourceOptionSub}>Photograph a printed confirmation</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </Pressable>

        {onManual && (
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
        )}
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
  accommodation_type: 'hotel',
  hotel_name: 'The Dhara Dhevi',
  address: '51/4 Moo 1, Chiang Mai-Sankampaeng Road, Chiang Mai, Thailand',
  city: 'Chiang Mai',
  check_in_date: '2025-04-02',
  check_out_date: '2025-04-05',
  check_in_time: '14:00',
  check_out_time: '11:00',
  booking_ref: 'HB-38821',
  nights: 3,
  wifi_name: null,
  wifi_password: null,
  host_name: null,
  access_code: null,
  checkin_instructions: null,
  room_type: 'Deluxe Garden Suite',
  checkin_hours: null,
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
      {transports.length > 0 && (
        <>
          <Text style={styles.logisticsSectionLabel}>Transport</Text>
          {transports.map((b, i) => (
            <SavedTransportCard key={i} booking={b} onPress={() => onBookingPress(b)} />
          ))}
        </>
      )}

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

// ─── Saved Places tab ─────────────────────────────────────────────────────────

const PLACE_CATEGORIES: PlaceCategory[] = [
  'Restaurants', 'Bars', 'Museums', 'Activities', 'Sights', 'Shopping', 'Other',
];

type CategoryConfig = {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
};

const CATEGORY_CONFIG: Record<PlaceCategory, CategoryConfig> = {
  Restaurants: { icon: 'coffee',       iconBg: '#FBF0E8', iconColor: '#C07A4F', badgeBg: '#FBF0E8', badgeText: '#9A5C35' },
  Bars:        { icon: 'sunset',       iconBg: '#EDECF8', iconColor: '#5B5EA6', badgeBg: '#EDECF8', badgeText: '#3F4280' },
  Museums:     { icon: 'book-open',    iconBg: '#E8F2F5', iconColor: '#2C5F6E', badgeBg: '#E8F2F5', badgeText: '#2C5F6E' },
  Activities:  { icon: 'compass',      iconBg: '#E6F3EC', iconColor: '#2E7D5A', badgeBg: '#E6F3EC', badgeText: '#1E5C3F' },
  Sights:      { icon: 'camera',       iconBg: '#F8F0E0', iconColor: '#B07D2A', badgeBg: '#F8F0E0', badgeText: '#8A5F18' },
  Shopping:    { icon: 'shopping-bag', iconBg: '#F5EBF3', iconColor: '#8B4F7A', badgeBg: '#F5EBF3', badgeText: '#6A3A5B' },
  Other:       { icon: 'map-pin',      iconBg: '#EEECE9', iconColor: '#7A7570', badgeBg: '#EEECE9', badgeText: '#5A5550' },
};

// ── Place row ─────────────────────────────────────────────────────────────────

function PlaceRow({ place, onPress }: { place: SavedPlace; onPress: () => void }) {
  const cfg = place.category ? CATEGORY_CONFIG[place.category] : CATEGORY_CONFIG.Other;
  return (
    <Pressable
      style={({ pressed }) => [styles.placeRow, pressed && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <View style={[styles.placeIconWrap, { backgroundColor: cfg.iconBg }]}>
        <Feather name={cfg.icon} size={16} color={cfg.iconColor} />
      </View>
      <View style={styles.placeRowBody}>
        <Text style={styles.placeRowName} numberOfLines={1}>{place.name}</Text>
        {!!place.note && (
          <Text style={styles.placeRowNote} numberOfLines={2}>{place.note}</Text>
        )}
        {!place.note && !!place.address && (
          <Text style={styles.placeRowNote} numberOfLines={1}>{place.address}</Text>
        )}
      </View>
      {!!place.category && (
        <View style={[styles.categoryBadge, { backgroundColor: cfg.badgeBg }]}>
          <Text style={[styles.categoryBadgeText, { color: cfg.badgeText }]}>
            {place.category}
          </Text>
        </View>
      )}
      <Feather name="chevron-right" size={16} color={colors.border} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

// ── Add place sheet ───────────────────────────────────────────────────────────

function AddPlaceSheet({
  visible,
  stopId,
  tripId,
  onSaved,
  onClose,
}: {
  visible: boolean;
  stopId: string;
  tripId: string;
  onSaved: (place: SavedPlace) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PlaceCategory>('Restaurants');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setCategory('Restaurants');
      setNote('');
    }
  }, [visible]);

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter a place name.');
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not authenticated.');

      const place = await savePlaceToStop(
        { name: trimmedName, category, city: null, note: note.trim() || null },
        stopId,
        tripId,
        userId,
      );
      onSaved(place);
      onClose();
    } catch (err: any) {
      Alert.alert('Could not save place', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.sheetOverlay} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavWrapper}
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Add place</Text>

          {/* Name */}
          <View style={[styles.datesCard, { marginBottom: 14 }]}>
            <View style={styles.dateFieldRow}>
              <Text style={styles.dateFieldLabel}>Name</Text>
              <TextInput
                style={styles.dateFieldInput}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Noma, Louvre, Zara"
                placeholderTextColor={colors.border}
                autoFocus
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Category chips */}
          <Text style={styles.addPlaceFieldLabel}>Category</Text>
          <View style={styles.categoryChipGrid}>
            {PLACE_CATEGORIES.map((cat) => {
              const selected = category === cat;
              const cfg = CATEGORY_CONFIG[cat];
              return (
                <Pressable
                  key={cat}
                  style={[
                    styles.categoryChipOption,
                    selected && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                  onPress={() => setCategory(cat)}
                >
                  <Feather
                    name={cfg.icon}
                    size={13}
                    color={selected ? colors.white : cfg.iconColor}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[
                    styles.categoryChipOptionText,
                    selected && { color: colors.white },
                  ]}>
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Note */}
          <Text style={[styles.addPlaceFieldLabel, { marginTop: 14 }]}>Note (optional)</Text>
          <View style={[styles.datesCard, { marginBottom: 20 }]}>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Cuisine, opening hours, tips…"
              placeholderTextColor={colors.border}
              multiline
              returnKeyType="done"
              blurOnSubmit
            />
          </View>

          <View style={styles.sheetActions}>
            <Pressable
              style={({ pressed }) => [styles.sheetCancelBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.sheetSaveBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Text style={styles.sheetSaveText}>Save</Text>
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Saved tab ─────────────────────────────────────────────────────────────────

const FILTER_OPTIONS = ['All', ...PLACE_CATEGORIES];

function SavedTab({
  places,
  loading,
  stopId,
  tripId,
}: {
  places: SavedPlace[];
  loading: boolean;
  stopId: string;
  tripId: string;
  onPlaceAdded: (place: SavedPlace) => void;
}) {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [localPlaces, setLocalPlaces] = useState<SavedPlace[]>(places);

  // Sync when parent reloads
  useEffect(() => { setLocalPlaces(places); }, [places]);

  const filtered = activeFilter === 'All'
    ? localPlaces
    : localPlaces.filter((p) => p.category === activeFilter);

  return (
    <View style={styles.flex1}>
      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = opt === activeFilter;
          return (
            <Pressable
              key={opt}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setActiveFilter(opt)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* List */}
      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.savedPlacesContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.placesEmptyState}>
            <Feather name="bookmark" size={32} color={colors.border} />
            <Text style={styles.placesEmptyHeading}>No saved places yet</Text>
            <Text style={styles.placesEmptyBody}>
              Save a restaurant, bar, or sight from a screenshot
            </Text>
          </View>
        ) : (
          filtered.map((place) => (
            <PlaceRow
              key={place.id}
              place={place}
              onPress={() => router.push({ pathname: '/place-detail', params: { placeId: place.id } })}
            />
          ))
        )}

        {/* Add place manually */}
        <Pressable
          style={({ pressed }) => [styles.addPlaceButton, pressed && { opacity: 0.8 }]}
          onPress={() => setAddSheetVisible(true)}
        >
          <Feather name="plus" size={15} color={colors.primary} style={{ marginRight: 6 }} />
          <Text style={styles.addPlaceButtonText}>Add place manually</Text>
        </Pressable>
      </ScrollView>

      <AddPlaceSheet
        visible={addSheetVisible}
        stopId={stopId}
        tripId={tripId}
        onSaved={(place) => setLocalPlaces((prev) => [place, ...prev])}
        onClose={() => setAddSheetVisible(false)}
      />

    </View>
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

  // Saved places shown in the Saved tab
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savedPlacesLoaded, setSavedPlacesLoaded] = useState(false);

  // All stops in the same trip (for the "Save to stop" dropdown)
  const [tripStops, setTripStops] = useState<StopOption[]>([]);
  const [tripLegGaps, setTripLegGaps] = useState<LegGapOption[]>([]);

  // Stop action menu + edit sheets
  const [menuVisible, setMenuVisible] = useState(false);
  const [editDatesVisible, setEditDatesVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);

  // Suggestion banner (ephemeral — only shown after saving accommodation with dates)
  const [dateSuggestion, setDateSuggestion] = useState<DateSuggestion | null>(null);

  // Source picker modals
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false);
  const [accommodationSourcePickerVisible, setAccommodationSourcePickerVisible] = useState(false);
  const [manualSheetVisible, setManualSheetVisible] = useState(false);
  const [manualAccommodationSheetVisible, setManualAccommodationSheetVisible] = useState(false);

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

      // Fetch all stops in the same trip for the booking sheet dropdowns
      const { data: allStops } = await supabase
        .from('stops')
        .select('id, city')
        .eq('trip_id', stopData.trip_id)
        .order('order_index', { ascending: true });

      if (allStops) {
        setTripStops(
          (allStops as { id: string; city: string }[]).map((s) => ({
            id: s.id,
            city: s.city,
            tripName: stopData.trips?.name ?? 'Trip',
          }))
        );
      }

      // Load legs for this trip to build leg gap options for the transport picker
      const { data: tripLegs } = await supabase
        .from('legs')
        .select('id, from_stop_id, to_stop_id, from_stop:from_stop_id(city), to_stop:to_stop_id(city)')
        .eq('trip_id', stopData.trip_id)
        .order('order_index', { ascending: true });

      if (tripLegs) {
        const gaps: LegGapOption[] = (tripLegs as any[])
          .filter((l) => l.from_stop?.city && l.to_stop?.city && l.to_stop_id && l.from_stop_id)
          .map((l) => ({
            id: l.to_stop_id,
            fromStopId: l.from_stop_id,
            fromCity: l.from_stop.city,
            toCity: l.to_stop.city,
            tripName: stopData.trips?.name ?? 'Trip',
            tripId: stopData.trip_id,
          }));
        setTripLegGaps(gaps);
      }

      await loadSavedBookings(stopData);
      await loadSavedPlaces(stopData.id);
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
      .select('id, name, address, confirmation_ref, check_in_date, check_out_date, check_in, check_out, accommodation_type, host_name, access_code, checkin_instructions, room_type, checkin_hours')
      .eq('stop_id', stopData.id)
      .eq('owner_id', userId);

    if (accErr) console.warn('[logistics] accommodation fetch error:', accErr.message);

    for (const a of accs ?? []) {
      const checkInDate: string = (a as any).check_in_date ?? '';
      const checkOutDate: string = (a as any).check_out_date ?? '';
      const nights = checkInDate && checkOutDate
        ? computeNightsFromDates(checkInDate, checkOutDate)
        : computeNights(stopData);
      items.push({
        _dbId: (a as any).id,
        _source: 'accommodation',
        type: 'accommodation',
        accommodation_type: (a as any).accommodation_type ?? 'hotel',
        hotel_name: (a as any).name ?? '',
        address: (a as any).address ?? null,
        city: stopData.city,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        check_in_time: (a as any).check_in ?? null,
        check_out_time: (a as any).check_out ?? null,
        booking_ref: (a as any).confirmation_ref ?? '',
        nights,
        wifi_name: null,
        wifi_password: null,
        host_name: (a as any).host_name ?? null,
        access_code: (a as any).access_code ?? null,
        checkin_instructions: (a as any).checkin_instructions ?? null,
        room_type: (a as any).room_type ?? null,
        checkin_hours: (a as any).checkin_hours ?? null,
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
        .select('id, leg_id, journey_id, operator, reference, seat, confirmation_ref, leg_order')
        .in('leg_id', legIds)
        .eq('owner_id', userId);

      if (lbErr) console.warn('[logistics] leg_bookings fetch error:', lbErr.message);

      // Fetch journey details so connections show the correct overall cities
      const journeyIds = [
        ...new Set((lbs ?? []).map((lb: any) => lb.journey_id).filter(Boolean)),
      ] as string[];
      const journeyMap = new Map<string, { origin_city: string; destination_city: string }>();
      if (journeyIds.length > 0) {
        const { data: journeyRows } = await supabase
          .from('journeys')
          .select('id, origin_city, destination_city')
          .in('id', journeyIds);
        for (const j of journeyRows ?? []) {
          journeyMap.set((j as any).id, j as any);
        }
      }

      // Group by journey_id: show one card per journey (not one per leg_booking)
      const seenJourneys = new Set<string>();
      for (const lb of lbs ?? []) {
        const journeyId: string | null = (lb as any).journey_id ?? null;
        if (journeyId) {
          if (seenJourneys.has(journeyId)) continue; // skip duplicate legs of same connection
          seenJourneys.add(journeyId);
        }
        const leg = (inboundLegs as any[]).find((l) => l.id === (lb as any).leg_id);
        const journey = journeyId ? journeyMap.get(journeyId) : null;
        items.push({
          _dbId: (lb as any).id,
          _source: 'leg_bookings',
          type: 'transport',
          transport_type: 'flight',
          operator: (lb as any).operator ?? '',
          service_number: (lb as any).reference ?? '',
          origin_city: journey?.origin_city ?? leg?.from_stop?.city ?? '',
          destination_city: journey?.destination_city ?? stopData.city,
          departure_date: '',
          departure_time: '',
          arrival_date: '',
          arrival_time: '',
          booking_ref: (lb as any).confirmation_ref ?? '',
          seat: (lb as any).seat ?? null,
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

        // Connection bookings have a different JSON structure: { is_connection, legs: [...] }
        const isConnection = parsed.is_connection === true && Array.isArray(parsed.legs) && parsed.legs.length > 0;
        const firstLeg = isConnection ? parsed.legs[0] : parsed;
        const lastLeg  = isConnection ? parsed.legs[parsed.legs.length - 1] : parsed;

        const originCity: string = firstLeg?.origin_city ?? '';
        const destinationCity: string = lastLeg?.destination_city ?? '';
        if (!originCity) continue;

        items.push({
          _dbId: (sf as any).id,
          _source: 'saved_items',
          type: 'transport',
          transport_type: firstLeg?.transport_type ?? 'flight',
          operator: firstLeg?.operator ?? firstLeg?.airline ?? '',
          service_number: firstLeg?.service_number ?? firstLeg?.flight_number ?? '',
          origin_city: originCity,
          destination_city: destinationCity,
          departure_date: firstLeg?.departure_date ?? '',
          departure_time: firstLeg?.departure_time ?? '',
          arrival_date: lastLeg?.arrival_date ?? '',
          arrival_time: lastLeg?.arrival_time ?? '',
          booking_ref: parsed.booking_ref ?? firstLeg?.booking_ref ?? '',
          seat: firstLeg?.seat ?? null,
          gate: firstLeg?.gate ?? null, terminal: firstLeg?.terminal ?? null,
          coach: firstLeg?.coach ?? null, platform: firstLeg?.platform ?? null,
          origin_station: firstLeg?.origin_station ?? null, destination_station: lastLeg?.destination_station ?? null,
          pickup_point: firstLeg?.pickup_point ?? null,
          deck: firstLeg?.deck ?? null, cabin: firstLeg?.cabin ?? null, port_terminal: firstLeg?.port_terminal ?? null,
        });
      } catch {
        // note wasn't our JSON — skip
      }
    }

    setSavedBookings(items);
  }

  async function loadSavedPlaces(sid: string) {
    try {
      const places = await fetchPlacesForStop(sid);
      setSavedPlaces(places);
    } catch (err: any) {
      console.warn('[saved places] fetch error:', err?.message);
    } finally {
      setSavedPlacesLoaded(true);
    }
  }

  // Reload saved bookings and places on screen focus
  useFocusEffect(
    useCallback(() => {
      if (!stop) return;
      loadSavedBookings(stop);
      loadSavedPlaces(stop.id);
    }, [stop]),
  );

  // ── Stop management actions ───────────────────────────────────────────────

  async function handleSaveDates(startDate: string, endDate: string) {
    if (!stop) return;
    setEditDatesVisible(false);

    const { error: updateErr } = await supabase
      .from('stops')
      .update({ start_date: startDate || null, end_date: endDate || null })
      .eq('id', stop.id);

    if (updateErr) {
      Alert.alert('Could not save dates', updateErr.message);
      return;
    }

    setStop((prev) => prev ? { ...prev, start_date: startDate || null, end_date: endDate || null } : prev);
    // If we just applied a date suggestion, clear it
    setDateSuggestion(null);
  }

  async function handleRename(city: string) {
    if (!stop) return;
    setRenameVisible(false);

    const { error: updateErr } = await supabase
      .from('stops')
      .update({ city })
      .eq('id', stop.id);

    if (updateErr) {
      Alert.alert('Could not rename stop', updateErr.message);
      return;
    }

    setStop((prev) => prev ? { ...prev, city } : prev);
  }

  function handleDeleteStop() {
    if (!stop) return;
    Alert.alert(
      `Delete ${stop.city}?`,
      'This will permanently delete this stop and all its data. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDeleteStop },
      ],
    );
  }

  async function confirmDeleteStop() {
    if (!stop) return;

    // Delete legs that reference this stop before deleting the stop itself,
    // otherwise the FK constraint (stops ← legs) raises a violation.
    const { data: referencingLegs } = await supabase
      .from('legs')
      .select('id')
      .or(`from_stop_id.eq.${stop.id},to_stop_id.eq.${stop.id}`);

    if (referencingLegs && referencingLegs.length > 0) {
      const { error: legsErr } = await supabase
        .from('legs')
        .delete()
        .in('id', referencingLegs.map((l: any) => l.id));
      if (legsErr) {
        Alert.alert('Could not delete stop', legsErr.message);
        return;
      }
    }

    const { error: deleteErr } = await supabase.from('stops').delete().eq('id', stop.id);
    if (deleteErr) {
      Alert.alert('Could not delete stop', deleteErr.message);
      return;
    }
    router.back();
  }

  async function handleApplyDateSuggestion() {
    if (!stop || !dateSuggestion) return;
    await handleSaveDates(dateSuggestion.startDate, dateSuggestion.endDate);
  }

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
      console.log('[upload] uri:', asset.uri);
      console.log('[upload] mimeType from picker:', asset.mimeType);
      console.log('[upload] fileSize:', (asset as any).size ?? 'unknown');
      const rawMediaType = mediaTypeFromUri(asset.uri, asset.mimeType);
      console.log('[upload] detected mediaType:', rawMediaType);
      const { base64, mediaType } = await readAndPrepareBase64(asset.uri, rawMediaType);
      console.log('[upload] final mediaType after prepare:', mediaType);
      console.log('[upload] base64 length:', base64.length);
      console.log('[upload] sending as:', mediaType === 'application/pdf' ? 'PDF document' : 'image');
      const parsed: ParsedContent = await parseBookingFile(base64, mediaType);
      console.log('[upload] parsed result type:', parsed.type);
      if (parsed.type === 'place') {
        Alert.alert('Place detected', 'Use the Quick Capture button to save places to your trip.');
        return;
      }
      setParsedBooking(parsed);
      setPreviewVisible(true);
    } catch (err: any) {
      console.error('[upload] error:', err?.message, err);
      Alert.alert('Could not read booking', err?.message ?? 'Please try again.');
    } finally {
      setter(false);
    }
  }

  async function handleChoosePhoto(bookingType: 'transport' | 'accommodation') {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo library access required', 'Please enable photo library access in Settings.');
      return;
    }
    const setter = bookingType === 'transport' ? setParsingTransport : setParsingAccommodation;
    setter(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const rawMediaType = mediaTypeFromUri(asset.uri, asset.mimeType ?? undefined);
      const { base64, mediaType } = await readAndPrepareBase64(asset.uri, rawMediaType);
      const parsed: ParsedContent = await parseBookingFile(base64, mediaType);
      if (parsed.type === 'place') {
        Alert.alert('Place detected', 'Use the Quick Capture button to save places to your trip.');
        return;
      }
      setParsedBooking(parsed);
      setPreviewVisible(true);
    } catch (err: any) {
      Alert.alert('Could not read photo', err?.message ?? 'Please try again.');
    } finally {
      setter(false);
    }
  }

  async function handleTakePhoto(bookingType: 'transport' | 'accommodation') {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera access required', 'Please enable camera access in Settings.');
      return;
    }
    const setter = bookingType === 'transport' ? setParsingTransport : setParsingAccommodation;
    setter(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const rawMediaType = mediaTypeFromUri(asset.uri, asset.mimeType ?? undefined);
      const { base64, mediaType } = await readAndPrepareBase64(asset.uri, rawMediaType);
      const parsed: ParsedContent = await parseBookingFile(base64, mediaType);
      if (parsed.type === 'place') {
        Alert.alert('Place detected', 'Use the Quick Capture button to save places to your trip.');
        return;
      }
      setParsedBooking(parsed);
      setPreviewVisible(true);
    } catch (err: any) {
      Alert.alert('Could not take photo', err?.message ?? 'Please try again.');
    } finally {
      setter(false);
    }
  }

  // ── Save booking ──────────────────────────────────────────────────────────

  async function handleSave(booking: ParsedBooking, selectedStopId: string | null) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not authenticated.');

      const duplicate = await checkDuplicate(booking, userId);
      if (duplicate) {
        const proceed = await confirmDuplicate(duplicate);
        if (!proceed) return; // keep the sheet open
      }

      setSaving(true);

      if (booking.type === 'accommodation' && selectedStopId) {
        const { error: insertErr } = await supabase.from('accommodation').insert({
          stop_id: selectedStopId,
          owner_id: userId,
          name: booking.hotel_name,
          address: booking.address || null,
          confirmation_ref: booking.booking_ref || null,
          check_in_date: booking.check_in_date || null,
          check_out_date: booking.check_out_date || null,
          check_in: booking.check_in_time || null,
          check_out: booking.check_out_time || null,
          wifi_name: booking.wifi_name || null,
          wifi_password: booking.wifi_password || null,
          accommodation_type: booking.accommodation_type || 'hotel',
          host_name: booking.host_name || null,
          access_code: booking.access_code || null,
          checkin_instructions: booking.checkin_instructions || null,
          room_type: booking.room_type || null,
          checkin_hours: booking.checkin_hours || null,
        });
        if (insertErr) throw new Error(insertErr.message);

        // If the target stop has no dates but the booking does, show the suggestion banner
        const targetIsCurrentStop = selectedStopId === stop?.id;
        if (
          targetIsCurrentStop &&
          stop &&
          !stop.start_date &&
          !stop.end_date &&
          booking.check_in_date &&
          booking.check_out_date
        ) {
          setDateSuggestion({
            startDate: booking.check_in_date,
            endDate: booking.check_out_date,
          });
        }

      } else if (booking.type === 'transport') {
        const { data: inboundLegs } = await supabase
          .from('legs')
          .select('id, from_stop:from_stop_id(city)')
          .eq('trip_id', stop?.trip_id ?? '')
          .eq('to_stop_id', selectedStopId ?? stop?.id ?? '');

        const matchedLeg = (inboundLegs ?? [])[0] as any;

        if (matchedLeg) {
          await createTransportBooking({
            tripId: stop!.trip_id,
            legId: matchedLeg.id,
            originCity: booking.origin_city ?? matchedLeg.from_stop?.city ?? '',
            destinationCity: booking.destination_city ?? stop!.city ?? '',
            userId,
            operator: booking.operator,
            serviceNumber: booking.service_number,
            seat: booking.seat,
            confirmationRef: booking.booking_ref,
            departureDate: booking.departure_date ?? null,
            departureTime: booking.departure_time ?? null,
            arrivalDate: booking.arrival_date ?? null,
            arrivalTime: booking.arrival_time ?? null,
            extraData: buildExtraData(booking) ?? undefined,
          });
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

      } else if (booking.type === 'connection') {
        const firstLeg = booking.legs[0];
        const lastLeg  = booking.legs[booking.legs.length - 1];

        const { data: inboundLegs } = await supabase
          .from('legs')
          .select('id, from_stop:from_stop_id(city)')
          .eq('trip_id', stop?.trip_id ?? '')
          .eq('to_stop_id', selectedStopId ?? stop?.id ?? '');

        const matchedLeg = (inboundLegs ?? [])[0] as any;

        if (matchedLeg) {
          await saveConnectionBooking({
            tripId: stop!.trip_id,
            legId: matchedLeg.id,
            originCity: firstLeg?.origin_city ?? matchedLeg.from_stop?.city ?? '',
            destinationCity: lastLeg?.destination_city ?? stop!.city ?? '',
            userId,
            confirmationRef: booking.booking_ref,
            legs: booking.legs.map((leg) => ({
              originCity: leg.origin_city,
              destinationCity: leg.destination_city,
              operator: leg.operator ?? null,
              serviceNumber: leg.service_number ?? null,
              seat: leg.seat ?? null,
              legOrder: leg.leg_order,
              departureDate: leg.departure_date ?? null,
              departureTime: leg.departure_time ?? null,
              arrivalDate: leg.arrival_date ?? null,
              arrivalTime: leg.arrival_time ?? null,
              extraData: buildExtraData(leg) ?? undefined,
            })),
          });
        } else {
          const { error: siErr } = await supabase.from('saved_items').insert({
            stop_id: selectedStopId ?? stop?.id ?? null,
            creator_id: userId,
            name: `${firstLeg?.operator ?? ''} connection`.trim(),
            category: 'Transport',
            note: JSON.stringify({ is_connection: true, booking_ref: booking.booking_ref, legs: booking.legs }),
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

  // ── Manual accommodation save ─────────────────────────────────────────────

  async function handleSaveManualAccommodation(
    data: ManualAccommodationData,
    stopId: string | null,
  ) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not authenticated.');

      // Duplicate check using a minimal AccommodationBooking shape
      const fakeBooking: AccommodationBooking = {
        type: 'accommodation',
        accommodation_type: 'hotel',
        hotel_name: data.name,
        address: data.address,
        city: stop?.city ?? '',
        check_in_date: data.check_in_date ?? '',
        check_out_date: data.check_out_date ?? '',
        check_in_time: data.check_in_time ?? null,
        check_out_time: data.check_out_time ?? null,
        booking_ref: data.confirmation_ref ?? '',
        nights: null,
        wifi_name: data.wifi_name ?? null,
        wifi_password: data.wifi_password ?? null,
        host_name: null,
        access_code: null,
        checkin_instructions: null,
        room_type: null,
        checkin_hours: null,
      };
      const duplicate = await checkDuplicate(fakeBooking, userId);
      if (duplicate) {
        const proceed = await confirmDuplicate(duplicate);
        if (!proceed) return;
      }

      setSaving(true);
      const targetStopId = stopId ?? stop?.id ?? null;
      const { error: insertErr } = await supabase.from('accommodation').insert({
        stop_id: targetStopId,
        owner_id: userId,
        name: data.name || null,
        address: data.address || null,
        check_in_date: data.check_in_date || null,
        check_out_date: data.check_out_date || null,
        check_in: data.check_in_time || null,
        check_out: data.check_out_time || null,
        confirmation_ref: data.confirmation_ref || null,
        wifi_name: data.wifi_name || null,
        wifi_password: data.wifi_password || null,
        door_code: data.door_code || null,
      });
      if (insertErr) throw new Error(insertErr.message);

      if (stop) await loadSavedBookings(stop);
      setManualAccommodationSheetVisible(false);
    } catch (err: any) {
      Alert.alert('Could not save accommodation', err?.message ?? 'Please try again.');
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

  const headerMeta = buildHeaderMeta(stop);

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
            {headerMeta ? (
              <Text style={styles.headerMeta}>{headerMeta}</Text>
            ) : null}
          </View>
          <Pressable style={styles.headerAction} hitSlop={8} onPress={() => setMenuVisible(true)}>
            <Feather name="more-horizontal" size={22} color={colors.text} />
          </Pressable>
        </View>
        <SegmentTabs active={activeTab} onChange={setActiveTab} savedCount={savedPlaces.length} />
      </SafeAreaView>

      {/* Date suggestion banner — ephemeral, shown after saving accommodation to a dateless stop */}
      {dateSuggestion && (
        <DateSuggestionBanner
          city={stop.city}
          suggestion={dateSuggestion}
          onApply={handleApplyDateSuggestion}
          onDismiss={() => setDateSuggestion(null)}
        />
      )}

      {activeTab === 'Logistics' && (
        <LogisticsTab
          savedBookings={savedBookings}
          onPickTransport={() => setSourcePickerVisible(true)}
          onPickAccommodation={() => setAccommodationSourcePickerVisible(true)}
          onDevFlight={() => { setParsedBooking(DEV_FLIGHT); setPreviewVisible(true); }}
          onDevTrain={() => { setParsedBooking(DEV_TRAIN); setPreviewVisible(true); }}
          onDevAccommodation={() => { setParsedBooking(DEV_ACCOMMODATION); setPreviewVisible(true); }}
          parsingTransport={parsingTransport}
          parsingAccommodation={parsingAccommodation}
          onBookingPress={handleBookingPress}
        />
      )}
      {activeTab === 'Days' && <PlaceholderTab label="Days" />}
      {activeTab === 'Saved' && (
        <SavedTab
          places={savedPlaces}
          loading={!savedPlacesLoaded}
          stopId={stop.id}
          tripId={stop.trip_id}
          onPlaceAdded={(place) => setSavedPlaces((prev) => [place, ...prev])}
        />
      )}

      {/* Stop action menu */}
      <StopActionMenu
        visible={menuVisible}
        onEditDates={() => setEditDatesVisible(true)}
        onRename={() => setRenameVisible(true)}
        onDelete={handleDeleteStop}
        onClose={() => setMenuVisible(false)}
      />

      {/* Edit dates sheet */}
      <EditDatesSheet
        visible={editDatesVisible}
        initialStart={stop.start_date}
        initialEnd={stop.end_date}
        onSave={handleSaveDates}
        onClose={() => setEditDatesVisible(false)}
      />

      {/* Rename sheet */}
      <RenameSheet
        visible={renameVisible}
        initialCity={stop.city}
        onSave={handleRename}
        onClose={() => setRenameVisible(false)}
      />

      {/* Transport source picker */}
      <SourcePickerModal
        visible={sourcePickerVisible}
        title="Add transport"
        onUploadFile={() => handlePickFile('transport')}
        onChoosePhoto={() => handleChoosePhoto('transport')}
        onTakePhoto={() => handleTakePhoto('transport')}
        onManual={() => setManualSheetVisible(true)}
        onClose={() => setSourcePickerVisible(false)}
      />

      {/* Accommodation source picker */}
      <SourcePickerModal
        visible={accommodationSourcePickerVisible}
        title="Add accommodation"
        onUploadFile={() => handlePickFile('accommodation')}
        onChoosePhoto={() => handleChoosePhoto('accommodation')}
        onTakePhoto={() => handleTakePhoto('accommodation')}
        onManual={() => setManualAccommodationSheetVisible(true)}
        onClose={() => setAccommodationSourcePickerVisible(false)}
      />

      {/* Manual transport entry */}
      <ManualTransportSheet
        visible={manualSheetVisible}
        stops={tripStops}
        saving={saving}
        onSave={handleSave}
        onDiscard={() => setManualSheetVisible(false)}
      />

      {/* Manual accommodation entry */}
      <ManualAccommodationSheet
        visible={manualAccommodationSheetVisible}
        stops={tripStops}
        saving={saving}
        onSave={handleSaveManualAccommodation}
        onDiscard={() => setManualAccommodationSheetVisible(false)}
      />

      {/* AI-parsed booking preview */}
      <BookingPreviewSheet
        visible={previewVisible}
        booking={parsedBooking}
        stops={tripStops}
        legGaps={tripLegGaps}
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

  // Stop action menu
  menuOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  menuSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20,
  },
  menuHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16,
  },
  menuItemPressed: { opacity: 0.6 },
  menuItemIcon: { marginRight: 14 },
  menuItemText: { fontFamily: fonts.body, fontSize: 16, color: colors.text },
  menuDivider: { height: 1, backgroundColor: colors.border },

  // Edit dates / rename shared sheet
  sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  kavWrapper: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14,
  },
  sheetTitle: {
    fontFamily: fonts.displayBold, fontSize: 20,
    color: colors.text, letterSpacing: -0.2, marginBottom: 18,
  },
  datesCard: {
    backgroundColor: colors.white, borderRadius: 14, marginBottom: 20,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  dateFieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  dateFieldLabel: {
    fontFamily: fonts.body, fontSize: 14, color: colors.textMuted,
    width: 100, flexShrink: 0,
  },
  dateFieldInput: {
    flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.text,
    textAlign: 'right', padding: 0,
  },
  dateDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: 16 },
  sheetActions: { flexDirection: 'row', gap: 12 },
  sheetCancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetCancelText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.textMuted },
  sheetSaveBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 14,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  sheetSaveText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },

  // Date suggestion banner
  suggestionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EBF3F6', paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  suggestionText: {
    flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.text, lineHeight: 18,
  },
  suggestionBold: { fontFamily: fonts.bodyBold },
  suggestionApply: {
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: colors.primary, borderRadius: 8,
  },
  suggestionApplyText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.white },
  suggestionDismiss: { padding: 4 },

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
  savedCardDetail: {
    fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, lineHeight: 18, marginTop: 2,
  },
  accessCodeRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, marginTop: 4,
  },
  accessCodeText: {
    fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent, letterSpacing: 0.5,
  },

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

  // ── Saved Places tab ──────────────────────────────────────────────────────

  filterRow: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterRowContent: {
    paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.white,
  },
  filterChipActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
  },
  filterChipText: {
    fontFamily: fonts.body, fontSize: 13, color: colors.textMuted,
  },
  filterChipTextActive: {
    fontFamily: fonts.bodyBold, color: colors.white,
  },

  savedPlacesContent: { padding: 16, paddingBottom: 40 },

  placeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.white, borderRadius: 14,
    padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  placeIconWrap: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  placeRowBody: { flex: 1 },
  placeRowName: {
    fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text, marginBottom: 2,
  },
  placeRowNote: {
    fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, lineHeight: 18,
  },
  categoryBadge: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0,
  },
  categoryBadgeText: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.2,
  },

  placesEmptyState: {
    alignItems: 'center', paddingVertical: 60, gap: 10,
  },
  placesEmptyHeading: {
    fontFamily: fonts.displayBold, fontSize: 18, color: colors.text,
    letterSpacing: -0.2,
  },
  placesEmptyBody: {
    fontFamily: fonts.body, fontSize: 14, color: colors.textMuted,
    textAlign: 'center', paddingHorizontal: 32,
  },

  addPlaceButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 8, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    borderStyle: 'dashed', backgroundColor: colors.white,
  },
  addPlaceButtonText: {
    fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary,
  },

  // ── Add place sheet ───────────────────────────────────────────────────────

  addPlaceFieldLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 8,
  },
  categoryChipGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  categoryChipOption: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.white,
  },
  categoryChipOptionText: {
    fontFamily: fonts.body, fontSize: 13, color: colors.text,
  },
  noteInput: {
    fontFamily: fonts.body, fontSize: 14, color: colors.text,
    padding: 14, minHeight: 80, textAlignVertical: 'top',
  },
});
