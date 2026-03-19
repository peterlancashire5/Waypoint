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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import { deleteTransportBooking, deleteConnectionBooking } from '@/lib/journeyUtils';
import { transportIcon } from '@/components/BookingPreviewSheet';
import type { TransportType } from '@/lib/claude';
import { useNetworkStatus } from '@/context/NetworkContext';
import FileViewer from 'react-native-file-viewer';
import { getLocalDocumentPath, downloadDocumentOnDemand } from '@/lib/documentCache';

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
  // Provider type + type-specific fields
  accommodation_type: 'airbnb' | 'booking_com' | 'hotels_com' | 'hostel' | 'hotel' | null;
  host_name: string | null;
  access_code: string | null;
  checkin_instructions: string | null;
  room_type: string | null;
  checkin_hours: string | null;
}

// Journey-backed leg_booking
interface JourneyLegBooking {
  id: string;
  journey_id: string | null;
  operator: string | null;
  reference: string | null;   // service number
  seat: string | null;
  confirmation_ref: string | null;
  leg_order: number;
  origin_city: string | null;
  destination_city: string | null;
  departure_date: string | null;
  departure_time: string | null;
  arrival_date: string | null;
  arrival_time: string | null;
  extra_data: Record<string, string | null> | null;
}

interface JourneyRecord {
  id: string;
  origin_city: string;
  destination_city: string;
}

interface TripLeg {
  transport_type: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  from_stop: { city: string; country: string | null } | null;
  to_stop: { city: string; country: string | null } | null;
}

// Bundled state for journey-backed transport detail
interface JourneyDetail {
  journey: JourneyRecord | null;
  legBookings: JourneyLegBooking[];
  tripLeg: TripLeg | null;
  /** id of the first leg_booking fetched (the one the user tapped) */
  primaryLbId: string;
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
  // Flight
  gate: string | null;
  terminal: string | null;
  // Train
  coach: string | null;
  platform: string | null;
  origin_station: string | null;
  destination_station: string | null;
  // Bus
  pickup_point: string | null;
  dropoff_point: string | null;
  // Ferry
  deck: string | null;
  cabin: string | null;
  port_terminal: string | null;
  is_connection: boolean;
  legs?: Array<{
    transport_type: TransportType;
    operator: string | null;
    service_number: string | null;
    origin_city: string | null;
    destination_city: string | null;
    departure_date: string | null;
    departure_time: string | null;
    arrival_date: string | null;
    arrival_time: string | null;
    seat: string | null;
    leg_order: number;
  }>;
}

interface LinkedDocument {
  id: string;
  storage_path: string;
  original_filename: string;
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

function accommodationProviderLabel(type: AccommodationRecord['accommodation_type']): string {
  switch (type) {
    case 'airbnb':      return 'Airbnb';
    case 'booking_com': return 'Booking.com';
    case 'hotels_com':  return 'Hotels.com';
    case 'hostel':      return 'Hostelworld';
    default:            return 'Hotel';
  }
}

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
  const providerLabel = accommodationProviderLabel(record.accommodation_type);
  const isAirbnb = record.accommodation_type === 'airbnb';
  const isHostel = record.accommodation_type === 'hostel';

  // Airbnb check-in rows — only include fields that have data
  const airbnbCheckinItems: React.ReactNode[] = [];
  if (record.host_name) {
    airbnbCheckinItems.push(
      <EditableRow key="host" label="Host" value={record.host_name}
        onSave={(v) => onFieldSave('host_name', v)} />
    );
  }
  if (record.access_code) {
    airbnbCheckinItems.push(
      <View key="access" style={styles.accessCodeRow}>
        <View style={styles.accessCodeLeft}>
          <Feather name="key" size={14} color={colors.accent} />
          <Text style={styles.accessCodeLabel}>Access code</Text>
        </View>
        <Text style={styles.accessCodeValue}>{record.access_code}</Text>
      </View>
    );
  }
  if (record.checkin_instructions) {
    airbnbCheckinItems.push(
      <EditableRow key="instructions" label="Check-in instructions"
        value={record.checkin_instructions}
        onSave={(v) => onFieldSave('checkin_instructions', v)} />
    );
  }

  // Hostel room rows — only include fields that have data
  const hostelRoomItems: React.ReactNode[] = [];
  if (record.room_type) {
    hostelRoomItems.push(
      <EditableRow key="room" label="Room type" value={record.room_type}
        onSave={(v) => onFieldSave('room_type', v)} />
    );
  }
  if (record.checkin_hours) {
    hostelRoomItems.push(
      <EditableRow key="hours" label="Check-in hours" value={record.checkin_hours}
        onSave={(v) => onFieldSave('checkin_hours', v)} />
    );
  }

  // Access rows — only include fields that have data
  const accessItems: Array<{ key: 'wifi_name' | 'wifi_password' | 'door_code'; label: string; value: string }> = [];
  if (record.wifi_name)     accessItems.push({ key: 'wifi_name',     label: 'Wi-Fi name',     value: record.wifi_name });
  if (record.wifi_password) accessItems.push({ key: 'wifi_password', label: 'Wi-Fi password', value: record.wifi_password });
  if (record.door_code)     accessItems.push({ key: 'door_code',     label: 'Door code',      value: record.door_code });

