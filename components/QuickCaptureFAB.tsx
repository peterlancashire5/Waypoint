import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as FSFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import {
  parseBookingFile,
  mediaTypeFromUri,
  readAndPrepareBase64,
  type ParsedBooking,
  type ParsedContent,
  type TransportBooking,
} from '@/lib/claude';
import { enrichPlace } from '@/lib/placesEnrichment';
import { saveEnrichedPlace } from '@/lib/savedPlaceUtils';
import { checkDuplicate, confirmDuplicate } from '@/lib/duplicateCheck';
import {
  createTransportBooking,
  deleteTransportBooking,
  saveConnectionBooking,
  deleteConnectionBooking,
  startIncompleteJourney,
  addLegToJourney,
  buildExtraData,
} from '@/lib/journeyUtils';
import BookingPreviewSheet, { type StopOption, type LegGapOption } from '@/components/BookingPreviewSheet';
import Toast from '@/components/ui/Toast';
import { useNetworkStatus } from '@/context/NetworkContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StopWithDates extends StopOption {
  start_date: string | null;
  end_date: string | null;
  tripId: string;
}

interface SavedRecord {
  table: 'accommodation' | 'leg_bookings' | 'saved_items' | 'journeys' | 'journey_leg';
  id: string;
  /** Extra context needed to undo a 'journey_leg' record. */
  meta?: { journeyId: string; wasComplete: boolean };
}

/** An incomplete journey the user has already started — used for Scenario 2/3 detection. */
interface IncompleteJourneyRecord {
  id: string;
  tripId: string;
  legId: string;
  originCity: string;
  destinationCity: string;
  /** Destination city of the last leg_booking in this journey. */
  lastLegDestCity: string;
  lastLegOrder: number;
}

// ─── Matching logic ───────────────────────────────────────────────────────────

function cityMatches(stopCity: string, bookingCity: string | null | undefined): boolean {
  if (!bookingCity) return false;
  const a = stopCity.toLowerCase().trim();
  const b = bookingCity.toLowerCase().trim();
  return a.includes(b) || b.includes(a);
}

function datesWithin2Days(dateA: string | null, dateB: string | null): boolean {
  if (!dateA || !dateB) return false;
  const msA = new Date(dateA).getTime();
  const msB = new Date(dateB).getTime();
  return Math.abs(msA - msB) <= 2 * 24 * 60 * 60 * 1000;
}

interface MatchResult {
  stop: StopWithDates | null;
  confident: boolean;
}

