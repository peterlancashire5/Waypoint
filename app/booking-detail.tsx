import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import type { TransportType } from '@/lib/claude';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccommodationRecord {
  id: string;
  stop_id: string;
  name: string | null;
  address: string | null;
  check_in_date: string | null;   // calendar date from booking PDF ("YYYY-MM-DD")
  check_out_date: string | null;  // calendar date from booking PDF ("YYYY-MM-DD")
  check_in: string | null;        // time-of-day ("HH:MM"), user-entered
  check_out: string | null;       // time-of-day ("HH:MM"), user-entered
  confirmation_ref: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  door_code: string | null;
}

// Leg_bookings-backed flight (has a matched leg with ISO timestamps)
interface FlightRecord {
  id: string;
  leg_id: string;
  operator: string | null;
  reference: string | null;
  seat: string | null;
  confirmation_ref: string | null;
  leg: {
    transport_type: string | null;
    departure_time: string | null;
    arrival_time: string | null;
    from_stop: { city: string; country: string | null } | null;
    to_stop: { city: string; country: string | null } | null;
  } | null;
}

// Saved_items-backed transport (no matched leg; structured JSON in note)
interface SavedItemTransportRecord {
  id: string;
  transport_type: TransportType;
  operator: string | null;
  service_number: string | null;
  origin_city: string | null;
  destination_city: string | null;
  departure_date: string | null;   // "YYYY-MM-DD"
  departure_time: string | null;   // "HH:MM"
  arrival_date: string | null;
  arrival_time: string | null;
  booking_ref: string | null;
  seat: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function shortDate(ymd: string | null): string {
  if (!ymd) return '—';
  const d = new Date(ymd + 'T00:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

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

function computeNights(start: string | null, end: string | null, storedNights: number | null): number | null {
  // Prefer calculating from dates — the stored nights column can be stale
  if (start && end) {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : null;
  }
  return storedNights;
}

// Format an ISO datetime as time only ("09:15")
function formatIsoTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// Format an ISO datetime as short date ("2 Apr")
function formatIsoDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function computeIsoDuration(dep: string | null, arr: string | null): string | null {
  if (!dep || !arr) return null;
  const diffMs = new Date(arr).getTime() - new Date(dep).getTime();
  if (diffMs <= 0) return null;
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Editable field row ───────────────────────────────────────────────────────

function EditableRow({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  function startEdit() {
    setDraft(value ?? '');
    setEditing(true);
  }

  function commitEdit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value ?? '')) {
      onSave(trimmed);
    }
  }

  return (
    <Pressable style={styles.fieldRow} onPress={startEdit}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {editing ? (
        <TextInput
          autoFocus
          value={draft}
          onChangeText={setDraft}
          onBlur={commitEdit}
          onSubmitEditing={commitEdit}
          style={styles.fieldInput}
          returnKeyType="done"
          placeholderTextColor={colors.textMuted}
        />
      ) : (
        <Text style={[styles.fieldValue, !value && styles.fieldEmpty]}>
          {value || placeholder || 'Tap to add'}
        </Text>
      )}
      {!editing && (
        <Feather name="edit-2" size={13} color={colors.border} style={styles.editIcon} />
      )}
    </Pressable>
  );
}

// ─── Read-only field row ──────────────────────────────────────────────────────

function ReadOnlyRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={[styles.fieldRow, styles.fieldRowReadOnly]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, !value && styles.fieldEmpty]}>
        {value || '—'}
      </Text>
    </View>
  );
}

// ─── Section heading ─────────────────────────────────────────────────────────