  return (
    <>
      {/* Property hero */}
      <View style={styles.heroCard}>
        <View style={styles.heroIconWrap}>
          <Feather name="home" size={22} color={colors.primary} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>{record.name || 'Accommodation'}</Text>
          <View style={styles.heroTypeBadge}>
            <Text style={styles.heroTypeBadgeText}>{providerLabel}</Text>
          </View>
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
        <EditableRow label="Property name" value={record.name}
          placeholder="Hotel or property name" onSave={(v) => onFieldSave('name', v)} />
        {dateRange ? <>
          <View style={styles.divider} />
          <ReadOnlyRow label="Dates"
            value={`${dateRange}${nights !== null ? ` · ${nights} ${nights === 1 ? 'night' : 'nights'}` : ''}`} />
        </> : null}
        <View style={styles.divider} />
        <EditableRow label="Address" value={record.address}
          placeholder="Address" onSave={(v) => onFieldSave('address', v)} />
        {record.check_in ? <>
          <View style={styles.divider} />
          <EditableRow label="Check-in time" value={record.check_in}
            onSave={(v) => onFieldSave('check_in', v)} />
        </> : null}
        {record.check_out ? <>
          <View style={styles.divider} />
          <EditableRow label="Check-out time" value={record.check_out}
            onSave={(v) => onFieldSave('check_out', v)} />
        </> : null}
        <View style={styles.divider} />
        <EditableRow label="Confirmation ref" value={record.confirmation_ref}
          placeholder="Booking reference" onSave={(v) => onFieldSave('confirmation_ref', v)} />
      </View>

      {/* Airbnb: check-in section (only shown when at least one field has data) */}
      {isAirbnb && airbnbCheckinItems.length > 0 ? (
        <>
          <SectionHeading label="Check-in" />
          <View style={styles.card}>
            {airbnbCheckinItems.map((item, i) => (
              <React.Fragment key={i}>
                {i > 0 && <View style={styles.divider} />}
                {item}
              </React.Fragment>
            ))}
          </View>
        </>
      ) : null}

      {/* Hostel: room section (only shown when at least one field has data) */}
      {isHostel && hostelRoomItems.length > 0 ? (
        <>
          <SectionHeading label="Room" />
          <View style={styles.card}>
            {hostelRoomItems.map((item, i) => (
              <React.Fragment key={i}>
                {i > 0 && <View style={styles.divider} />}
                {item}
              </React.Fragment>
            ))}
          </View>
        </>
      ) : null}

      {/* Hostel: additional information (check-in instructions) */}
      {isHostel && record.checkin_instructions ? (
        <>
          <SectionHeading label="Additional information" />
          <View style={styles.card}>
            <EditableRow key="instructions" label="Check-in instructions"
              value={record.checkin_instructions}
              onSave={(v) => onFieldSave('checkin_instructions', v)} />
          </View>
        </>
      ) : null}

      {/* Hotel / Booking.com / Hotels.com: room type (only if present and not hostel/airbnb) */}
      {!isAirbnb && !isHostel && record.room_type ? (
        <>
          <SectionHeading label="Room" />
          <View style={styles.card}>
            <EditableRow label="Room type" value={record.room_type}
              onSave={(v) => onFieldSave('room_type', v)} />
          </View>
        </>
      ) : null}

      {/* Access: only shown when at least one field has data */}
      {accessItems.length > 0 ? (
        <>
          <SectionHeading label="Access" />
          <View style={styles.card}>
            {accessItems.map((item, i) => (
              <React.Fragment key={item.key}>
                {i > 0 && <View style={styles.divider} />}
                <EditableRow label={item.label} value={item.value}
                  onSave={(v) => onFieldSave(item.key, v)} />
              </React.Fragment>
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

// ─── Single-leg journey detail ───────────────────────────────────────────────

function SingleLegJourneyDetail({
  detail,
  onFieldSave,
  onExtraFieldSave,
}: {
  detail: JourneyDetail;
  onFieldSave: (lbId: string, field: 'operator' | 'reference' | 'seat' | 'confirmation_ref', value: string) => void;
  onExtraFieldSave: (lbId: string, field: string, value: string) => void;
}) {
  const leg = detail.tripLeg;
  const lb = detail.legBookings[0];
  const fromCity = detail.journey?.origin_city ?? leg?.from_stop?.city ?? '—';
  const toCity = detail.journey?.destination_city ?? leg?.to_stop?.city ?? '—';
  const duration = computeIsoDuration(leg?.departure_time ?? null, leg?.arrival_time ?? null);
  const transportType = leg?.transport_type ?? 'flight';
  const extra = lb?.extra_data ?? {};

  const serviceLabel = transportType === 'train' ? 'Train no.'
    : transportType === 'bus' ? 'Service no.'
    : transportType === 'ferry' ? 'Voyage no.'
    : 'Flight no.';
  const operatorLabel = transportType === 'train' ? 'Rail operator'
    : transportType === 'bus' ? 'Bus operator'
    : transportType === 'ferry' ? 'Ferry operator'
    : 'Airline';

  if (!lb) return null;

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
          <Feather name={transportIcon(transportType)} size={14} color={colors.primary} style={styles.routeIcon} />
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

      <SectionHeading label="Journey details" />
      <View style={styles.card}>
        <EditableRow
          label={operatorLabel}
          value={lb.operator}
          placeholder="Operator name"
          onSave={(v) => onFieldSave(lb.id, 'operator', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label={serviceLabel}
          value={lb.reference}
          placeholder="Service number"
          onSave={(v) => onFieldSave(lb.id, 'reference', v)}
        />
        {/* Flight-specific */}
        {transportType === 'flight' && (
          <>
            <View style={styles.divider} />
            <EditableRow label="Gate" value={extra.gate ?? null} placeholder="e.g. B12"
              onSave={(v) => onExtraFieldSave(lb.id, 'gate', v)} />
            <View style={styles.divider} />
            <EditableRow label="Terminal" value={extra.terminal ?? null} placeholder="e.g. Terminal 2"
              onSave={(v) => onExtraFieldSave(lb.id, 'terminal', v)} />
          </>
        )}
        {/* Train-specific */}
        {transportType === 'train' && (
          <>
            <View style={styles.divider} />
            <EditableRow label="From station" value={extra.origin_station ?? null} placeholder="Departure station"
              onSave={(v) => onExtraFieldSave(lb.id, 'origin_station', v)} />
            <View style={styles.divider} />
            <EditableRow label="To station" value={extra.destination_station ?? null} placeholder="Arrival station"
              onSave={(v) => onExtraFieldSave(lb.id, 'destination_station', v)} />
            <View style={styles.divider} />
            <EditableRow label="Platform" value={extra.platform ?? null} placeholder="e.g. 5"
              onSave={(v) => onExtraFieldSave(lb.id, 'platform', v)} />
            <View style={styles.divider} />
            <EditableRow label="Coach" value={extra.coach ?? null} placeholder="e.g. Coach B"
              onSave={(v) => onExtraFieldSave(lb.id, 'coach', v)} />
          </>
        )}
        {/* Bus-specific */}
        {transportType === 'bus' && (
          <>
            <View style={styles.divider} />
            <EditableRow label="Pickup point" value={extra.pickup_point ?? null} placeholder="Boarding location"
              onSave={(v) => onExtraFieldSave(lb.id, 'pickup_point', v)} />
            <View style={styles.divider} />
            <EditableRow label="Dropoff point" value={extra.dropoff_point ?? null} placeholder="Alighting location"
              onSave={(v) => onExtraFieldSave(lb.id, 'dropoff_point', v)} />
          </>
        )}
        {/* Ferry-specific */}
        {transportType === 'ferry' && (
          <>
            <View style={styles.divider} />
            <EditableRow label="Deck" value={extra.deck ?? null} placeholder="e.g. Deck 7"
              onSave={(v) => onExtraFieldSave(lb.id, 'deck', v)} />
            <View style={styles.divider} />
            <EditableRow label="Cabin" value={extra.cabin ?? null} placeholder="Cabin number"
              onSave={(v) => onExtraFieldSave(lb.id, 'cabin', v)} />
            <View style={styles.divider} />
            <EditableRow label="Port/terminal" value={extra.port_terminal ?? null} placeholder="Port or terminal name"
              onSave={(v) => onExtraFieldSave(lb.id, 'port_terminal', v)} />
          </>
        )}
      </View>

      <SectionHeading label="Booking" />
      <View style={styles.card}>
        <EditableRow
          label="Seat"
          value={lb.seat}
          placeholder="e.g. 14A"
          onSave={(v) => onFieldSave(lb.id, 'seat', v)}
        />
        <View style={styles.divider} />
        <EditableRow
          label="Booking ref"
          value={lb.confirmation_ref}
          placeholder="Confirmation reference"
          onSave={(v) => onFieldSave(lb.id, 'confirmation_ref', v)}
        />
      </View>
    </>
  );
}

// ─── Connection leg card ──────────────────────────────────────────────────────

function inferTransportType(extra: Record<string, string | null>): string {
  if (extra.gate != null || extra.terminal != null) return 'flight';
  if (extra.platform != null || extra.coach != null || extra.origin_station != null) return 'train';
  if (extra.pickup_point != null || extra.dropoff_point != null) return 'bus';
  if (extra.deck != null || extra.cabin != null || extra.port_terminal != null) return 'ferry';
  return 'flight';
}

function ConnectionLegCard({
  lb,
  legNumber,
  totalLegs,
  onFieldSave,
  onExtraFieldSave,
}: {
  lb: JourneyLegBooking;
  legNumber: number;
  totalLegs: number;
  onFieldSave: (lbId: string, field: 'operator' | 'reference' | 'seat' | 'confirmation_ref', value: string) => void;
  onExtraFieldSave: (lbId: string, field: string, value: string) => void;
}) {
  const extra = lb.extra_data ?? {};
  const transportType = inferTransportType(extra);
  const hasTrainFields = transportType === 'train';
  const hasBusFields = transportType === 'bus';
  const hasFerryFields = transportType === 'ferry';
  const hasFlightFields = transportType === 'flight';

  const fromCity = lb.origin_city ?? '—';
  const toCity = lb.destination_city ?? '—';
  const hasTimes = lb.departure_time || lb.arrival_time;

  const serviceLabel = transportType === 'train' ? 'Train no.'
    : transportType === 'bus' ? 'Service no.'
    : transportType === 'ferry' ? 'Voyage no.'
    : 'Flight no.';

  return (
    <View style={styles.card}>
      {/* Per-leg route header */}
      <View style={styles.connLegRouteHeader}>
        <View style={styles.connLegRouteLeft}>
          <Text style={styles.connLegLabel}>Leg {legNumber} of {totalLegs}</Text>
          <View style={styles.connLegRouteRow}>
            <Text style={styles.connLegCity}>{fromCity}</Text>
            <Feather name="arrow-right" size={12} color={colors.textMuted} style={{ marginHorizontal: 4 }} />
            <Text style={styles.connLegCity}>{toCity}</Text>
          </View>
        </View>
        {hasTimes ? (
          <View style={styles.connLegTimes}>
            <Text style={styles.connLegTime}>{lb.departure_time || '—'}</Text>
            <Text style={styles.connLegTimeArrow}>→</Text>
            <Text style={styles.connLegTime}>{lb.arrival_time || '—'}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.divider} />

      {lb.departure_date ? (
        <>
          <ReadOnlyRow
            label="Departure"
            value={`${shortDate(lb.departure_date)}${lb.departure_time ? '  ' + lb.departure_time : ''}`}
          />
          <View style={styles.divider} />
        </>
      ) : null}
      {lb.arrival_date ? (
        <>
          <ReadOnlyRow
            label="Arrival"
            value={`${shortDate(lb.arrival_date)}${lb.arrival_time ? '  ' + lb.arrival_time : ''}`}
          />
          <View style={styles.divider} />
        </>
      ) : null}

      <EditableRow
        label="Operator"
        value={lb.operator}
        placeholder="e.g. Trenitalia"
        onSave={(v) => onFieldSave(lb.id, 'operator', v)}
      />
      <View style={styles.divider} />
      <EditableRow
        label={serviceLabel}
        value={lb.reference}
        placeholder="e.g. FR 9624"
        onSave={(v) => onFieldSave(lb.id, 'reference', v)}
      />
      <View style={styles.divider} />
      <EditableRow
        label="Seat"
        value={lb.seat}
        placeholder="e.g. 14A"
        onSave={(v) => onFieldSave(lb.id, 'seat', v)}
      />
      <View style={styles.divider} />
      <EditableRow
        label="Booking ref"
        value={lb.confirmation_ref}
        placeholder="Confirmation reference"
        onSave={(v) => onFieldSave(lb.id, 'confirmation_ref', v)}
      />
      {hasFlightFields && (
        <>
          <View style={styles.divider} />
          <EditableRow label="Gate" value={extra.gate ?? null} placeholder="e.g. B12"
            onSave={(v) => onExtraFieldSave(lb.id, 'gate', v)} />
          <View style={styles.divider} />
          <EditableRow label="Terminal" value={extra.terminal ?? null} placeholder="e.g. Terminal 2"
            onSave={(v) => onExtraFieldSave(lb.id, 'terminal', v)} />
        </>
      )}
      {hasTrainFields && (
        <>
          <View style={styles.divider} />
          <EditableRow label="From station" value={extra.origin_station ?? null} placeholder="Departure station"
            onSave={(v) => onExtraFieldSave(lb.id, 'origin_station', v)} />
          <View style={styles.divider} />
          <EditableRow label="To station" value={extra.destination_station ?? null} placeholder="Arrival station"
            onSave={(v) => onExtraFieldSave(lb.id, 'destination_station', v)} />
          <View style={styles.divider} />
          <EditableRow label="Platform" value={extra.platform ?? null} placeholder="e.g. 5"
            onSave={(v) => onExtraFieldSave(lb.id, 'platform', v)} />
          <View style={styles.divider} />
          <EditableRow label="Coach" value={extra.coach ?? null} placeholder="e.g. Coach B"
            onSave={(v) => onExtraFieldSave(lb.id, 'coach', v)} />
        </>
      )}
      {hasBusFields && (
        <>
          <View style={styles.divider} />
          <EditableRow label="Pickup point" value={extra.pickup_point ?? null} placeholder="Boarding location"
            onSave={(v) => onExtraFieldSave(lb.id, 'pickup_point', v)} />
          <View style={styles.divider} />
          <EditableRow label="Dropoff point" value={extra.dropoff_point ?? null} placeholder="Alighting location"
            onSave={(v) => onExtraFieldSave(lb.id, 'dropoff_point', v)} />
        </>
      )}
      {hasFerryFields && (
        <>
          <View style={styles.divider} />
          <EditableRow label="Deck" value={extra.deck ?? null} placeholder="e.g. Deck 7"
            onSave={(v) => onExtraFieldSave(lb.id, 'deck', v)} />
          <View style={styles.divider} />
          <EditableRow label="Cabin" value={extra.cabin ?? null} placeholder="Cabin number"
            onSave={(v) => onExtraFieldSave(lb.id, 'cabin', v)} />
          <View style={styles.divider} />
          <EditableRow label="Port/terminal" value={extra.port_terminal ?? null} placeholder="Port or terminal name"
            onSave={(v) => onExtraFieldSave(lb.id, 'port_terminal', v)} />
        </>
      )}
    </View>
  );
}

// ─── Connection journey detail ────────────────────────────────────────────────

function ConnectionJourneyDetail({
  detail,
  onFieldSave,
  onExtraFieldSave,
}: {
  detail: JourneyDetail;
  onFieldSave: (lbId: string, field: 'operator' | 'reference' | 'seat' | 'confirmation_ref', value: string) => void;
  onExtraFieldSave: (lbId: string, field: string, value: string) => void;
}) {
  const legs = detail.legBookings;
  const firstLeg = legs[0];
  const lastLeg  = legs[legs.length - 1];

  // Build the ordered list of cities for the route graphic:
  // [ origin, ...layover cities, destination ]
  const routeCities: string[] = [];
  for (let i = 0; i < legs.length; i++) {
    if (i === 0) routeCities.push(legs[i].origin_city ?? detail.journey?.origin_city ?? '—');
    routeCities.push(legs[i].destination_city ?? (i === legs.length - 1 ? detail.journey?.destination_city : null) ?? '—');
  }

  // First leg departure and last leg arrival for the hero card
  const depTime = firstLeg?.departure_time ?? null;
  const depDate = firstLeg?.departure_date ?? null;
  const arrTime = lastLeg?.arrival_time ?? null;
  const arrDate = lastLeg?.arrival_date ?? null;

  // Infer transport type from first leg's extra_data (or tripLeg)
  const transportType = detail.tripLeg?.transport_type
    ?? inferTransportType(firstLeg?.extra_data ?? {});

  return (
    <>
      {/* Overall route hero — shows all cities as a chain */}
      <View style={styles.routeCard}>
        {/* Departure */}
        <View style={styles.routeEndpoint}>
          <Text style={styles.routeCity}>{routeCities[0]}</Text>
          {depTime ? <Text style={styles.routeTime}>{depTime}</Text> : null}
          {depDate ? <Text style={styles.routeDate}>{shortDate(depDate)}</Text> : null}
        </View>

        {/* Middle section: line + icon + intermediate stops + n-legs label */}
        <View style={[styles.routeMiddle, { flex: 1 }]}>
          <View style={styles.connRouteChain}>
            {routeCities.slice(1, -1).map((city, i) => (
              <View key={i} style={styles.connRouteStop}>
                <View style={styles.connRouteDot} />
                <Text style={styles.connRouteStopLabel} numberOfLines={1}>{city}</Text>
              </View>
            ))}
          </View>
          <View style={styles.routeLine} />
          <Feather name={transportIcon(transportType)} size={14} color={colors.primary} style={styles.routeIcon} />
          <Text style={styles.routeDuration}>{legs.length} legs</Text>
        </View>

        {/* Arrival */}
        <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
          <Text style={styles.routeCity}>{routeCities[routeCities.length - 1]}</Text>
          {arrTime ? <Text style={styles.routeTime}>{arrTime}</Text> : null}
          {arrDate ? <Text style={styles.routeDate}>{shortDate(arrDate)}</Text> : null}
        </View>
      </View>

      <SectionHeading label="Booking details" />
      {legs.map((lb, i) => (
        <ConnectionLegCard
          key={lb.id}
          lb={lb}
          legNumber={i + 1}
          totalLegs={legs.length}
          onFieldSave={onFieldSave}
          onExtraFieldSave={onExtraFieldSave}
        />
      ))}
    </>
  );
}

// ─── Saved_items connection detail (read-only) ───────────────────────────────

function SavedItemConnectionDetail({ record }: { record: SavedItemTransportRecord }) {
  const firstLeg = record.legs?.[0];
  const lastLeg = record.legs?.[record.legs.length - 1];
  const fromCity = firstLeg?.origin_city ?? '—';
  const toCity = lastLeg?.destination_city ?? '—';

  return (
    <>
      <View style={styles.routeCard}>
        <View style={styles.routeEndpoint}>
          <Text style={styles.routeCity}>{fromCity}</Text>
        </View>
        <View style={styles.routeMiddle}>
          <View style={styles.routeLine} />
          <Feather name="send" size={14} color={colors.primary} style={styles.routeIcon} />
          <Text style={styles.routeDuration}>{record.legs?.length ?? 0} legs</Text>
        </View>
        <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
          <Text style={styles.routeCity}>{toCity}</Text>
        </View>
      </View>
      {record.booking_ref ? (
        <>
          <SectionHeading label="Booking reference" />
          <View style={styles.card}>
            <ReadOnlyRow label="Ref" value={record.booking_ref} />
          </View>
        </>
      ) : null}
      <SectionHeading label="Legs" />
      {(record.legs ?? []).map((leg, i) => (
        <View key={i} style={styles.card}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={styles.connLegLabel}>Leg {leg.leg_order ?? i + 1}</Text>
          </View>
          <View style={styles.divider} />
          <ReadOnlyRow label="Operator" value={leg.operator} />
          <View style={styles.divider} />
          <ReadOnlyRow label="Service no." value={leg.service_number} />
          <View style={styles.divider} />
          <ReadOnlyRow label="From" value={leg.origin_city} />
          <View style={styles.divider} />
          <ReadOnlyRow label="To" value={leg.destination_city} />
          {leg.departure_date ? (
            <>
              <View style={styles.divider} />
              <ReadOnlyRow label="Departure" value={`${shortDate(leg.departure_date)}${leg.departure_time ? ' · ' + leg.departure_time : ''}`} />
            </>
          ) : null}
          {leg.arrival_date ? (
            <>
              <View style={styles.divider} />
              <ReadOnlyRow label="Arrival" value={`${shortDate(leg.arrival_date)}${leg.arrival_time ? ' · ' + leg.arrival_time : ''}`} />
            </>
          ) : null}
          {leg.seat ? (
            <>
              <View style={styles.divider} />
              <ReadOnlyRow label="Seat" value={leg.seat} />
            </>
          ) : null}
        </View>
      ))}
    </>
  );
}

// ─── Saved_items-backed transport detail ─────────────────────────────────────

type SavedItemEditableField = 'transport_type' | 'operator' | 'service_number' | 'origin_city' | 'destination_city' | 'departure_date' | 'departure_time' | 'arrival_date' | 'arrival_time' | 'booking_ref' | 'seat' | 'gate' | 'terminal' | 'coach' | 'platform' | 'origin_station' | 'destination_station' | 'pickup_point' | 'dropoff_point' | 'deck' | 'cabin' | 'port_terminal';

function SavedItemTransportDetail({
  record,
  onFieldSave,
}: {
  record: SavedItemTransportRecord;
  onFieldSave: (field: SavedItemEditableField, value: string) => void;
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
        {/* Flight-specific */}
        {record.transport_type === 'flight' && (
          <>
            <View style={styles.divider} />
            <EditableRow label="Gate" value={record.gate} placeholder="e.g. B12"
              onSave={(v) => onFieldSave('gate', v)} />
            <View style={styles.divider} />
            <EditableRow label="Terminal" value={record.terminal} placeholder="e.g. Terminal 2"
              onSave={(v) => onFieldSave('terminal', v)} />
          </>
        )}
        {/* Train-specific */}
        {record.transport_type === 'train' && (
          <>
            <View style={styles.divider} />
            <EditableRow label="From station" value={record.origin_station} placeholder="Departure station"
              onSave={(v) => onFieldSave('origin_station', v)} />
            <View style={styles.divider} />
            <EditableRow label="To station" value={record.destination_station} placeholder="Arrival station"
              onSave={(v) => onFieldSave('destination_station', v)} />
            <View style={styles.divider} />
            <EditableRow label="Platform" value={record.platform} placeholder="e.g. 5"
              onSave={(v) => onFieldSave('platform', v)} />
            <View style={styles.divider} />
            <EditableRow label="Coach" value={record.coach} placeholder="e.g. Coach B"
              onSave={(v) => onFieldSave('coach', v)} />
          </>
        )}
        {/* Bus-specific */}
        {record.transport_type === 'bus' && (
          <>
            <View style={styles.divider} />
            <EditableRow label="Pickup point" value={record.pickup_point} placeholder="Boarding location"
              onSave={(v) => onFieldSave('pickup_point', v)} />
            <View style={styles.divider} />
            <EditableRow label="Dropoff point" value={record.dropoff_point} placeholder="Alighting location"
              onSave={(v) => onFieldSave('dropoff_point', v)} />
          </>
        )}
        {/* Ferry-specific */}
        {record.transport_type === 'ferry' && (
          <>
            <View style={styles.divider} />
            <EditableRow label="Deck" value={record.deck} placeholder="e.g. Deck 7"
              onSave={(v) => onFieldSave('deck', v)} />
            <View style={styles.divider} />
            <EditableRow label="Cabin" value={record.cabin} placeholder="Cabin number"
              onSave={(v) => onFieldSave('cabin', v)} />
            <View style={styles.divider} />
            <EditableRow label="Port/terminal" value={record.port_terminal} placeholder="Port or terminal name"
              onSave={(v) => onFieldSave('port_terminal', v)} />
          </>
        )}
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

  const { isOnline, onlineRefreshTrigger, showOfflineToast } = useNetworkStatus();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [accommodation, setAccommodation] = useState<AccommodationRecord | null>(null);
  const [journeyDetail, setJourneyDetail] = useState<JourneyDetail | null>(null);
  const [savedItemTransport, setSavedItemTransport] = useState<SavedItemTransportRecord | null>(null);

  const [linkedDoc, setLinkedDoc] = useState<LinkedDocument | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [viewingDoc, setViewingDoc] = useState(false);

  // ── Fetch record ────────────────────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      if (!id || !type) {
        setError('Missing booking details.');
        setLoading(false);
        return;
      }

      // Offline fallback — restore from per-record cache
      if (!isOnline) {
        try {
          const raw = await AsyncStorage.getItem(`waypoint_cache_booking_${id}`);
          if (raw) {
            const cached = JSON.parse(raw);
            if (cached.accommodation) setAccommodation(cached.accommodation);
            if (cached.journeyDetail) setJourneyDetail(cached.journeyDetail);
            if (cached.savedItemTransport) setSavedItemTransport(cached.savedItemTransport);
          } else {
            setError('No saved data available.');
          }
        } catch {
          setError('No saved data available.');
        }
        setLoading(false);
        return;
      }

      if (type === 'accommodation') {
        const { data, error: fetchErr } = await supabase
          .from('accommodation')
          .select('id, stop_id, name, address, check_in_date, check_out_date, check_in, check_out, confirmation_ref, wifi_name, wifi_password, door_code, accommodation_type, host_name, access_code, checkin_instructions, room_type, checkin_hours')
          .eq('id', id)
          .single();
        if (fetchErr || !data) {
          setError('Could not load accommodation details.');
        } else {
          console.log('[booking-detail] fetched accommodation:', JSON.stringify(data));
          const accomData = data as unknown as AccommodationRecord;
          setAccommodation(accomData);
          // Cache for offline — fire and forget
          AsyncStorage.setItem(
            `waypoint_cache_booking_${id}`,
            JSON.stringify({ accommodation: accomData }),
          ).catch(() => {});
          await loadLinkedDocument('accommodation', accomData.id).catch(() => {});
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
            const transportData: SavedItemTransportRecord = {
              id: (data as any).id,
              transport_type: parsed.transport_type ?? 'flight',
              operator: parsed.operator ?? parsed.airline ?? null,
              service_number: parsed.service_number ?? parsed.flight_number ?? null,
              origin_city: parsed.is_connection ? (parsed.legs?.[0]?.origin_city ?? null) : (parsed.origin_city ?? null),
              destination_city: parsed.is_connection
                ? (parsed.legs?.[parsed.legs.length - 1]?.destination_city ?? null)
                : (parsed.destination_city ?? null),
              departure_date: parsed.departure_date ?? null,
              departure_time: parsed.departure_time ?? null,
              arrival_date: parsed.arrival_date ?? null,
              arrival_time: parsed.arrival_time ?? null,
              booking_ref: parsed.booking_ref ?? null,
              seat: parsed.seat ?? null,
              gate: parsed.gate ?? null,
              terminal: parsed.terminal ?? null,
              coach: parsed.coach ?? null,
              platform: parsed.platform ?? null,
              origin_station: parsed.origin_station ?? null,
              destination_station: parsed.destination_station ?? null,
              pickup_point: parsed.pickup_point ?? null,
              dropoff_point: parsed.dropoff_point ?? null,
              deck: parsed.deck ?? null,
              cabin: parsed.cabin ?? null,
              port_terminal: parsed.port_terminal ?? null,
              is_connection: parsed.is_connection === true,
              legs: parsed.is_connection ? parsed.legs : undefined,
            };
            setSavedItemTransport(transportData);
            // Cache for offline — fire and forget
            AsyncStorage.setItem(
              `waypoint_cache_booking_${id}`,
              JSON.stringify({ savedItemTransport: transportData }),
            ).catch(() => {});
            await loadLinkedDocument('saved_place', (data as any).id).catch(() => {});
          } catch {
            setError('Could not parse transport details.');
          }
        }
      } else {
        // Journey-backed transport from leg_bookings
        const { data: lb, error: lbErr } = await supabase
          .from('leg_bookings')
          .select('id, journey_id, leg_id, operator, reference, seat, confirmation_ref, leg_order, origin_city, destination_city, departure_date, departure_time, arrival_date, arrival_time, extra_data')
          .eq('id', id)
          .single();

        if (lbErr || !lb) {
          setError('Could not load transport details.');
          setLoading(false);
          return;
        }

        const journeyId: string | null = (lb as any).journey_id ?? null;
        const legId: string = (lb as any).leg_id;

        // Fetch trip leg (for route hero) and journey + sibling leg_bookings in parallel
        const [tripLegResult, journeyResult, allLbResult] = await Promise.all([
          supabase
            .from('legs')
            .select('transport_type, departure_time, arrival_time, from_stop:from_stop_id(city, country), to_stop:to_stop_id(city, country)')
            .eq('id', legId)
            .single(),
          journeyId
            ? supabase.from('journeys').select('id, origin_city, destination_city').eq('id', journeyId).single()
            : Promise.resolve({ data: null, error: null }),
          journeyId
            ? supabase.from('leg_bookings').select('id, journey_id, operator, reference, seat, confirmation_ref, leg_order, origin_city, destination_city, departure_date, departure_time, arrival_date, arrival_time, extra_data').eq('journey_id', journeyId).order('leg_order', { ascending: true })
            : Promise.resolve({ data: [lb], error: null }),
        ]);

        const journeyData: JourneyDetail = {
          journey: (journeyResult as any).data as JourneyRecord | null,
          legBookings: ((allLbResult as any).data ?? [lb]) as JourneyLegBooking[],
          tripLeg: (tripLegResult as any).data as TripLeg | null,
          primaryLbId: (lb as any).id,
        };
        setJourneyDetail(journeyData);
        // Cache for offline — fire and forget
        AsyncStorage.setItem(
          `waypoint_cache_booking_${id}`,
          JSON.stringify({ journeyDetail: journeyData }),
        ).catch(() => {});
        await loadLinkedDocument('leg_booking', (lb as any).id).catch(() => {});
      }

      setLoading(false);
    };
    load();
  }, [id, type, source, isOnline, onlineRefreshTrigger]);

  // ── Linked document helpers ──────────────────────────────────────────────────

  async function loadLinkedDocument(linkableType: string, linkableId: string): Promise<void> {
    try {
      const { data } = await supabase
        .from('document_links')
        .select('document_id, document_files:document_id(storage_path, original_filename)')
        .eq('linkable_type', linkableType)
        .eq('linkable_id', linkableId)
        .limit(1)
        .maybeSingle();

      if (!data) return;
      const docFile = (data as any).document_files;
      if (!docFile) return;

      setLinkedDoc({
        id: (data as any).document_id,
        storage_path: docFile.storage_path,
        original_filename: docFile.original_filename,
      });
    } catch {
      // No linked doc — that's fine
    }
  }

  async function handleViewOriginal() {
    if (!linkedDoc) return;
    if (viewingDoc) return;
    setViewingDoc(true);
    try {
      // Check local cache first
      let localPath = await getLocalDocumentPath(linkedDoc.id);

      // Not cached — download if online
      if (!localPath) {
        if (!isOnline) {
          Alert.alert('Offline', 'This document is not available offline. Connect to the internet to download it.');
          return;
        }
        setLoadingDoc(true);
        localPath = await downloadDocumentOnDemand(
          linkedDoc.id,
          linkedDoc.storage_path,
          linkedDoc.original_filename,
          supabase,
        );
        setLoadingDoc(false);
      }

      if (!localPath) {
        Alert.alert('Could not open document', 'The file could not be downloaded. Please try again.');
        return;
      }

      await FileViewer.open(localPath, { showOpenWithDialog: true });
    } catch (e: any) {
      // FileViewer throws if no app can open the file
      Alert.alert('Could not open document', e?.message ?? 'No app available to open this file type.');
    } finally {
      setLoadingDoc(false);
      setViewingDoc(false);
    }
  }

  // ── Save a field ────────────────────────────────────────────────────────────

  async function saveAccommodationField(field: keyof AccommodationRecord, value: string) {
    if (!accommodation) return;
    if (!isOnline) { showOfflineToast(); return; }
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

  async function saveLegBookingField(
    lbId: string,
    field: 'operator' | 'reference' | 'seat' | 'confirmation_ref',
    value: string,
  ) {
    if (!isOnline) { showOfflineToast(); return; }
    const storedValue = value === '' ? null : value;
    const { error: updateErr } = await supabase
      .from('leg_bookings')
      .update({ [field]: storedValue })
      .eq('id', lbId);
    if (updateErr) {
      Alert.alert('Could not save', updateErr.message);
      return;
    }
    setJourneyDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        legBookings: prev.legBookings.map((lb) =>
          lb.id === lbId ? { ...lb, [field]: storedValue } : lb
        ),
      };
    });
  }

  async function saveLegExtraField(lbId: string, field: string, value: string) {
    if (!isOnline) { showOfflineToast(); return; }
    const lb = journeyDetail?.legBookings.find((l) => l.id === lbId);
    if (!lb) return;
    const storedValue = value === '' ? null : value;
    const updatedExtra = { ...(lb.extra_data ?? {}), [field]: storedValue };
    const { error: updateErr } = await supabase
      .from('leg_bookings')
      .update({ extra_data: updatedExtra })
      .eq('id', lbId);
    if (updateErr) {
      Alert.alert('Could not save', updateErr.message);
      return;
    }
    setJourneyDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        legBookings: prev.legBookings.map((l) =>
          l.id === lbId ? { ...l, extra_data: updatedExtra } : l
        ),
      };
    });
  }