function findBestMatch(stops: StopWithDates[], booking: ParsedBooking): MatchResult {
  if (stops.length === 0) return { stop: null, confident: false };

  // Transport and connections use the leg gap picker — never auto-save.
  if (booking.type === 'connection' || booking.type === 'transport') {
    return { stop: null, confident: false };
  }

  if (booking.type === 'accommodation') {
    const cityMatch = stops.filter((s) => cityMatches(s.city, booking.city));
    if (cityMatch.length === 0) return { stop: null, confident: false };

    // City + dates → confident
    for (const s of cityMatch) {
      if (datesWithin2Days(s.start_date, booking.check_in_date)) {
        return { stop: s, confident: true };
      }
    }
    return { stop: cityMatch[0], confident: false };

  } else {
    // 'other' — never auto-save
    const cityMatch = stops.filter((s) => cityMatches(s.city, (booking as any).city));
    return { stop: cityMatch[0] ?? null, confident: false };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the value only if it looks like HH:MM, otherwise null. */
function safeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{2}:\d{2}/.test(value) ? value : null;
}

// ─── Save booking ─────────────────────────────────────────────────────────────

async function saveBooking(
  booking: ParsedBooking,
  stopId: string | null,
  userId: string,
  tripId?: string | null,
): Promise<SavedRecord | null> {
  if (booking.type === 'accommodation' && stopId) {
    const insertPayload = {
      stop_id: stopId,
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
    };
    console.log('[saveBooking] accommodation insert payload:', JSON.stringify(insertPayload));
    const { data, error } = await supabase
      .from('accommodation')
      .insert(insertPayload)
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Save failed');
    return { table: 'accommodation', id: (data as any).id };

  } else if (booking.type === 'transport' && stopId) {
    // stopId is the to_stop_id of the selected leg gap; filter by tripId when known
    const legQuery = supabase
      .from('legs')
      .select('id, trip_id, from_stop:from_stop_id(city), to_stop:to_stop_id(city)')
      .eq('to_stop_id', stopId);
    const { data: legs } = await (tripId ? legQuery.eq('trip_id', tripId) : legQuery).limit(1);

    const matchedLeg = (legs ?? [])[0] ?? null;

    if (matchedLeg) {
      const lbId = await createTransportBooking({
        tripId: (matchedLeg as any).trip_id,
        legId: matchedLeg.id,
        originCity: booking.origin_city ?? (matchedLeg as any).from_stop?.city ?? '',
        destinationCity: booking.destination_city ?? (matchedLeg as any).to_stop?.city ?? '',
        userId,
        operator: booking.operator,
        serviceNumber: booking.service_number,
        seat: booking.seat,
        confirmationRef: booking.booking_ref,
        extraData: buildExtraData(booking) ?? undefined,
      });
      return { table: 'leg_bookings', id: lbId };
    }

    const { data, error } = await supabase
      .from('saved_items')
      .insert({
        stop_id: stopId,
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
          gate: booking.gate,
          terminal: booking.terminal,
          coach: booking.coach,
          platform: booking.platform,
          origin_station: booking.origin_station,
          destination_station: booking.destination_station,
          pickup_point: booking.pickup_point,
          dropoff_point: booking.dropoff_point,
          deck: booking.deck,
          cabin: booking.cabin,
          port_terminal: booking.port_terminal,
        }),
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Save failed');
    return { table: 'saved_items', id: (data as any).id };

  } else if (booking.type === 'connection' && stopId) {
    const lastLeg = booking.legs[booking.legs.length - 1];
    const firstLeg = booking.legs[0];

    // stopId is the to_stop_id of the selected leg gap; filter by tripId when known
    const connLegQuery = supabase
      .from('legs')
      .select('id, trip_id, from_stop:from_stop_id(city), to_stop:to_stop_id(city)')
      .eq('to_stop_id', stopId);
    const { data: legs } = await (tripId ? connLegQuery.eq('trip_id', tripId) : connLegQuery).limit(1);

    const matchedLeg = (legs ?? [])[0] ?? null;

    if (matchedLeg) {
      const journeyId = await saveConnectionBooking({
        tripId: (matchedLeg as any).trip_id,
        legId: matchedLeg.id,
        originCity: firstLeg?.origin_city ?? (matchedLeg as any).from_stop?.city ?? '',
        destinationCity: lastLeg?.destination_city ?? (matchedLeg as any).to_stop?.city ?? '',
        userId,
        confirmationRef: booking.booking_ref,
        legs: booking.legs.map((leg) => ({
          originCity: leg.origin_city,
          destinationCity: leg.destination_city,
          operator: leg.operator ?? null,
          serviceNumber: leg.service_number ?? null,
          seat: leg.seat ?? null,
          legOrder: leg.leg_order,
          extraData: buildExtraData(leg) ?? undefined,
        })),
      });
      return { table: 'journeys', id: journeyId };
    }

    // Fallback — save first leg as a saved_item
    const { data, error } = await supabase
      .from('saved_items')
      .insert({
        stop_id: stopId,
        creator_id: userId,
        name: `${firstLeg?.operator ?? ''} connection`.trim(),
        category: 'Transport',
        note: JSON.stringify({ is_connection: true, booking_ref: booking.booking_ref, legs: booking.legs }),
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Save failed');
    return { table: 'saved_items', id: (data as any).id };

  } else {
    const { data, error } = await supabase
      .from('saved_items')
      .insert({
        stop_id: stopId,
        creator_id: userId,
        name: booking.type === 'other' ? booking.description : 'Booking document',
        note: booking.type === 'other' ? (booking.description ?? '') : '',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Save failed');
    return { table: 'saved_items', id: (data as any).id };
  }
}

async function undoSave(record: SavedRecord): Promise<void> {
  if (record.table === 'journeys') {
    await deleteConnectionBooking(record.id);
  } else if (record.table === 'journey_leg' && record.meta) {
    // Undo an added leg: delete the leg_booking and revert is_complete
    await supabase.from('leg_bookings').delete().eq('id', record.id);
    await supabase.from('journeys')
      .update({ is_complete: record.meta.wasComplete })
      .eq('id', record.meta.journeyId);
  } else if (record.table === 'leg_bookings') {
    await deleteTransportBooking(record.id);
  } else {
    await supabase.from(record.table as any).delete().eq('id', record.id);
  }
}


// ─── Source picker sheet ──────────────────────────────────────────────────────

function SourcePickerSheet({
  visible,
  onUploadFile,
  onChoosePhoto,
  onTakePhoto,
  onClose,
}: {
  visible: boolean;
  onUploadFile: () => void;
  onChoosePhoto: () => void;
  onTakePhoto: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 65,
      friction: 12,
    }).start();
  }, [visible]);

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [280, 0] });

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={sheetStyles.overlay} />
      </TouchableWithoutFeedback>
      <Animated.View
        style={[
          sheetStyles.sheet,
          { transform: [{ translateY }], paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={sheetStyles.handle} />
        <Text style={sheetStyles.title}>Add booking</Text>

        <Pressable
          style={({ pressed }) => [sheetStyles.row, pressed && sheetStyles.rowPressed]}
          onPress={() => { onClose(); setTimeout(onUploadFile, 300); }}
        >
          <View style={sheetStyles.iconWrap}>
            <Feather name="upload" size={20} color={colors.primary} />
          </View>
          <View style={sheetStyles.rowText}>
            <Text style={sheetStyles.rowLabel}>Upload file</Text>
            <Text style={sheetStyles.rowSub}>PDF, JPEG, or PNG confirmation</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.border} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [sheetStyles.row, pressed && sheetStyles.rowPressed]}
          onPress={() => { onClose(); setTimeout(onChoosePhoto, 300); }}
        >
          <View style={sheetStyles.iconWrap}>
            <Feather name="image" size={20} color={colors.primary} />
          </View>
          <View style={sheetStyles.rowText}>
            <Text style={sheetStyles.rowLabel}>Choose from photos</Text>
            <Text style={sheetStyles.rowSub}>Pick from your camera roll</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.border} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [sheetStyles.row, pressed && sheetStyles.rowPressed]}
          onPress={() => { onClose(); setTimeout(onTakePhoto, 300); }}
        >
          <View style={sheetStyles.iconWrap}>
            <Feather name="camera" size={20} color={colors.primary} />
          </View>
          <View style={sheetStyles.rowText}>
            <Text style={sheetStyles.rowLabel}>Take a photo</Text>
            <Text style={sheetStyles.rowSub}>Photograph a printed confirmation</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.border} />
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 20, elevation: 16,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 20,
  },
  title: {
    fontFamily: fonts.displayBold, fontSize: 20, color: colors.text,
    letterSpacing: -0.2, marginBottom: 8, paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 16,
  },
  rowPressed: { backgroundColor: colors.background },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#EBF3F6', alignItems: 'center', justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text, marginBottom: 2 },
  rowSub: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
});

