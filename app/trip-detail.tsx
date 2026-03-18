import React, { useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import { createTransportBooking } from '@/lib/journeyUtils';
import { transportIcon } from '@/components/BookingPreviewSheet';
import ManualTransportSheet from '@/components/ManualTransportSheet';
import AddStopSheet from '@/components/AddStopSheet';
import type { PendingStop } from '@/components/AddStopSheet';
import type { StopOption } from '@/components/BookingPreviewSheet';
import type { ParsedBooking } from '@/lib/claude';

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

interface TransportItem {
  id: string;
  source: 'leg_bookings' | 'saved_items';
  transport_type: string;
  operator: string;
  service_number: string;
  origin_city: string;
  destination_city: string;
  departure_date: string | null;
  departure_time: string | null;
}

type ItineraryItem =
  | { kind: 'stop'; stop: DbStop; stopIndex: number }
  | { kind: 'leg'; leg: DbLeg; fromCity: string; toCity: string; transport: TransportItem[] }
  | { kind: 'gap'; fromCity: string; toCity: string; toStopId: string; transport: TransportItem[] };

// A stop as represented in local edit state
interface EditableStop {
  tempId: string;          // stable key for list rendering
  dbId: string | null;     // null = new stop not yet saved
  city: string;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface CollaboratorProfile {
  id: string;
  email: string;
}

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

function cityEq(a: string, b: string): boolean {
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}

function buildItinerary(
  stops: DbStop[],
  legs: DbLeg[],
  allTransport: TransportItem[],
): ItineraryItem[] {
  const legByStops = new Map(
    legs
      .filter(l => l.from_stop_id && l.to_stop_id)
      .map(l => [`${l.from_stop_id}:${l.to_stop_id}`, l]),
  );

  const items: ItineraryItem[] = [];
  for (let i = 0; i < stops.length; i++) {
    items.push({ kind: 'stop', stop: stops[i], stopIndex: i });
    if (i < stops.length - 1) {
      const fromStop = stops[i];
      const toStop = stops[i + 1];
      const key = `${fromStop.id}:${toStop.id}`;
      const leg = legByStops.get(key);
      const matched = allTransport.filter(
        (t) => cityEq(t.origin_city, fromStop.city) && cityEq(t.destination_city, toStop.city),
      );
      if (leg) {
        items.push({ kind: 'leg', leg, fromCity: fromStop.city, toCity: toStop.city, transport: matched });
      } else {
        items.push({
          kind: 'gap',
          fromCity: fromStop.city,
          toCity: toStop.city,
          toStopId: toStop.id,
          transport: matched,
        });
      }
    }
  }
  return items;
}

// Generate a temp ID (not cryptographic, just unique enough for local use)
function genTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

function StopRow({ item, onPress }: {
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

function LegRow({ item, onPress }: {
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

function GapRow({ item, onAddTransport, onTransportPress }: {
  item: Extract<ItineraryItem, { kind: 'gap' }>;
  onAddTransport: () => void;
  onTransportPress: (t: TransportItem) => void;
}) {
  const { fromCity, toCity, transport } = item;

  if (transport.length > 0) {
    const t = transport[0];
    const icon = transportIcon(t.transport_type);
    const meta = [
      t.departure_date
        ? (() => { const d = new Date(t.departure_date + 'T00:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; })()
        : null,
      t.departure_time || null,
    ].filter(Boolean).join(' · ');

    return (
      <Pressable
        style={({ pressed }) => [styles.gapRow, styles.gapRowFilled, pressed && styles.rowPressed]}
        onPress={() => onTransportPress(t)}
      >
        <View style={styles.gapIconWrapFilled}>
          <Feather name={icon} size={13} color={colors.primary} />
        </View>
        <View style={styles.gapTransportBody}>
          <Text style={styles.gapTransportRoute} numberOfLines={1}>
            {fromCity} → {toCity}
          </Text>
          <Text style={styles.gapTransportMeta} numberOfLines={1}>
            {[t.operator, t.service_number].filter(Boolean).join(' ')}
            {meta ? `  ·  ${meta}` : ''}
          </Text>
        </View>
        <Feather name="chevron-right" size={15} color={colors.border} />
      </Pressable>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.gapRow, pressed && styles.rowPressed]}
      onPress={onAddTransport}
    >
      <View style={styles.gapIconWrap}>
        <Feather name="plus" size={12} color={colors.primary} />
      </View>
      <Text style={styles.gapText} numberOfLines={1}>
        {fromCity} → {toCity}
      </Text>
      <Text style={styles.gapAction}>Add transport</Text>
    </Pressable>
  );
}

function Connector() {
  return (
    <View style={styles.connector}>
      <View style={styles.connectorLine} />
    </View>
  );
}

// Editable stop card shown in edit mode (inside DraggableFlatList)
function EditableStopCard({
  item,
  index,
  onDelete,
  drag,
  isActive,
}: {
  item: EditableStop;
  index: number;
  onDelete: () => void;
  drag: () => void;
  isActive: boolean;
}) {
  const dateRange = formatDateRange(item.start_date, item.end_date);
  return (
    <View style={[styles.editStopCard, isActive && styles.editStopCardActive]}>
      {/* Drag handle */}
      <Pressable onLongPress={drag} style={styles.dragHandle} hitSlop={8}>
        <Feather name="menu" size={20} color={colors.textMuted} />
      </Pressable>

      {/* Stop number + info */}
      <View style={styles.stopCircle}>
        <Text style={styles.stopNumber}>{index + 1}</Text>
      </View>
      <View style={styles.stopBody}>
        <Text style={styles.stopCity}>{item.city}</Text>
        {dateRange ? <Text style={styles.stopMeta}>{dateRange}</Text> : null}
      </View>

      {/* Delete button */}
      <Pressable onPress={onDelete} style={styles.deleteBtn} hitSlop={8}>
        <Feather name="minus-circle" size={22} color={colors.error} />
      </Pressable>
    </View>
  );
}

// ─── AvatarStack ─────────────────────────────────────────────────────────────

function getInitials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

interface AvatarStackProps {
  profiles: CollaboratorProfile[];
  onPress: () => void;
}

function AvatarStack({ profiles, onPress }: AvatarStackProps) {
  if (profiles.length === 0) return null;

  const visible = profiles.slice(0, 3);
  const overflow = profiles.length - visible.length;

  return (
    <Pressable style={avatarStackStyles.row} onPress={onPress} hitSlop={8}>
      {visible.map((p, i) => (
        <View
          key={p.id}
          style={[
            avatarStackStyles.avatar,
            i > 0 && avatarStackStyles.avatarOverlap,
          ]}
        >
          <Text style={avatarStackStyles.initials}>{getInitials(p.email)}</Text>
        </View>
      ))}
      {overflow > 0 && (
        <View style={[avatarStackStyles.avatar, avatarStackStyles.avatarOverlap, avatarStackStyles.overflowAvatar]}>
          <Text style={avatarStackStyles.overflowText}>+{overflow}</Text>
        </View>
      )}
      <Feather name="chevron-right" size={14} color={colors.textMuted} style={avatarStackStyles.chevron} />
    </Pressable>
  );
}

const avatarStackStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  avatar: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.primary,
    borderWidth: 2, borderColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarOverlap: { marginLeft: -8 },
  initials: { fontFamily: fonts.bodyBold, fontSize: 10, color: '#FFFFFF' },
  overflowAvatar: { backgroundColor: colors.textMuted },
  overflowText: { fontFamily: fonts.bodyBold, fontSize: 10, color: '#FFFFFF' },
  chevron: { marginLeft: 4 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripDetailScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<DbTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [stopOptions, setStopOptions] = useState<StopOption[]>([]);

  // Manual transport sheet state
  const [manualVisible, setManualVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeToStopId, setActiveToStopId] = useState<string | null>(null);

  // Overflow menu
  const [menuVisible, setMenuVisible] = useState(false);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editStops, setEditStops] = useState<EditableStop[]>([]);
  const [deletedStopIds, setDeletedStopIds] = useState<string[]>([]);
  const [showAddStop, setShowAddStop] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Collaborators (for avatar stack on shared trips)
  const [collaboratorProfiles, setCollaboratorProfiles] = useState<CollaboratorProfile[]>([]);

  // Toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchTrip = useCallback(async () => {
    if (!tripId) {
      setError('No trip specified.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;

    const { data, error: fetchError } = await supabase
      .from('trips')
      .select('*, stops(*), legs(*)')
      .eq('id', tripId)
      .single();

    if (fetchError || !data) {
      setError('Could not load this trip.');
      setLoading(false);
      return;
    }

    const raw = data as any;
    const sortedStops = (raw.stops as DbStop[])
      .slice()
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const sortedLegs = (raw.legs as DbLeg[])
      .slice()
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

    setTrip({ ...raw, stops: sortedStops, legs: sortedLegs });
    setStopOptions(sortedStops.map((s) => ({ id: s.id, city: s.city, tripName: raw.name ?? '' })));

    const stopIds = sortedStops.map((s) => s.id);
    if (stopIds.length === 0 || !userId) {
      setItinerary(buildItinerary(sortedStops, sortedLegs, []));
      setLoading(false);
      return;
    }

    const inboundLegIds = sortedLegs
      .filter((l) => l.to_stop_id && stopIds.includes(l.to_stop_id))
      .map((l) => l.id);

    const [journeyResult, savedTResult] = await Promise.all([
      supabase
        .from('journeys')
        .select('id, origin_city, destination_city, leg_id')
        .eq('trip_id', tripId!),
      supabase
        .from('saved_items')
        .select('id, stop_id, note')
        .in('stop_id', stopIds)
        .eq('creator_id', userId)
        .eq('category', 'Transport'),
    ]);

    const journeys = (journeyResult.data ?? []) as any[];
    const journeyIds = journeys.map((j: any) => j.id);

    const [journeyLbResult, oldLbResult] = await Promise.all([
      journeyIds.length > 0
        ? supabase
            .from('leg_bookings')
            .select('id, journey_id, leg_id, operator, reference')
            .in('journey_id', journeyIds)
            .eq('owner_id', userId)
        : Promise.resolve({ data: [], error: null }),
      inboundLegIds.length > 0
        ? supabase
            .from('leg_bookings')
            .select('id, leg_id, operator, reference')
            .in('leg_id', inboundLegIds)
            .eq('owner_id', userId)
            .is('journey_id', null)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const allTransport: TransportItem[] = [];

    const seenJourneys = new Set<string>();
    for (const lb of (journeyLbResult.data ?? []) as any[]) {
      const journey = journeys.find((j: any) => j.id === lb.journey_id);
      if (!journey) continue;
      if (seenJourneys.has(lb.journey_id)) continue;
      seenJourneys.add(lb.journey_id);
      allTransport.push({
        id: lb.id,
        source: 'leg_bookings',
        transport_type: 'flight',
        operator: lb.operator ?? '',
        service_number: lb.reference ?? '',
        origin_city: journey.origin_city,
        destination_city: journey.destination_city,
        departure_date: null,
        departure_time: null,
      });
    }

    for (const lb of (oldLbResult.data ?? []) as any[]) {
      const leg = sortedLegs.find((l) => l.id === lb.leg_id);
      if (!leg || !leg.to_stop_id || !leg.from_stop_id) continue;
      const fromStop = sortedStops.find((s) => s.id === leg.from_stop_id);
      const toStop = sortedStops.find((s) => s.id === leg.to_stop_id);
      if (!fromStop || !toStop) continue;
      allTransport.push({
        id: lb.id,
        source: 'leg_bookings',
        transport_type: 'flight',
        operator: lb.operator ?? '',
        service_number: lb.reference ?? '',
        origin_city: fromStop.city,
        destination_city: toStop.city,
        departure_date: null,
        departure_time: null,
      });
    }

    for (const sf of savedTResult.data ?? []) {
      try {
        const parsed = JSON.parse((sf as any).note ?? '{}');
        const isConnection = parsed.is_connection === true && Array.isArray(parsed.legs) && parsed.legs.length > 0;
        const firstLeg = isConnection ? parsed.legs[0] : parsed;
        const lastLeg  = isConnection ? parsed.legs[parsed.legs.length - 1] : parsed;
        const originCity: string = firstLeg?.origin_city ?? '';
        const destinationCity: string = lastLeg?.destination_city ?? '';
        if (!originCity || !destinationCity) continue;
        allTransport.push({
          id: (sf as any).id,
          source: 'saved_items',
          transport_type: firstLeg?.transport_type ?? 'flight',
          operator: firstLeg?.operator ?? firstLeg?.airline ?? '',
          service_number: firstLeg?.service_number ?? firstLeg?.flight_number ?? '',
          origin_city: originCity,
          destination_city: destinationCity,
          departure_date: firstLeg?.departure_date ?? null,
          departure_time: firstLeg?.departure_time ?? null,
        });
      } catch { /* skip malformed */ }
    }

    setItinerary(buildItinerary(sortedStops, sortedLegs, allTransport));

    // Fetch collaborators for avatar stack (non-blocking)
    const { data: memberRows } = await supabase
      .from('trip_members')
      .select('user_id')
      .eq('trip_id', tripId!);

    if (memberRows && memberRows.length > 0) {
      const memberIds = memberRows.map((m: { user_id: string }) => m.user_id);
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', memberIds);
      setCollaboratorProfiles((profileRows ?? []) as CollaboratorProfile[]);
    } else {
      setCollaboratorProfiles([]);
    }

    setLoading(false);
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      fetchTrip();
    }, [fetchTrip])
  );

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(message);
    toastOpacity.setValue(0);
    Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setToastMsg(null);
      });
    }, 4500);
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────

  function enterEditMode() {
    if (!trip) return;
    setEditStops(
      trip.stops.map((s) => ({
        tempId: s.id,
        dbId: s.id,
        city: s.city,
        country: s.country,
        start_date: s.start_date,
        end_date: s.end_date,
        latitude: null,
        longitude: null,
      }))
    );
    setDeletedStopIds([]);
    setEditMode(true);
  }

  function exitEditMode() {
    setEditMode(false);
    setEditStops([]);
    setDeletedStopIds([]);
  }

  function hasUnsavedChanges(): boolean {
    if (!trip) return false;
    if (deletedStopIds.length > 0) return true;
    if (editStops.some(s => s.dbId === null)) return true;
    // Check reorder: compare tempIds (which equal dbIds for existing stops) against original order
    for (let i = 0; i < editStops.length; i++) {
      if (editStops[i].dbId !== trip.stops[i]?.id) return true;
    }
    return false;
  }

  function handleCancel() {
    if (!hasUnsavedChanges()) {
      exitEditMode();
      return;
    }
    Alert.alert(
      'Discard changes?',
      "Your edits to stops haven't been saved.",
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: exitEditMode },
      ]
    );
  }

  // ── Add stop ──────────────────────────────────────────────────────────────

  function handleAddStop(pending: PendingStop) {
    setEditStops(prev => [
      ...prev,
      {
        tempId: genTempId(),
        dbId: null,
        city: pending.city,
        country: pending.country,
        start_date: pending.start_date,
        end_date: pending.end_date,
        latitude: pending.latitude,
        longitude: pending.longitude,
      },
    ]);
    setShowAddStop(false);
  }

  // ── Delete stop ───────────────────────────────────────────────────────────

  async function handleDeleteStop(stop: EditableStop) {
    // New stop not yet in DB — remove directly
    if (stop.dbId === null) {
      Alert.alert(
        `Remove ${stop.city}?`,
        'This stop will be removed from your trip.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => removeStopFromList(stop.tempId, null),
          },
        ]
      );
      return;
    }

    // Existing stop — fetch bookings that would be lost
    const [accomResult, eventsResult] = await Promise.all([
      supabase.from('accommodation').select('name').eq('stop_id', stop.dbId),
      supabase.from('events').select('title').eq('stop_id', stop.dbId).limit(10),
    ]);

    const lostItems: string[] = [
      ...(accomResult.data ?? []).map((a: any) => a.name ?? 'Accommodation'),
      ...(eventsResult.data ?? []).map((e: any) => e.title),
    ];

    if (lostItems.length === 0) {
      Alert.alert(
        `Remove ${stop.city}?`,
        'Remove this stop from your trip?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => removeStopFromList(stop.tempId, stop.dbId),
          },
        ]
      );
    } else {
      const preview = lostItems.slice(0, 5).join('\n');
      const extra = lostItems.length > 5 ? `\n…and ${lostItems.length - 5} more` : '';
      Alert.alert(
        `Remove ${stop.city}?`,
        `This will also delete:\n${preview}${extra}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => removeStopFromList(stop.tempId, stop.dbId),
          },
        ]
      );
    }
  }

  function removeStopFromList(tempId: string, dbId: string | null) {
    setEditStops(prev => prev.filter(s => s.tempId !== tempId));
    if (dbId) setDeletedStopIds(prev => [...prev, dbId]);
  }

  // ── Save changes ──────────────────────────────────────────────────────────

  async function handleDone() {
    if (!trip || editSaving) return;
    setEditSaving(true);

    try {
      // 1. Insert new stops
      const insertedIds = new Map<string, string>(); // tempId → real dbId
      const newStops = editStops.filter(s => s.dbId === null);

      for (const s of newStops) {
        const { data, error: insertErr } = await supabase
          .from('stops')
          .insert({
            trip_id: trip.id,
            city: s.city,
            country: s.country,
            latitude: s.latitude,
            longitude: s.longitude,
            start_date: s.start_date,
            end_date: s.end_date,
            order_index: 9999,
          })
          .select('id')
          .single();

        if (insertErr || !data) throw new Error(`Failed to add ${s.city}.`);
        insertedIds.set(s.tempId, data.id);
      }

      // 2. Build final stops with resolved IDs (for leg recalculation)
      const finalStops = editStops.map(s => ({
        ...s,
        resolvedId: s.dbId ?? insertedIds.get(s.tempId) ?? null,
      }));

      // 3. Delete legs that reference any stop being deleted
      //    (prevents FK violation when we delete the stops)
      if (deletedStopIds.length > 0) {
        const { data: orphanLegs } = await supabase
          .from('legs')
          .select('id')
          .eq('trip_id', trip.id)
          .or(
            deletedStopIds.map(id => `from_stop_id.eq.${id},to_stop_id.eq.${id}`).join(',')
          );

        if (orphanLegs && orphanLegs.length > 0) {
          await supabase.from('legs').delete().in('id', orphanLegs.map(l => l.id));
        }

        // 4. Delete the stops (cascades to accommodation, days, events, saved_items)
        await supabase.from('stops').delete().in('id', deletedStopIds);
      }

      // 5. Update order_index for all remaining stops
      const remainingStops = finalStops.filter(s => s.resolvedId !== null);
      for (let i = 0; i < remainingStops.length; i++) {
        await supabase
          .from('stops')
          .update({ order_index: i })
          .eq('id', remainingStops[i].resolvedId!);
      }

      // 6. Recalculate legs for new stop sequence
      const validStops = remainingStops.filter(s => s.resolvedId) as Array<{ resolvedId: string; city: string }>;
      const legChanges = await recalculateLegs(trip.id, validStops);

      // 7. Show toast about leg changes
      if (legChanges.added.length > 0 || legChanges.removed.length > 0) {
        const parts: string[] = [];
        if (legChanges.added.length > 0) {
          parts.push(`Added: ${legChanges.added.join(', ')}`);
        }
        if (legChanges.removed.length > 0) {
          parts.push(`Removed: ${legChanges.removed.join(', ')}`);
        }
        showToast(`Legs updated — ${parts.join('. ')}`);
      }

      // 8. Refresh data and exit edit mode
      exitEditMode();
      await fetchTrip();
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    } finally {
      setEditSaving(false);
    }
  }

  // ── Leg recalculation ─────────────────────────────────────────────────────

  async function recalculateLegs(
    tripId: string,
    orderedStops: Array<{ resolvedId: string; city: string }>,
  ): Promise<{ added: string[]; removed: string[] }> {
    // Fetch current legs
    const { data: currentLegs } = await supabase
      .from('legs')
      .select('id, from_stop_id, to_stop_id')
      .eq('trip_id', tripId);

    const legs = (currentLegs ?? []) as Array<{ id: string; from_stop_id: string | null; to_stop_id: string | null }>;

    // Expected consecutive pairs from new stop order
    const expectedPairs = new Map<string, { fromCity: string; toCity: string; orderIdx: number }>();
    for (let i = 0; i < orderedStops.length - 1; i++) {
      const key = `${orderedStops[i].resolvedId}:${orderedStops[i + 1].resolvedId}`;
      expectedPairs.set(key, {
        fromCity: orderedStops[i].city,
        toCity: orderedStops[i + 1].city,
        orderIdx: i,
      });
    }

    const existingPairKeys = new Set(
      legs
        .filter(l => l.from_stop_id && l.to_stop_id)
        .map(l => `${l.from_stop_id}:${l.to_stop_id}`)
    );

    // Legs to delete: existing but not expected
    const toDelete = legs.filter(
      l => l.from_stop_id && l.to_stop_id && !expectedPairs.has(`${l.from_stop_id}:${l.to_stop_id}`)
    );

    // Pairs to insert: expected but not existing
    const toInsert = Array.from(expectedPairs.entries()).filter(
      ([key]) => !existingPairKeys.has(key)
    );

    // Execute deletions
    if (toDelete.length > 0) {
      await supabase.from('legs').delete().in('id', toDelete.map(l => l.id));
    }

    // Execute insertions
    if (toInsert.length > 0) {
      await supabase.from('legs').insert(
        toInsert.map(([key, val]) => {
          const [fromId, toId] = key.split(':');
          return {
            trip_id: tripId,
            from_stop_id: fromId,
            to_stop_id: toId,
            order_index: val.orderIdx,
          };
        })
      );
    }

    // Update order_index for preserved legs
    const existingLegsMap = new Map(
      legs
        .filter(l => l.from_stop_id && l.to_stop_id)
        .map(l => [`${l.from_stop_id}:${l.to_stop_id}`, l])
    );
    for (const [key, val] of expectedPairs) {
      const leg = existingLegsMap.get(key);
      if (leg) {
        await supabase.from('legs').update({ order_index: val.orderIdx }).eq('id', leg.id);
      }
    }

    // Build human-readable change summaries
    const removedLegs = toDelete.map(l => {
      const fromStop = orderedStops.find(s => s.resolvedId === l.from_stop_id);
      const toStop = orderedStops.find(s => s.resolvedId === l.to_stop_id);
      // If stop was deleted its city won't be in orderedStops — fall back to IDs
      return `${fromStop?.city ?? '?'} → ${toStop?.city ?? '?'}`;
    });

    const addedLegs = toInsert.map(([, val]) => `${val.fromCity} → ${val.toCity}`);

    return { added: addedLegs, removed: removedLegs };
  }

  // ── Add transport (manual) ────────────────────────────────────────────────

  async function handleSaveManualTransport(booking: ParsedBooking, stopId: string | null) {
    if (booking.type !== 'transport') return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not signed in.');

      const targetStopId = stopId ?? activeToStopId;

      const { data: legs } = await supabase
        .from('legs')
        .select('id, from_stop:from_stop_id(city), to_stop:to_stop_id(city)')
        .eq('trip_id', tripId)
        .limit(50);

      const matchedLeg = (legs ?? []).find(
        (l: any) => cityEq(l.to_stop?.city ?? '', booking.destination_city ?? ''),
      );

      if (matchedLeg) {
        await createTransportBooking({
          tripId: tripId!,
          legId: matchedLeg.id,
          originCity: booking.origin_city ?? (matchedLeg as any).from_stop?.city ?? '',
          destinationCity: booking.destination_city ?? (matchedLeg as any).to_stop?.city ?? '',
          userId,
          operator: booking.operator,
          serviceNumber: booking.service_number,
          seat: booking.seat,
          confirmationRef: booking.booking_ref,
        });
      } else {
        await supabase.from('saved_items').insert({
          stop_id: targetStopId,
          creator_id: userId,
          name: `${booking.operator} ${booking.service_number}`.trim(),
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
          }),
        });
      }

      setManualVisible(false);
      setActiveToStopId(null);
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────
  const tripDateRange = formatDateRange(trip.start_date, trip.end_date);
  const nights = trip.stops.reduce((sum, s) => sum + stopNights(s), 0);
  const meta = [tripDateRange, nights > 0 ? `${nights} nights` : ''].filter(Boolean).join(' · ');

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar style="dark" />

      {/* ── Header ── */}
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.navRow}>
          {editMode ? (
            // Cancel button replaces back arrow in edit mode
            <Pressable style={styles.navTextButton} onPress={handleCancel} hitSlop={8}>
              <Text style={styles.navCancelText}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
              <Feather name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          )}

          <View style={styles.navSpacer} />

          {editMode ? (
            // Done button
            <Pressable
              style={styles.navTextButton}
              onPress={handleDone}
              disabled={editSaving}
              hitSlop={8}
            >
              {editSaving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.navDoneText}>Done</Text>
              )}
            </Pressable>
          ) : (
            // Three-dot overflow menu trigger
            <Pressable
              style={styles.overflowButton}
              onPress={() => setMenuVisible(true)}
              hitSlop={8}
            >
              <Feather name="more-horizontal" size={22} color={colors.text} />
            </Pressable>
          )}
        </View>

        <View style={styles.tripMeta}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeLabel}>
              {trip.type === 'multi' ? 'MULTI-STOP' : 'SINGLE'}
            </Text>
          </View>
          <Text style={styles.tripName}>{trip.name}</Text>
          {meta ? <Text style={styles.tripDetails}>{meta}</Text> : null}
          <AvatarStack
            profiles={collaboratorProfiles}
            onPress={() => router.push({ pathname: '/trip-settings', params: { tripId } })}
          />
        </View>
      </SafeAreaView>

      {/* ── Normal view ── */}
      {!editMode && (
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
                    onPress={() => {
                      const t = item.transport[0];
                      if (t) {
                        router.push({
                          pathname: '/booking-detail',
                          params: { type: 'transport', id: t.id, source: t.source },
                        });
                      } else {
                        router.push({ pathname: '/leg', params: { legId: item.leg.id } });
                      }
                    }}
                  />
                )}
                {item.kind === 'gap' && (
                  <GapRow
                    item={item}
                    onAddTransport={() => {
                      setActiveToStopId(item.toStopId);
                      setManualVisible(true);
                    }}
                    onTransportPress={(t) =>
                      router.push({
                        pathname: '/booking-detail',
                        params: { type: 'transport', id: t.id, source: t.source },
                      })
                    }
                  />
                )}
              </React.Fragment>
            ))
          )}
        </ScrollView>
      )}

      {/* ── Edit mode view ── */}
      {editMode && (
        <DraggableFlatList
          data={editStops}
          keyExtractor={(item) => item.tempId}
          onDragEnd={({ data }) => setEditStops(data)}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<EditableStop>) => (
            <ScaleDecorator activeScale={1.03}>
              <EditableStopCard
                item={item}
                index={getIndex() ?? 0}
                drag={drag}
                isActive={isActive}
                onDelete={() => handleDeleteStop(item)}
              />
            </ScaleDecorator>
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Feather name="map-pin" size={24} color={colors.border} />
              <Text style={styles.emptyText}>No stops — add one below</Text>
            </View>
          }
          ListFooterComponent={
            <Pressable
              style={styles.addStopBtn}
              onPress={() => setShowAddStop(true)}
            >
              <Feather name="plus" size={16} color={colors.primary} />
              <Text style={styles.addStopText}>Add Stop</Text>
            </Pressable>
          }
        />
      )}

      {/* ── Overflow menu modal ── */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuPopup}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                enterEditMode();
              }}
            >
              <Feather name="edit-2" size={15} color={colors.text} style={styles.menuIcon} />
              <Text style={styles.menuItemText}>Edit Stops</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                router.push({ pathname: '/trip-settings', params: { tripId } });
              }}
            >
              <Feather name="settings" size={15} color={colors.text} style={styles.menuIcon} />
              <Text style={styles.menuItemText}>Trip Settings</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── Add stop sheet ── */}
      <AddStopSheet
        visible={showAddStop}
        onAdd={handleAddStop}
        onClose={() => setShowAddStop(false)}
      />

      {/* ── Manual transport sheet ── */}
      <ManualTransportSheet
        visible={manualVisible}
        stops={stopOptions}
        saving={saving}
        onSave={handleSaveManualTransport}
        onDiscard={() => { setManualVisible(false); setActiveToStopId(null); }}
      />

      {/* ── Toast ── */}
      {toastMsg ? (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Text style={styles.toastText} numberOfLines={3}>{toastMsg}</Text>
        </Animated.View>
      ) : null}
    </GestureHandlerRootView>
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

  navRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  navSpacer: { flex: 1 },
  overflowButton: { width: 36, alignItems: 'flex-end' },
  navTextButton: { paddingHorizontal: 4, paddingVertical: 2 },
  navCancelText: { fontFamily: fonts.body, fontSize: 16, color: colors.textMuted },
  navDoneText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.primary },

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

  scrollContent: { padding: 16, paddingBottom: 48 },

  connector: { alignItems: 'center', height: 20 },
  connectorLine: { width: 2, flex: 1, backgroundColor: colors.border },

  // Stop row (normal mode)
  stopRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: 14, padding: 14,
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
  stopCity: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text, marginBottom: 2 },
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
  legRoute: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  legType: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, flexShrink: 0 },

  // Gap row
  gapRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  gapIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  gapText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
  gapAction: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary, flexShrink: 0 },
  gapRowFilled: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  gapIconWrapFilled: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#EBF3F6',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  gapTransportBody: { flex: 1 },
  gapTransportRoute: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text, marginBottom: 2 },
  gapTransportMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },

  // Edit mode stop card
  editStopCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: 14, padding: 12,
    marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  editStopCardActive: {
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  dragHandle: {
    paddingHorizontal: 4, paddingVertical: 8, marginRight: 8,
  },
  deleteBtn: { paddingLeft: 8 },

  // Add stop button
  addStopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addStopText: {
    fontFamily: fonts.bodyBold, fontSize: 15, color: colors.primary,
  },

  // Empty state
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

  // Overflow menu
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 100,
    paddingRight: 16,
  },
  menuPopup: {
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  menuIcon: { marginRight: 10 },
  menuItemText: {
    fontFamily: fonts.body, fontSize: 15, color: colors.text,
  },

  // Toast
  toast: {
    position: 'absolute',
    bottom: 36,
    left: 16,
    right: 16,
    backgroundColor: colors.text,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  toastText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.white,
    lineHeight: 20,
  },
});
