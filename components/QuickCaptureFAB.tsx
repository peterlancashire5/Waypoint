import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import {
  parseBookingFile,
  mediaTypeFromUri,
  readUriAsBase64,
  type ParsedBooking,
} from '@/lib/claude';
import BookingPreviewSheet, { type StopOption } from '@/components/BookingPreviewSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StopWithDates extends StopOption {
  start_date: string | null;
  end_date: string | null;
}

interface SavedRecord {
  table: 'accommodation' | 'leg_bookings' | 'saved_items';
  id: string;
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

  if (booking.type === 'transport') {
    const destMatches = stops.filter((s) => cityMatches(s.city, booking.destination_city));
    const originMatches = stops.filter((s) => cityMatches(s.city, booking.origin_city));

    // Destination match with date → confident
    for (const s of destMatches) {
      if (datesWithin2Days(s.start_date, booking.arrival_date)) {
        return { stop: s, confident: true };
      }
    }
    // Destination match only → partial
    if (destMatches.length > 0) return { stop: destMatches[0], confident: false };
    // Origin match → partial
    if (originMatches.length > 0) return { stop: originMatches[0], confident: false };

    return { stop: null, confident: false };

  } else if (booking.type === 'accommodation') {
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

// ─── Save booking ─────────────────────────────────────────────────────────────

async function saveBooking(
  booking: ParsedBooking,
  stopId: string | null,
  userId: string,
): Promise<SavedRecord | null> {
  if (booking.type === 'accommodation' && stopId) {
    const { data, error } = await supabase
      .from('accommodation')
      .insert({
        stop_id: stopId,
        owner_id: userId,
        name: booking.hotel_name,
        confirmation_ref: booking.booking_ref || null,
        check_in: booking.check_in_date || null,
        check_out: booking.check_out_date || null,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Save failed');
    return { table: 'accommodation', id: (data as any).id };

  } else if (booking.type === 'transport' && stopId) {
    // Try to match a leg by destination city
    const { data: legs } = await supabase
      .from('legs')
      .select('id, to_stop:to_stop_id(city)')
      .limit(200);

    const matchedLeg = (legs ?? []).find(
      (l: any) => l.to_stop?.city?.toLowerCase() === booking.destination_city?.toLowerCase()
    );

    if (matchedLeg) {
      const { data, error } = await supabase
        .from('leg_bookings')
        .insert({
          leg_id: matchedLeg.id,
          owner_id: userId,
          operator: booking.operator,
          reference: booking.service_number,
          seat: booking.seat,
          confirmation_ref: booking.booking_ref,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Save failed');
      return { table: 'leg_bookings', id: (data as any).id };
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
        }),
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
  await supabase.from(record.table).delete().eq('id', record.id);
}

// ─── Source picker sheet ──────────────────────────────────────────────────────

function SourcePickerSheet({
  visible,
  onUploadFile,
  onTakePhoto,
  onClose,
}: {
  visible: boolean;
  onUploadFile: () => void;
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

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();

    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
        () => onDismiss()
      );
    }, 4000);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  function handleUndo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
      () => onDismiss()
    );
    onUndo();
  }

  return (
    <Animated.View style={[toastStyles.toast, { opacity }]}>
      <Text style={toastStyles.message} numberOfLines={1}>{message}</Text>
      <Pressable onPress={handleUndo} hitSlop={8}>
        <Text style={toastStyles.undo}>Undo</Text>
      </Pressable>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  toast: {
    position: 'absolute', bottom: 104, left: 16, right: 16,
    backgroundColor: colors.text,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  },
  message: { fontFamily: fonts.body, fontSize: 14, color: colors.white, flex: 1 },
  undo: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent, marginLeft: 12 },
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
  const [sheetVisible, setSheetVisible] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedBooking, setParsedBooking] = useState<ParsedBooking | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allStops, setAllStops] = useState<StopWithDates[]>([]);
  const [stopsLoaded, setStopsLoaded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<SavedRecord | null>(null);

  // ── Load all stops (once) ────────────────────────────────────────────────

  async function loadStops() {
    if (stopsLoaded) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const { data } = await supabase
      .from('stops')
      .select('id, city, start_date, end_date, trips(id, name, owner_id)')
      .limit(200);

    if (data) {
      const stops: StopWithDates[] = (data as any[])
        .filter((s) => s.trips?.owner_id === session.user.id)
        .map((s) => ({
          id: s.id,
          city: s.city,
          tripName: s.trips?.name ?? 'Trip',
          start_date: s.start_date,
          end_date: s.end_date,
        }));
      setAllStops(stops);
    }
    setStopsLoaded(true);
  }

  function handleFABPress() {
    loadStops();
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
      const mediaType = mediaTypeFromUri(asset.uri, asset.mimeType);
      const base64 = await readUriAsBase64(asset.uri);
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
      const mediaType = mediaTypeFromUri(asset.uri, asset.mimeType ?? undefined);
      const base64 = await readUriAsBase64(asset.uri);
      const booking = await parseBookingFile(base64, mediaType);
      await handleParsed(booking);
    } catch (err: any) {
      Alert.alert('Could not read photo', err?.message ?? 'Please try again.');
    } finally {
      setParsing(false);
    }
  }

  // ── Matching + auto-save ─────────────────────────────────────────────────

  async function handleParsed(booking: ParsedBooking) {
    const { stop, confident } = findBestMatch(allStops, booking);

    if (confident && stop) {
      // Auto-save
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) throw new Error('Not authenticated.');
        const record = await saveBooking(booking, stop.id, session.user.id);
        if (record) setLastSaved(record);
        setToastMessage(`Saved to ${stop.city}`);
      } catch (err: any) {
        // Fall back to preview sheet on save failure
        setParsedBooking(booking);
        setPreviewVisible(true);
      }
    } else {
      // Show preview with best guess pre-selected
      setParsedBooking(booking);
      setPreviewVisible(true);
    }
  }

  // ── Manual save (from BookingPreviewSheet) ───────────────────────────────

  async function handleManualSave(booking: ParsedBooking, stopId: string | null) {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not authenticated.');
      await saveBooking(booking, stopId, session.user.id);
      setPreviewVisible(false);
      setParsedBooking(null);
      const savedStop = allStops.find((s) => s.id === stopId);
      if (savedStop) setToastMessage(`Saved to ${savedStop.city}`);
    } catch (err: any) {
      Alert.alert('Could not save booking', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
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
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={handleFABPress}
        disabled={parsing}
      >
        <Feather name="plus" size={24} color={colors.white} />
      </Pressable>

      {/* Source picker sheet */}
      <SourcePickerSheet
        visible={sheetVisible}
        onUploadFile={handleUploadFile}
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
        saving={saving}
        onSave={handleManualSave}
        onDiscard={() => { setPreviewVisible(false); setParsedBooking(null); }}
      />

      {/* Toast */}
      {toastMessage && (
        <Toast
          message={toastMessage}
          onUndo={handleUndo}
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