function SectionHeading({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

// ─── Accommodation detail ─────────────────────────────────────────────────────

function AccommodationDetail({
  record,
  onFieldSave,
}: {
  record: AccommodationRecord;
  onFieldSave: (field: keyof AccommodationRecord, value: string) => void;
}) {
  const startDate = record.check_in_date;
  const endDate = record.check_out_date;
  const nights = computeNights(startDate, endDate, null);
  const dateRange = (startDate || endDate) ? formatDateRange(startDate, endDate) : null;

  return (
    <>
      {/* Property hero */}
      <View style={styles.heroCard}>
        <View style={styles.heroIconWrap}>
          <Feather name="home" size={22} color={colors.primary} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>{record.name || 'Accommodation'}</Text>
          {(dateRange || nights !== null) ? (
            <Text style={styles.heroSubtitle}>
              {[dateRange, nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null]
                .filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {record.address ? (
            <Text style={styles.heroSubtitle}>{record.address}</Text>
          ) : null}
        </View>
      </View>

      {/* Stay details */}
      <SectionHeading label="Stay details" />
      <View style={styles.card}>
        <EditableRow
          label="Property name"
          value={record.name}
          placeholder="Hotel or property name"
          onSave={(v) => onFieldSave('name', v)}
        />
        <View style={styles.divider} />
        {dateRange ? (
          <>
            <ReadOnlyRow
              label="Dates"
              value={`${dateRange}${nights !== null ? ` · ${nights} ${nights === 1 ? 'night' : 'nights'}` : ''}`}
            />
            <View style={styles.divider} />
          </>
        ) : null}
        <EditableRow
          label="Address"
          value={record.address}
          placeholder="Address"
          onSave={(v) => onFieldSave('address', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Check-in time"
          value={record.check_in}
          placeholder="e.g. 14:00"
          onSave={(v) => onFieldSave('check_in', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Check-out time"
          value={record.check_out}
          placeholder="e.g. 11:00"
          onSave={(v) => onFieldSave('check_out', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Confirmation ref"
          value={record.confirmation_ref}
          placeholder="Booking reference"
          onSave={(v) => onFieldSave('confirmation_ref', v)}
        />
      </View>

      {/* Access */}
      <SectionHeading label="Access" />
      <View style={styles.card}>
        <EditableRow
          label="Wi-Fi name"
          value={record.wifi_name}
          placeholder="Network name"
          onSave={(v) => onFieldSave('wifi_name', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Wi-Fi password"
          value={record.wifi_password}
          placeholder="Password"
          onSave={(v) => onFieldSave('wifi_password', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Door code"
          value={record.door_code}
          placeholder="Entry code"
          onSave={(v) => onFieldSave('door_code', v)}
        />
      </View>
    </>
  );
}

// ─── Leg_bookings-backed flight detail ───────────────────────────────────────

function FlightDetail({
  record,
  onFieldSave,
}: {
  record: FlightRecord;
  onFieldSave: (field: keyof Pick<FlightRecord, 'operator' | 'reference' | 'seat' | 'confirmation_ref'>, value: string) => void;
}) {
  const leg = record.leg;
  const fromCity = leg?.from_stop?.city ?? '—';
  const toCity = leg?.to_stop?.city ?? '—';
  const duration = computeIsoDuration(leg?.departure_time ?? null, leg?.arrival_time ?? null);

  return (
    <>
      {/* Route hero */}
      <View style={styles.routeCard}>
        <View style={styles.routeEndpoint}>
          <Text style={styles.routeCity}>{fromCity}</Text>
          {leg?.from_stop?.country ? (
            <Text style={styles.routeCountry}>{leg.from_stop.country}</Text>
          ) : null}
          <Text style={styles.routeTime}>{formatIsoTime(leg?.departure_time ?? null)}</Text>
          <Text style={styles.routeDate}>{formatIsoDate(leg?.departure_time ?? null)}</Text>
        </View>
        <View style={styles.routeMiddle}>
          <View style={styles.routeLine} />
          <Feather name="send" size={14} color={colors.primary} style={styles.routeIcon} />
          {duration ? <Text style={styles.routeDuration}>{duration}</Text> : null}
        </View>
        <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
          <Text style={styles.routeCity}>{toCity}</Text>
          {leg?.to_stop?.country ? (
            <Text style={styles.routeCountry}>{leg.to_stop.country}</Text>
          ) : null}
          <Text style={styles.routeTime}>{formatIsoTime(leg?.arrival_time ?? null)}</Text>
          <Text style={styles.routeDate}>{formatIsoDate(leg?.arrival_time ?? null)}</Text>
        </View>
      </View>

      <SectionHeading label="Flight details" />
      <View style={styles.card}>
        <ReadOnlyRow label="Transport" value={leg?.transport_type ?? null} />
        <View style={styles.divider} />
        <EditableRow
          label="Airline / Operator"
          value={record.operator}
          placeholder="e.g. Thai Airways"
          onSave={(v) => onFieldSave('operator', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Flight number"
          value={record.reference}
          placeholder="e.g. TG661"
          onSave={(v) => onFieldSave('reference', v)}
        />
      </View>

      <SectionHeading label="Booking" />
      <View style={styles.card}>
        <EditableRow
          label="Seat"
          value={record.seat}
          placeholder="e.g. 14A"
          onSave={(v) => onFieldSave('seat', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Booking ref"
          value={record.confirmation_ref}
          placeholder="Confirmation reference"
          onSave={(v) => onFieldSave('confirmation_ref', v)}
        />
      </View>
    </>
  );
}

// ─── Saved_items-backed transport detail ─────────────────────────────────────

function SavedItemTransportDetail({
  record,
  onFieldSave,
}: {
  record: SavedItemTransportRecord;
  onFieldSave: (field: keyof SavedItemTransportRecord, value: string) => void;
}) {
  const fromCity = record.origin_city ?? '—';
  const toCity = record.destination_city ?? '—';
  const icon = transportIcon(record.transport_type);

  return (
    <>
      {/* Route hero */}
      <View style={styles.routeCard}>
        <View style={styles.routeEndpoint}>
          <Text style={styles.routeCity}>{fromCity}</Text>
          <Text style={styles.routeTime}>{record.departure_time || '—'}</Text>
          <Text style={styles.routeDate}>{shortDate(record.departure_date)}</Text>
        </View>
        <View style={styles.routeMiddle}>
          <View style={styles.routeLine} />
          <Feather name={icon} size={14} color={colors.primary} style={styles.routeIcon} />
        </View>
        <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
          <Text style={styles.routeCity}>{toCity}</Text>
          <Text style={styles.routeTime}>{record.arrival_time || '—'}</Text>
          <Text style={styles.routeDate}>{shortDate(record.arrival_date)}</Text>
        </View>
      </View>

      <SectionHeading label="Transport details" />
      <View style={styles.card}>
        <EditableRow
          label="Operator"
          value={record.operator}
          placeholder="e.g. Thai Airways"
          onSave={(v) => onFieldSave('operator', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Service number"
          value={record.service_number}
          placeholder="e.g. TG661"
          onSave={(v) => onFieldSave('service_number', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Departure"
          value={record.departure_date ? `${shortDate(record.departure_date)}${record.departure_time ? ' · ' + record.departure_time : ''}` : null}
          placeholder="Date · time"
          onSave={(v) => onFieldSave('departure_date', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Arrival"
          value={record.arrival_date ? `${shortDate(record.arrival_date)}${record.arrival_time ? ' · ' + record.arrival_time : ''}` : null}
          placeholder="Date · time"
          onSave={(v) => onFieldSave('arrival_date', v)}
        />
      </View>

      <SectionHeading label="Booking" />
      <View style={styles.card}>
        <EditableRow
          label="Seat"
          value={record.seat}
          placeholder="e.g. 14A"
          onSave={(v) => onFieldSave('seat', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Booking ref"
          value={record.booking_ref}
          placeholder="Confirmation reference"
          onSave={(v) => onFieldSave('booking_ref', v)}
        />
      </View>
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BookingDetailScreen() {
  const router = useRouter();
  const { type, id, source } = useLocalSearchParams<{
    type: 'transport' | 'accommodation';
    id: string;
    source: 'accommodation' | 'leg_bookings' | 'saved_items';
  }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [accommodation, setAccommodation] = useState<AccommodationRecord | null>(null);
  const [flight, setFlight] = useState<FlightRecord | null>(null);
  const [savedItemTransport, setSavedItemTransport] = useState<SavedItemTransportRecord | null>(null);

  // ── Fetch record ────────────────────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      if (!id || !type) {
        setError('Missing booking details.');
        setLoading(false);
        return;
      }

      if (type === 'accommodation') {
        const { data, error: fetchErr } = await supabase
          .from('accommodation')
          .select('id, stop_id, name, address, check_in_date, check_out_date, check_in, check_out, confirmation_ref, wifi_name, wifi_password, door_code')
          .eq('id', id)
          .single();
        if (fetchErr || !data) {
          setError('Could not load accommodation details.');
        } else {
          setAccommodation(data as unknown as AccommodationRecord);
        }
      } else if (source === 'saved_items') {
        // Transport stored as JSON in saved_items.note
        const { data, error: fetchErr } = await supabase
          .from('saved_items')
          .select('id, note')
          .eq('id', id)
          .single();
        if (fetchErr || !data) {
          setError('Could not load transport details.');
        } else {
          try {
            const parsed = JSON.parse((data as any).note ?? '{}');
            setSavedItemTransport({
              id: (data as any).id,
              transport_type: parsed.transport_type ?? 'flight',
              operator: parsed.operator ?? parsed.airline ?? null,
              service_number: parsed.service_number ?? parsed.flight_number ?? null,
              origin_city: parsed.origin_city ?? null,
              destination_city: parsed.destination_city ?? null,
              departure_date: parsed.departure_date ?? null,
              departure_time: parsed.departure_time ?? null,
              arrival_date: parsed.arrival_date ?? null,
              arrival_time: parsed.arrival_time ?? null,
              booking_ref: parsed.booking_ref ?? null,
              seat: parsed.seat ?? null,
            });
          } catch {
            setError('Could not parse transport details.');
          }
        }
      } else {
        // Flight from leg_bookings
        const { data, error: fetchErr } = await supabase
          .from('leg_bookings')
          .select('id, leg_id, operator, reference, seat, confirmation_ref, leg:leg_id(transport_type, departure_time, arrival_time, from_stop:from_stop_id(city, country), to_stop:to_stop_id(city, country))')
          .eq('id', id)
          .single();
        if (fetchErr || !data) {
          setError('Could not load flight details.');
        } else {
          setFlight(data as unknown as FlightRecord);
        }
      }

      setLoading(false);
    };
    load();
  }, [id, type, source]);

  // ── Save a field ────────────────────────────────────────────────────────────

  async function saveAccommodationField(field: keyof AccommodationRecord, value: string) {
    if (!accommodation) return;
    const storedValue = value === '' ? null : value;
    const { error: updateErr } = await supabase
      .from('accommodation')
      .update({ [field]: storedValue })
      .eq('id', accommodation.id);
    if (updateErr) {
      Alert.alert('Could not save', updateErr.message);
      return;
    }
    setAccommodation((prev) => prev ? { ...prev, [field]: storedValue } : prev);
  }

  async function saveFlightField(
    field: keyof Pick<FlightRecord, 'operator' | 'reference' | 'seat' | 'confirmation_ref'>,
    value: string,
  ) {
    if (!flight) return;
    const storedValue = value === '' ? null : value;
    const { error: updateErr } = await supabase
      .from('leg_bookings')
      .update({ [field]: storedValue })
      .eq('id', flight.id);
    if (updateErr) {
      Alert.alert('Could not save', updateErr.message);
      return;
    }
    setFlight((prev) => prev ? { ...prev, [field]: storedValue } : prev);
  }

  async function saveSavedItemTransportField(field: keyof SavedItemTransportRecord, value: string) {
    if (!savedItemTransport) return;
    const storedValue = value === '' ? null : value;
    const updated = { ...savedItemTransport, [field]: storedValue };
    const note = JSON.stringify({
      transport_type: updated.transport_type,
      operator: updated.operator,
      service_number: updated.service_number,
      origin_city: updated.origin_city,
      destination_city: updated.destination_city,
      departure_date: updated.departure_date,
      departure_time: updated.departure_time,
      arrival_date: updated.arrival_date,
      arrival_time: updated.arrival_time,
      booking_ref: updated.booking_ref,
      seat: updated.seat,
    });
    const name = [updated.operator, updated.service_number].filter(Boolean).join(' ') || 'Transport';
    const { error: updateErr } = await supabase
      .from('saved_items')
      .update({ note, name })
      .eq('id', savedItemTransport.id);
    if (updateErr) {
      Alert.alert('Could not save', updateErr.message);
      return;
    }
    setSavedItemTransport(updated);
  }

  // ── Delete booking ──────────────────────────────────────────────────────────

  function handleDeletePress() {
    const label = type === 'accommodation' ? 'accommodation booking' : 'transport booking';
    Alert.alert(
      `Delete ${label}`,
      'This will permanently remove this booking. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDelete },
      ],
    );
  }

  async function confirmDelete() {
    if (!id) return;
    setDeleting(true);
    try {
      let table: string;
      if (type === 'accommodation') {
        table = 'accommodation';
      } else if (source === 'saved_items') {
        table = 'saved_items';
      } else {
        table = 'leg_bookings';
      }
      const { error: deleteErr } = await supabase.from(table).delete().eq('id', id);
      if (deleteErr) throw new Error(deleteErr.message);
      router.back();
    } catch (err: any) {
      Alert.alert('Could not delete', err?.message ?? 'Please try again.');
      setDeleting(false);
    }
  }

  // ── Header title ────────────────────────────────────────────────────────────

  function getTitle(): string {
    if (type === 'accommodation') return accommodation?.name || 'Accommodation';
    if (savedItemTransport) {
      const from = savedItemTransport.origin_city ?? '—';
      const to = savedItemTransport.destination_city ?? '—';
      return `${from} → ${to}`;
    }
    const from = flight?.leg?.from_stop?.city ?? '—';
    const to = flight?.leg?.to_stop?.city ?? '—';
    return `${from} → ${to}`;
  }

  function getSubtitle(): string | null {
    if (type === 'accommodation') return null;
    if (savedItemTransport) {
      return [savedItemTransport.operator, savedItemTransport.service_number].filter(Boolean).join(' · ') || null;
    }
    return [flight?.operator, flight?.reference].filter(Boolean).join(' · ') || null;
  }

  // ── Render states ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || (!accommodation && !flight && !savedItemTransport)) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <SafeAreaView edges={['top']} style={styles.safeTop}>
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
              <Feather name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          </View>
        </SafeAreaView>
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error ?? 'Booking not found.'}</Text>
          <Pressable style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryText}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const subtitle = getSubtitle();

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>{getTitle()}</Text>
            {subtitle ? (
              <Text style={styles.headerSubtitle}>{subtitle}</Text>
            ) : null}
          </View>
          <View style={styles.headerAction} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {type === 'accommodation' && accommodation && (
          <AccommodationDetail
            record={accommodation}
            onFieldSave={saveAccommodationField}
          />
        )}
        {type === 'transport' && flight && (
          <FlightDetail
            record={flight}
            onFieldSave={saveFlightField}
          />
        )}
        {type === 'transport' && savedItemTransport && (
          <SavedItemTransportDetail
            record={savedItemTransport}
            onFieldSave={saveSavedItemTransportField}
          />
        )}

        {/* TODO: PDF link — store pdf_uri in accommodation / leg_bookings / saved_items
            and show an "Open original PDF" button here when it's available. */}

        {/* Delete */}
        <View style={styles.deleteSection}>
          <Pressable
            style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
            onPress={handleDeletePress}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <>
                <Feather name="trash-2" size={16} color={colors.error} />
                <Text style={styles.deleteButtonText}>
                  Delete {type === 'accommodation' ? 'accommodation' : 'transport booking'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontFamily: fonts.displayBold, fontSize: 19, color: colors.text,
    letterSpacing: -0.2, textAlign: 'center',
  },
  headerSubtitle: {
    fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 1,
  },
  headerAction: { width: 36 },

  scrollContent: { padding: 16, paddingBottom: 48 },

  // Hero card (accommodation)
  heroCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  heroIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#EBF3F6',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  heroText: { flex: 1, gap: 3 },
  heroTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.text, letterSpacing: -0.1 },
  heroSubtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  // Route card (flight)
  routeCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  routeEndpoint: { flex: 1 },
  routeEndpointRight: { alignItems: 'flex-end' },
  routeCity: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.text, letterSpacing: -0.2 },
  routeCountry: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  routeTime: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.primary, marginTop: 6 },
  routeDate: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  routeMiddle: { alignItems: 'center', paddingHorizontal: 12, gap: 4 },
  routeLine: { width: 40, height: 1, backgroundColor: colors.border },
  routeIcon: { marginTop: 2 },
  routeDuration: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginTop: 2 },

  // Section label
  sectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase',
    marginBottom: 10, marginTop: 4,
  },

  // Info card
  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    overflow: 'hidden',
  },

  // Field rows
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    gap: 12,
  },
  fieldRowReadOnly: { opacity: 0.7 },
  fieldLabel: {
    fontFamily: fonts.body, fontSize: 14, color: colors.textMuted,
    width: 130, flexShrink: 0,
  },
  fieldValue: {
    flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text,
    textAlign: 'right',
  },
  fieldEmpty: { color: colors.border, fontFamily: fonts.body },
  fieldInput: {
    flex: 1,
    fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary,
    textAlign: 'right',
    padding: 0,
  },
  editIcon: { marginLeft: 4 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 16 },

  // Delete section
  deleteSection: { marginTop: 12, marginBottom: 8 },
  deleteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1, borderColor: colors.error,
    backgroundColor: colors.white,
  },
  deleteButtonPressed: { opacity: 0.7 },
  deleteButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.error },

  // Loading / error
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12, textAlign: 'center' },
  retryButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },
});