  async function saveSavedItemTransportField(field: SavedItemEditableField, value: string) {
    if (!savedItemTransport) return;
    if (!isOnline) { showOfflineToast(); return; }
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
      gate: updated.gate,
      terminal: updated.terminal,
      coach: updated.coach,
      platform: updated.platform,
      origin_station: updated.origin_station,
      destination_station: updated.destination_station,
      pickup_point: updated.pickup_point,
      dropoff_point: updated.dropoff_point,
      deck: updated.deck,
      cabin: updated.cabin,
      port_terminal: updated.port_terminal,
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
    const isConnection = journeyDetail && journeyDetail.legBookings.length > 1;
    const label = type === 'accommodation' ? 'accommodation booking'
      : isConnection ? 'connection booking'
      : 'transport booking';
    const detail = isConnection
      ? 'This will remove the entire connection including all legs.'
      : 'This will permanently remove this booking.';
    Alert.alert(
      `Delete ${label}`,
      `${detail} Are you sure?`,
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
      if (type === 'accommodation') {
        const { error: deleteErr } = await supabase.from('accommodation').delete().eq('id', id);
        if (deleteErr) throw new Error(deleteErr.message);
      } else if (source === 'saved_items') {
        const { error: deleteErr } = await supabase.from('saved_items').delete().eq('id', id);
        if (deleteErr) throw new Error(deleteErr.message);
      } else {
        // Journey-backed: delete by journey_id (connection) or single lb
        const journeyId = journeyDetail?.journey?.id ?? null;
        if (journeyId && (journeyDetail?.legBookings.length ?? 0) > 1) {
          await deleteConnectionBooking(journeyId);
        } else {
          await deleteTransportBooking(journeyDetail?.primaryLbId ?? id);
        }
      }
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
    if (journeyDetail) {
      const from = journeyDetail.journey?.origin_city ?? journeyDetail.tripLeg?.from_stop?.city ?? '—';
      const to = journeyDetail.journey?.destination_city ?? journeyDetail.tripLeg?.to_stop?.city ?? '—';
      return `${from} → ${to}`;
    }
    return 'Transport';
  }

  function getSubtitle(): string | null {
    if (type === 'accommodation') return null;
    if (savedItemTransport) {
      return [savedItemTransport.operator, savedItemTransport.service_number].filter(Boolean).join(' · ') || null;
    }
    if (journeyDetail) {
      const isConnection = journeyDetail.legBookings.length > 1;
      if (isConnection) return `Connection · ${journeyDetail.legBookings.length} legs`;
      const lb = journeyDetail.legBookings[0];
      return [lb?.operator, lb?.reference].filter(Boolean).join(' · ') || null;
    }
    return null;
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

  if (error || (!accommodation && !journeyDetail && !savedItemTransport)) {
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
        {type === 'transport' && journeyDetail && (
          journeyDetail.legBookings.length > 1
            ? <ConnectionJourneyDetail
                detail={journeyDetail}
                onFieldSave={saveLegBookingField}
                onExtraFieldSave={saveLegExtraField}
              />
            : <SingleLegJourneyDetail
                detail={journeyDetail}
                onFieldSave={saveLegBookingField}
                onExtraFieldSave={saveLegExtraField}
              />
        )}
        {type === 'transport' && savedItemTransport && (
          savedItemTransport.is_connection && savedItemTransport.legs
            ? <SavedItemConnectionDetail record={savedItemTransport} />
            : <SavedItemTransportDetail
                record={savedItemTransport}
                onFieldSave={saveSavedItemTransportField}
              />
        )}

        {linkedDoc && (
          <Pressable
            style={({ pressed }) => [styles.viewDocButton, pressed && styles.viewDocButtonPressed]}
            onPress={handleViewOriginal}
            disabled={viewingDoc}
          >
            {loadingDoc ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Feather name="file-text" size={16} color={colors.primary} />
                <Text style={styles.viewDocButtonText}>View original document</Text>
              </>
            )}
          </Pressable>
        )}

        {/* Delete */}
        <View style={styles.deleteSection}>
          <Pressable
            style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed, !isOnline && { opacity: 0.4 }]}
            onPress={() => {
              if (!isOnline) { showOfflineToast(); return; }
              handleDeletePress();
            }}
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
  heroTypeBadge: {
    alignSelf: 'flex-start' as const,
    backgroundColor: '#EBF3F6',
    borderRadius: 5,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  heroTypeBadgeText: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.primary, letterSpacing: 0.2,
  },
  accessCodeRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#FDF5EF',
  },
  accessCodeLeft: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  accessCodeLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  accessCodeValue: {
    fontFamily: fonts.displayBold, fontSize: 22, color: colors.accent,
    letterSpacing: 2,
  },

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

  // Connection leg card
  connLegRouteHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  connLegRouteLeft: { flex: 1, gap: 4 },
  connLegLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  connLegRouteRow: { flexDirection: 'row', alignItems: 'center' },
  connLegCity: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.text, letterSpacing: -0.1 },
  connLegTimes: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  connLegTime: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.primary },
  connLegTimeArrow: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },

  // Connection route chain (intermediate stops in route hero)
  connRouteChain: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 4 },
  connRouteStop: { alignItems: 'center', gap: 2 },
  connRouteDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary, opacity: 0.5,
  },
  connRouteStopLabel: {
    fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, maxWidth: 60,
    textAlign: 'center',
  },

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

  // View original document
  viewDocButton: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.white,
    marginTop: 12, marginBottom: 4,
  },
  viewDocButtonPressed: { opacity: 0.7 },
  viewDocButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.primary },

  // Loading / error
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12, textAlign: 'center' },
  retryButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },
});