// ─── Parsing overlay ──────────────────────────────────────────────────────────

function ParsingOverlay() {
  return (
    <View style={parseStyles.overlay} pointerEvents="none">
      <View style={parseStyles.pill}>
        <Feather name="loader" size={16} color={colors.primary} />
        <Text style={parseStyles.text}>Reading booking…</Text>
      </View>
    </View>
  );
}

const parseStyles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(248,247,245,0.85)',
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.white, borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 6,
  },
  text: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
});

// ─── Main FAB component ───────────────────────────────────────────────────────

export default function QuickCaptureFAB() {
  const { isOnline, showOfflineToast } = useNetworkStatus();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedBooking, setParsedBooking] = useState<ParsedBooking | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allStops, setAllStops] = useState<StopWithDates[]>([]);
  const [allLegGaps, setAllLegGaps] = useState<LegGapOption[]>([]);
  const [allIncompleteJourneys, setAllIncompleteJourneys] = useState<IncompleteJourneyRecord[]>([]);
  const [stopsLoaded, setStopsLoaded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<SavedRecord | null>(null);
  const [sourceFileUri, setSourceFileUri] = useState<string | null>(null);
  const [sourceMediaType, setSourceMediaType] = useState<string | null>(null);

  // ── Load stops + leg gaps on mount ──────────────────────────────────────
  //
  // Gap options are derived from stop order rather than from the legs table.
  // The legs table has an RLS edge-case (is_trip_member returns false for
  // both flat and nested selects in this context) yielding empty results.
  // Gaps are inferred by sorting each trip's stops by order_index and pairing
  // consecutive entries — the gap id is the destination stop's id, which
  // saveBooking already uses to look up the real leg via to_stop_id.
  //
  // A useRef guard ensures loadData runs exactly once even if state updates
  // inside it trigger re-renders before the queries complete.

  const dataLoadedRef = useRef(false);

  useEffect(() => {
    if (dataLoadedRef.current) return;
    dataLoadedRef.current = true;
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const userId = session.user.id;

    // 1. Trips — needed for the trip name label in both pickers.
    const { data: tripsData } = await supabase
      .from('trips')
      .select('id, name')
      .limit(100);

    const tripNameMap = new Map<string, string>();
    for (const t of (tripsData as any[] ?? [])) {
      tripNameMap.set(t.id, t.name ?? 'Trip');
    }

    // 2. Stops — include order_index so we can derive inter-stop gaps without
    //    touching the legs table. Direct queries on legs hit an RLS edge-case
    //    (is_trip_member returns false for flat/nested selects) yielding empty
    //    results. Gaps are instead inferred from consecutive stop order.
    const { data: stopsData } = await supabase
      .from('stops')
      .select('id, city, trip_id, order_index, start_date, end_date')
      .limit(200);

    const stops: StopWithDates[] = [];
    const stopsByTrip = new Map<string, Array<{ id: string; city: string; order_index: number | null }>>();

    for (const s of (stopsData as any[] ?? [])) {
      stops.push({
        id: s.id,
        city: s.city,
        tripName: tripNameMap.get(s.trip_id) ?? 'Trip',
        start_date: s.start_date,
        end_date: s.end_date,
        tripId: s.trip_id,
      });
      const bucket = stopsByTrip.get(s.trip_id) ?? [];
      bucket.push({ id: s.id, city: s.city, order_index: s.order_index ?? 0 });
      stopsByTrip.set(s.trip_id, bucket);
    }

    // 3. Derive gap options from consecutive stops within each trip (tripId included).
    const gaps: LegGapOption[] = [];
    for (const [tripId, tripStops] of stopsByTrip) {
      const sorted = tripStops.slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      const tripName = tripNameMap.get(tripId) ?? 'Trip';
      for (let i = 1; i < sorted.length; i++) {
        gaps.push({
          id: sorted[i].id,
          fromStopId: sorted[i - 1].id,
          fromCity: sorted[i - 1].city,
          toCity: sorted[i].city,
          tripName,
          tripId,
        });
      }
    }

    // 4. Incomplete journeys — needed for Scenario 2/3 connection detection.
    //    Fetch journeys where is_complete=false, then grab the last leg_booking's
    //    destination_city (populated since Phase 6 migration) to know where each
    //    journey's last segment ended.
    const { data: incomplJourneysData } = await supabase
      .from('journeys')
      .select('id, trip_id, leg_id, origin_city, destination_city')
      .eq('is_complete', false)
      .limit(50);

    const journeyList = incomplJourneysData as any[] ?? [];
    const incomplete: IncompleteJourneyRecord[] = [];

    if (journeyList.length > 0) {
      const journeyIds = journeyList.map((j: any) => j.id);
      const { data: lastLegsData } = await supabase
        .from('leg_bookings')
        .select('journey_id, leg_order, destination_city')
        .in('journey_id', journeyIds)
        .eq('owner_id', userId)
        .order('leg_order', { ascending: false });

      // Build map: journeyId → highest-leg-order entry (first due to desc ordering)
      const lastLegMap = new Map<string, { destCity: string; legOrder: number }>();
      for (const lb of (lastLegsData as any[] ?? [])) {
        if (!lastLegMap.has(lb.journey_id) && lb.destination_city) {
          lastLegMap.set(lb.journey_id, {
            destCity: lb.destination_city,
            legOrder: lb.leg_order ?? 1,
          });
        }
      }

      for (const j of journeyList) {
        const lastLeg = lastLegMap.get(j.id);
        if (lastLeg) {
          incomplete.push({
            id: j.id,
            tripId: j.trip_id,
            legId: j.leg_id,
            originCity: j.origin_city ?? '',
            destinationCity: j.destination_city ?? '',
            lastLegDestCity: lastLeg.destCity,
            lastLegOrder: lastLeg.legOrder,
          });
        }
      }
    }

    setAllStops(stops);
    setAllLegGaps(gaps);
    setAllIncompleteJourneys(incomplete);
    setStopsLoaded(true);
  }

  function handleFABPress() {
    if (!isOnline) { showOfflineToast(); return; }
    setSheetVisible(true);
  }

  // ── File handlers ────────────────────────────────────────────────────────

  async function handleUploadFile() {
    setParsing(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const rawMediaType = mediaTypeFromUri(asset.uri, asset.mimeType);
      setSourceFileUri(asset.uri);
      setSourceMediaType(rawMediaType);
      const { base64, mediaType } = await readAndPrepareBase64(asset.uri, rawMediaType);
      const booking = await parseBookingFile(base64, mediaType);
      await handleParsed(booking);
    } catch (err: any) {
      Alert.alert('Could not read booking', err?.message ?? 'Please try again.');
    } finally {
      setParsing(false);
    }
  }

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera access required', 'Please enable camera access in Settings.');
      return;
    }

    setParsing(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        base64: false,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const rawMediaType = mediaTypeFromUri(asset.uri, asset.mimeType ?? undefined);
      setSourceFileUri(asset.uri);
      setSourceMediaType(rawMediaType);
      const { base64, mediaType } = await readAndPrepareBase64(asset.uri, rawMediaType);
      const booking = await parseBookingFile(base64, mediaType);
      await handleParsed(booking);
    } catch (err: any) {
      Alert.alert('Could not read photo', err?.message ?? 'Please try again.');
    } finally {
      setParsing(false);
    }
  }

  async function handleChoosePhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo library access required', 'Please enable photo library access in Settings.');
      return;
    }

    setParsing(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        base64: false,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const rawMediaType = mediaTypeFromUri(asset.uri, asset.mimeType ?? undefined);
      setSourceFileUri(asset.uri);
      setSourceMediaType(rawMediaType);
      const { base64, mediaType } = await readAndPrepareBase64(asset.uri, rawMediaType);
      const booking = await parseBookingFile(base64, mediaType);
      await handleParsed(booking);
    } catch (err: any) {
      Alert.alert('Could not read photo', err?.message ?? 'Please try again.');
    } finally {
      setParsing(false);
    }
  }

  // ── Matching + connection detection ──────────────────────────────────────

  async function handleParsed(parsed: ParsedContent) {
    // ── Place recommendation ───────────────────────────────────────────────
    if (parsed.type === 'place') {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) throw new Error('Not authenticated.');

        const enriched = await enrichPlace(parsed.name, parsed.city, parsed.category);
        const result = await saveEnrichedPlace(enriched, parsed.note, session.user.id);

        if (result.duplicate) {
          setToastMessage(
            `${result.name} is already saved to ${result.city ?? 'this stop'}`,
          );
        } else if (result.match.matched === 'single') {
          setToastMessage(`Saved ${result.item.name} to ${result.item.city ?? 'your trip'}`);
        } else {
          setToastMessage(`${result.item.name} saved to Inbox`);
        }
      } catch (err: any) {
        Alert.alert('Could not save place', err?.message ?? 'Please try again.');
      }
      return;
    }

    // ── Booking confirmation ───────────────────────────────────────────────
    const booking: ParsedBooking = parsed;

    // For single-segment transport bookings, run smart connection detection
    // before falling through to the standard gap picker.
    if (booking.type === 'transport') {
      const originCity = booking.origin_city;
      const destCity = booking.destination_city;

      if (originCity && destCity) {
        // Scenario 2/3: the booking's origin matches the last leg of an
        // incomplete journey — prompt to add it as the next leg.
        const journeyMatch = allIncompleteJourneys.find((j) =>
          cityMatches(j.lastLegDestCity, originCity)
        );
        if (journeyMatch) {
          showAddToJourneyPrompt(booking, journeyMatch);
          return;
        }

        // Scenario 1: origin matches a gap's start city but destination
        // doesn't match that gap's end city — might be a connection leg.
        const partialGap = allLegGaps.find((g) =>
          cityMatches(g.fromCity, originCity) && !cityMatches(g.toCity, destCity)
        );
        if (partialGap) {
          showConnectionPrompt(booking, partialGap);
          return;
        }
      }
    }

    // Standard flow: accommodation auto-saves when confident; everything
    // else (or transport with a direct gap match) goes to the preview sheet.
    const { stop, confident } = findBestMatch(allStops, booking);

    if (confident && stop) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) throw new Error('Not authenticated.');

        const duplicate = await checkDuplicate(booking, session.user.id);
        if (duplicate) {
          const proceed = await confirmDuplicate(duplicate);
          if (!proceed) return;
        }

        const record = await saveBooking(booking, stop.id, session.user.id);
        if (record) {
          setLastSaved(record);
          if (sourceFileUri && sourceMediaType) {
            uploadSourceDocument(record, sourceFileUri, sourceMediaType, session.user.id, stop.tripId).catch(() => {});
            setSourceFileUri(null);
            setSourceMediaType(null);
          }
        }
        setToastMessage(`Saved to ${stop.city}`);
      } catch {
        setParsedBooking(booking);
        setPreviewVisible(true);
      }
    } else {
      setParsedBooking(booking);
      setPreviewVisible(true);
    }
  }

  // ── Scenario 1: partial gap match ────────────────────────────────────────
  // Origin matches a gap start but destination doesn't match the gap end.
  // Prompt: is this the first leg of a connection to {gap.toCity}?

  function showConnectionPrompt(booking: TransportBooking, gap: LegGapOption) {
    Alert.alert(
      'Connection to ' + gap.toCity + '?',
      `This booking goes to ${booking.destination_city}, not ${gap.toCity}. Is it the first leg of a connection?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'No, save as standalone',
          onPress: () => { setParsedBooking(booking); setPreviewVisible(true); },
        },
        {
          text: `Yes, connection to ${gap.toCity}`,
          onPress: () => handleStartConnection(booking, gap),
        },
      ],
    );
  }

  async function handleStartConnection(booking: TransportBooking, gap: LegGapOption) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    // Look up the actual leg record for this gap using both trip_id and to_stop_id.
    // If the leg doesn't exist yet (create-trip only inserts stops, not legs),
    // create it on demand so the journey can be saved with a valid leg_id.
    let legId: string | null = null;
    try {
      const { data: legsData } = await supabase
        .from('legs')
        .select('id')
        .eq('trip_id', gap.tripId)
        .eq('to_stop_id', gap.id)
        .limit(1);

      legId = (legsData as any[])?.[0]?.id ?? null;

      if (!legId) {
        // Leg doesn't exist — create it now using the from/to stop IDs from the gap.
        const { data: newLeg, error: legCreateErr } = await supabase
          .from('legs')
          .insert({
            trip_id: gap.tripId,
            from_stop_id: gap.fromStopId,
            to_stop_id: gap.id,
            transport_type: booking.transport_type,
          })
          .select('id')
          .single();
        if (legCreateErr || !newLeg) {
          throw new Error(legCreateErr?.message ?? 'Could not create trip leg');
        }
        legId = (newLeg as any).id as string;
      }
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
      return;
    }

    try {
      const journeyId = await startIncompleteJourney({
        tripId: gap.tripId,
        legId,
        journeyOriginCity: gap.fromCity,
        journeyDestinationCity: gap.toCity,
        legOriginCity: booking.origin_city,
        legDestinationCity: booking.destination_city,
        userId: session.user.id,
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

      // Update local state so a subsequent upload can detect the next leg
      setAllIncompleteJourneys((prev) => [
        ...prev,
        {
          id: journeyId,
          tripId: gap.tripId,
          legId,
          originCity: gap.fromCity,
          destinationCity: gap.toCity,
          lastLegDestCity: booking.destination_city,
          lastLegOrder: 1,
        },
      ]);

      const savedRecord: SavedRecord = { table: 'journeys', id: journeyId };
      setLastSaved(savedRecord);
      if (sourceFileUri && sourceMediaType) {
        uploadSourceDocument(savedRecord, sourceFileUri, sourceMediaType, session.user.id, gap.tripId).catch(() => {});
        setSourceFileUri(null);
        setSourceMediaType(null);
      }
      setToastMessage(`Started journey ${gap.fromCity} → ${gap.toCity}`);
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    }
  }

  // ── Scenario 2/3: incomplete journey match ────────────────────────────────
  // Booking's origin matches where the last leg of an incomplete journey ended.
  // Prompt: is this the next leg of that journey?

  function showAddToJourneyPrompt(booking: TransportBooking, journey: IncompleteJourneyRecord) {
    Alert.alert(
      'Continue journey?',
      `Is this the next leg of your ${journey.originCity} → ${journey.destinationCity} journey?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'No, save separately',
          onPress: () => { setParsedBooking(booking); setPreviewVisible(true); },
        },
        {
          text: 'Yes, add as next leg',
          onPress: () => handleAddNextLeg(booking, journey),
        },
      ],
    );
  }

  async function handleAddNextLeg(booking: TransportBooking, journey: IncompleteJourneyRecord) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const newLegOrder = journey.lastLegOrder + 1;
    const isNowComplete = cityMatches(booking.destination_city, journey.destinationCity);

    try {
      const lbId = await addLegToJourney({
        journeyId: journey.id,
        legId: journey.legId,
        userId: session.user.id,
        originCity: booking.origin_city,
        destinationCity: booking.destination_city,
        operator: booking.operator,
        serviceNumber: booking.service_number,
        seat: booking.seat,
        confirmationRef: booking.booking_ref ?? null,
        legOrder: newLegOrder,
        departureDate: booking.departure_date ?? null,
        departureTime: booking.departure_time ?? null,
        arrivalDate: booking.arrival_date ?? null,
        arrivalTime: booking.arrival_time ?? null,
        extraData: buildExtraData(booking) ?? undefined,
        isComplete: isNowComplete,
      });

      // Update local incomplete journey state
      setAllIncompleteJourneys((prev) =>
        isNowComplete
          ? prev.filter((j) => j.id !== journey.id)
          : prev.map((j) =>
              j.id === journey.id
                ? { ...j, lastLegDestCity: booking.destination_city, lastLegOrder: newLegOrder }
                : j
            )
      );

      const toastText = isNowComplete
        ? `Journey complete! ${journey.originCity} → ${journey.destinationCity}`
        : `Leg added to ${journey.originCity} → ${journey.destinationCity} journey`;

      const savedRecord: SavedRecord = {
        table: 'journey_leg',
        id: lbId,
        meta: { journeyId: journey.id, wasComplete: false },
      };
      setLastSaved(savedRecord);
      if (sourceFileUri && sourceMediaType) {
        uploadSourceDocument(savedRecord, sourceFileUri, sourceMediaType, session.user.id, journey.tripId).catch(() => {});
        setSourceFileUri(null);
        setSourceMediaType(null);
      }
      setToastMessage(toastText);
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    }
  }

  // ── Manual save (from BookingPreviewSheet) ───────────────────────────────

  async function handleManualSave(booking: ParsedBooking, stopId: string | null) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not authenticated.');

      const duplicate = await checkDuplicate(booking, session.user.id);
      if (duplicate) {
        const proceed = await confirmDuplicate(duplicate);
        if (!proceed) return; // keep preview sheet open
      }

      setSaving(true);
      // Only transport/connection bookings can match a leg gap — accommodation always goes to a stop
      const isTransportBooking = booking.type === 'transport' || booking.type === 'connection';
      const savedGap = isTransportBooking ? allLegGaps.find((g) => g.id === stopId) : null;
      const record = await saveBooking(booking, stopId, session.user.id, savedGap?.tripId ?? null);
      setPreviewVisible(false);
      setParsedBooking(null);
      if (record && sourceFileUri && sourceMediaType) {
        const tripId = savedGap?.tripId ?? allStops.find((s) => s.id === stopId)?.tripId ?? null;
        uploadSourceDocument(record, sourceFileUri, sourceMediaType, session.user.id, tripId).catch(() => {});
        setSourceFileUri(null);
        setSourceMediaType(null);
      }
      const savedStop = allStops.find((s) => s.id === stopId);
      if (savedGap) setToastMessage(`Saved ${savedGap.fromCity} → ${savedGap.toCity}`);
      else if (savedStop) setToastMessage(`Saved to ${savedStop.city}`);
    } catch (err: any) {
      Alert.alert('Could not save booking', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Background document upload ────────────────────────────────────────────
  // Fire-and-forget — upload failures are silent and never affect the booking save flow.

  async function uploadSourceDocument(
    record: SavedRecord,
    fileUri: string,
    mimeType: string,
    userId: string,
    tripId: string | null,
  ): Promise<void> {
    try {
      // Map mimeType → file_type (DB enum) and storage extension
      const fileTypeMap: Record<string, 'pdf' | 'jpg' | 'png'> = {
        'application/pdf': 'pdf',
        'image/jpeg': 'jpg',
        'image/png': 'png',
      };
      const fileType = fileTypeMap[mimeType] ?? 'jpg';
      const storageExt = fileType === 'jpg' ? 'jpeg' : fileType;

      // Read file as ArrayBuffer using the new expo-file-system File API
      const fsFile = new FSFile(fileUri);
      const arrayBuffer = await fsFile.arrayBuffer();

      // Upload to Storage: documents/{userId}/{uuid}.{ext}
      const storagePath = `${userId}/${crypto.randomUUID()}.${storageExt}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, arrayBuffer, {
          contentType: mimeType,
          upsert: false,
        });
      if (uploadError) return;

      // Insert document_files row
      const originalFilename = `document.${fileType === 'jpg' ? 'jpg' : fileType}`;
      const { data: docFile, error: docError } = await supabase
        .from('document_files')
        .insert({
          user_id: userId,
          trip_id: tripId,
          storage_path: storagePath,
          file_type: fileType,
          original_filename: originalFilename,
        })
        .select('id')
        .single();
      if (docError || !docFile) return;

      // Insert document_links row (only for linkable types)
      const linkableTypeMap: Partial<Record<SavedRecord['table'], string>> = {
        accommodation: 'accommodation',
        leg_bookings: 'leg_booking',
        journey_leg: 'leg_booking',
        saved_items: 'saved_place',
        // journeys: skip (no direct linkable_type for multi-leg journeys)
      };
      const linkableType = linkableTypeMap[record.table];
      if (linkableType) {
        await supabase.from('document_links').insert({
          document_id: (docFile as any).id,
          linkable_type: linkableType,
          linkable_id: record.id,
        });
      }
    } catch (e) {
      console.warn('[QuickCaptureFAB] uploadSourceDocument failed:', e);
    }
  }

  // ── Undo ─────────────────────────────────────────────────────────────────

  async function handleUndo() {
    if (!lastSaved) return;
    try {
      await undoSave(lastSaved);
    } catch { /* silent */ }
    setLastSaved(null);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  // Convert stops to StopOption[] for BookingPreviewSheet
  const stopOptions: StopOption[] = allStops.map((s) => ({
    id: s.id,
    city: s.city,
    tripName: s.tripName,
  }));

  return (
    <>
      {/* FAB button */}
      <Pressable
        style={({ pressed }) => [styles.fab, !isOnline && { opacity: 0.5 }, pressed && styles.fabPressed]}
        onPress={handleFABPress}
        disabled={parsing}
      >
        <Feather name="plus" size={24} color={colors.white} />
      </Pressable>

      {/* Source picker sheet */}
      <SourcePickerSheet
        visible={sheetVisible}
        onUploadFile={handleUploadFile}
        onChoosePhoto={handleChoosePhoto}
        onTakePhoto={handleTakePhoto}
        onClose={() => setSheetVisible(false)}
      />

      {/* Parsing overlay */}
      {parsing && <ParsingOverlay />}

      {/* Booking preview sheet */}
      <BookingPreviewSheet
        visible={previewVisible}
        booking={parsedBooking}
        stops={stopOptions}
        legGaps={allLegGaps}
        saving={saving}
        onSave={handleManualSave}
        onDiscard={() => { setPreviewVisible(false); setParsedBooking(null); setSourceFileUri(null); setSourceMediaType(null); }}
      />

      {/* Toast */}
      {toastMessage && (
        <Toast
          message={toastMessage}
          position="bottom"
          duration={4000}
          action={lastSaved ? { label: 'Undo', onPress: handleUndo } : undefined}
          onDismiss={() => { setToastMessage(null); setLastSaved(null); }}
        />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabPressed: { opacity: 0.85 },
});
