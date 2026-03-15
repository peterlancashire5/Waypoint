import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import type { ParsedBooking, TransportBooking, ConnectionBooking } from '@/lib/claude';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StopOption {
  id: string;
  city: string;
  tripName: string;
}

/** Represents the gap between two consecutive stops — used for transport booking assignment. */
export interface LegGapOption {
  /** The destination stop's id — passed as `stopId` to onSave so existing save logic is unchanged. */
  id: string;
  /** The origin stop's id — needed to create a leg on demand when none exists yet. */
  fromStopId: string;
  fromCity: string;
  toCity: string;
  tripName: string;
  tripId: string;
}

interface Props {
  visible: boolean;
  booking: ParsedBooking | null;
  stops: StopOption[];
  /** Leg gaps to show for transport/connection bookings instead of the stop picker. */
  legGaps?: LegGapOption[];
  saving: boolean;
  onSave: (booking: ParsedBooking, stopId: string | null) => void;
  onDiscard: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bestMatchStop(booking: ParsedBooking, stops: StopOption[]): StopOption | null {
  let targetCity: string | null = null;
  if (booking.type === 'transport') {
    targetCity = booking.destination_city;
  } else if (booking.type === 'accommodation') {
    targetCity = booking.city;
  } else if (booking.type === 'connection') {
    targetCity = booking.legs[booking.legs.length - 1]?.destination_city ?? null;
  } else {
    targetCity = (booking as any).city ?? null;
  }
  if (!targetCity) return null;
  const needle = targetCity.toLowerCase().trim();
  return stops.find((s) => s.city.toLowerCase().trim() === needle) ?? null;
}

function bestMatchGap(booking: ParsedBooking, gaps: LegGapOption[]): LegGapOption | null {
  let destCity: string | null = null;
  if (booking.type === 'transport') destCity = booking.destination_city;
  else if (booking.type === 'connection') destCity = booking.legs[booking.legs.length - 1]?.destination_city ?? null;
  if (!destCity) return null;
  const needle = destCity.toLowerCase().trim();
  return gaps.find((g) => g.toCity.toLowerCase().trim() === needle) ?? null;
}

function transportLabel(b: TransportBooking): string {
  switch (b.transport_type) {
    case 'train':  return 'Train';
    case 'bus':    return 'Bus';
    case 'ferry':  return 'Ferry';
    default:       return 'Flight';
  }
}

function bookingLabel(booking: ParsedBooking): string {
  if (booking.type === 'transport')     return transportLabel(booking);
  if (booking.type === 'accommodation') return 'Accommodation';
  if (booking.type === 'connection')    return 'Connection';
  return 'Document';
}

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export function transportIcon(transport_type: string): FeatherName {
  switch (transport_type) {
    case 'train':  return 'bar-chart-2';
    case 'bus':    return 'truck';
    case 'ferry':  return 'anchor';
    default:       return 'send';
  }
}

function bookingIcon(booking: ParsedBooking): FeatherName {
  if (booking.type === 'transport')     return transportIcon(booking.transport_type);
  if (booking.type === 'accommodation') return 'home';
  if (booking.type === 'connection')    return transportIcon(booking.legs[0]?.transport_type ?? 'flight');
  return 'file-text';
}

// ─── Detail rows ──────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function TransportDetails({ b }: { b: TransportBooking }) {
  const serviceLabel =
    b.transport_type === 'flight' ? 'Flight' :
    b.transport_type === 'train'  ? 'Train no.' : 'Service';

  return (
    <>
      <View style={styles.routeRow}>
        <Text style={styles.routeCity}>{b.origin_city || '—'}</Text>
        <Feather name="arrow-right" size={14} color={colors.textMuted} style={styles.routeArrow} />
        <Text style={styles.routeCity}>{b.destination_city || '—'}</Text>
      </View>
      <DetailRow label="Operator"    value={b.operator} />
      <DetailRow label={serviceLabel} value={b.service_number} />
      <DetailRow label="Departure"   value={b.departure_date ? `${b.departure_date}  ${b.departure_time}` : null} />
      <DetailRow label="Arrival"     value={b.arrival_date ? `${b.arrival_date}  ${b.arrival_time}` : null} />
      <DetailRow label="Booking ref" value={b.booking_ref} />
      <DetailRow label="Seat"        value={b.seat} />
      {/* Flight */}
      <DetailRow label="Gate"        value={b.gate} />
      <DetailRow label="Terminal"    value={b.terminal} />
      {/* Train */}
      <DetailRow label="Coach"         value={b.coach} />
      <DetailRow label="Platform"      value={b.platform} />
      <DetailRow label="From station"  value={b.origin_station} />
      <DetailRow label="To station"    value={b.destination_station} />
      {/* Bus */}
      <DetailRow label="Pickup"      value={b.pickup_point} />
      <DetailRow label="Dropoff"     value={b.dropoff_point} />
      {/* Ferry */}
      <DetailRow label="Deck"          value={b.deck} />
      <DetailRow label="Cabin"         value={b.cabin} />
      <DetailRow label="Port/terminal" value={b.port_terminal} />
    </>
  );
}

function AccommodationDetails({ b }: { b: Extract<ParsedBooking, { type: 'accommodation' }> }) {
  return (
    <>
      <DetailRow label="Property"       value={b.hotel_name} />
      <DetailRow label="City"           value={b.city} />
      <DetailRow label="Check-in"       value={b.check_in_date} />
      <DetailRow label="Check-in time"  value={b.check_in_time} />
      <DetailRow label="Check-out"      value={b.check_out_date} />
      <DetailRow label="Check-out time" value={b.check_out_time} />
      {b.nights !== null && <DetailRow label="Nights" value={String(b.nights)} />}
      <DetailRow label="Booking ref"    value={b.booking_ref} />
      <DetailRow label="Wi-Fi name"     value={b.wifi_name} />
      <DetailRow label="Wi-Fi password" value={b.wifi_password} />
    </>
  );
}

function ConnectionDetails({ b }: { b: ConnectionBooking }) {
  const first = b.legs[0];
  const last  = b.legs[b.legs.length - 1];
  return (
    <>
      <View style={styles.routeRow}>
        <Text style={styles.routeCity}>{first?.origin_city || '—'}</Text>
        <Feather name="arrow-right" size={14} color={colors.textMuted} style={styles.routeArrow} />
        <Text style={styles.routeCity}>{last?.destination_city || '—'}</Text>
      </View>
      <DetailRow label="Booking ref" value={b.booking_ref} />
      {b.legs.map((leg, i) => (
        <View key={i} style={styles.connectionLeg}>
          <Text style={styles.connectionLegLabel}>Leg {leg.leg_order}</Text>
          <TransportDetails b={{ ...leg, type: 'transport', booking_ref: b.booking_ref ?? '' }} />
        </View>
      ))}
    </>
  );
}

function OtherDetails({ b }: { b: Extract<ParsedBooking, { type: 'other' }> }) {
  return (
    <>
      <DetailRow label="Description" value={b.description} />
      <DetailRow label="City"        value={b.city} />
      <DetailRow label="Date"        value={b.date} />
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingPreviewSheet({
  visible, booking, stops, legGaps, saving, onSave, onDiscard,
}: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [stopPickerOpen, setStopPickerOpen] = useState(false);
  const [selectedGapId, setSelectedGapId] = useState<string | null>(null);
  const [gapPickerOpen, setGapPickerOpen] = useState(false);

  const isTransport = booking?.type === 'transport' || booking?.type === 'connection';
  const showLegPicker = isTransport && legGaps && legGaps.length > 0;

  // Stop picker (accommodation / other)
  const autoMatchStop = (!showLegPicker && booking) ? bestMatchStop(booking, stops) : null;
  const effectiveStopId = selectedStopId ?? autoMatchStop?.id ?? null;
  const selectedStop = stops.find((s) => s.id === effectiveStopId) ?? autoMatchStop ?? null;

  // Gap picker (transport / connection)
  const autoMatchGap = (showLegPicker && booking) ? bestMatchGap(booking, legGaps!) : null;
  const effectiveGapId = selectedGapId ?? autoMatchGap?.id ?? null;
  const selectedGap = legGaps?.find((g) => g.id === effectiveGapId) ?? autoMatchGap ?? null;

  // What gets passed to onSave as stopId
  const saveTargetId = showLegPicker ? effectiveGapId : effectiveStopId;

  React.useEffect(() => {
    setSelectedStopId(null);
    setStopPickerOpen(false);
    setSelectedGapId(null);
    setGapPickerOpen(false);
  }, [booking]);

  React.useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 60,
      friction: 12,
    }).start();
  }, [visible]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  if (!booking) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onDiscard}>
      <TouchableWithoutFeedback onPress={saving ? undefined : onDiscard}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY }], paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={styles.handle} />

        <View style={styles.sheetHeader}>
          <View style={styles.typeIconWrap}>
            <Feather name={bookingIcon(booking)} size={18} color={colors.primary} />
          </View>
          <Text style={styles.sheetTitle}>{bookingLabel(booking)} detected</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollArea}>
          <View style={styles.card}>
            {booking.type === 'transport'     && <TransportDetails b={booking} />}
            {booking.type === 'accommodation' && <AccommodationDetails b={booking} />}
            {booking.type === 'connection'    && <ConnectionDetails b={booking} />}
            {booking.type === 'other'         && <OtherDetails b={booking} />}
          </View>

          {showLegPicker ? (
            <>
              <Text style={styles.sectionLabel}>Add to leg</Text>
              <TouchableOpacity
                style={styles.stopSelector}
                activeOpacity={0.7}
                onPress={() => setGapPickerOpen((o) => !o)}
                disabled={saving}
              >
                <View style={styles.stopSelectorLeft}>
                  <Feather name="send" size={15} color={colors.primary} />
                  <Text style={styles.stopSelectorText}>
                    {selectedGap
                      ? `${selectedGap.fromCity} → ${selectedGap.toCity} · ${selectedGap.tripName}`
                      : 'No leg selected'}
                  </Text>
                </View>
                <Feather
                  name={gapPickerOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              {gapPickerOpen && (
                <View style={styles.stopList}>
                  <TouchableOpacity
                    style={styles.stopRow}
                    activeOpacity={0.7}
                    onPress={() => { setSelectedGapId(null); setGapPickerOpen(false); }}
                  >
                    <Text style={[styles.stopRowText, !effectiveGapId && styles.stopRowTextActive]}>
                      None
                    </Text>
                  </TouchableOpacity>
                  {legGaps!.map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      style={styles.stopRow}
                      activeOpacity={0.7}
                      onPress={() => { setSelectedGapId(g.id); setGapPickerOpen(false); }}
                    >
                      <Text style={[styles.stopRowText, g.id === effectiveGapId && styles.stopRowTextActive]}>
                        {g.fromCity} → {g.toCity}
                      </Text>
                      <Text style={styles.stopRowMeta}>{g.tripName}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Save to stop</Text>
              <TouchableOpacity
                style={styles.stopSelector}
                activeOpacity={0.7}
                onPress={() => setStopPickerOpen((o) => !o)}
                disabled={saving}
              >
                <View style={styles.stopSelectorLeft}>
                  <Feather name="map-pin" size={15} color={colors.primary} />
                  <Text style={styles.stopSelectorText}>
                    {selectedStop
                      ? `${selectedStop.city} · ${selectedStop.tripName}`
                      : 'No stop selected'}
                  </Text>
                </View>
                <Feather
                  name={stopPickerOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              {stopPickerOpen && (
                <View style={styles.stopList}>
                  <TouchableOpacity
                    style={styles.stopRow}
                    activeOpacity={0.7}
                    onPress={() => { setSelectedStopId(null); setStopPickerOpen(false); }}
                  >
                    <Text style={[styles.stopRowText, !effectiveStopId && styles.stopRowTextActive]}>
                      None
                    </Text>
                  </TouchableOpacity>
                  {stops.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.stopRow}
                      activeOpacity={0.7}
                      onPress={() => { setSelectedStopId(s.id); setStopPickerOpen(false); }}
                    >
                      <Text style={[styles.stopRowText, s.id === effectiveStopId && styles.stopRowTextActive]}>
                        {s.city}
                      </Text>
                      <Text style={styles.stopRowMeta}>{s.tripName}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.discardButton, pressed && styles.pressed]}
            onPress={onDiscard}
            disabled={saving}
          >
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.saveButton,
              pressed && styles.pressed,
              saving && styles.saveButtonDisabled,
            ]}
            onPress={() => onSave(booking, saveTargetId)}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.saveText}>Save booking</Text>
            )}
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20, maxHeight: '85%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  typeIconWrap: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#EBF3F6', alignItems: 'center', justifyContent: 'center',
  },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text, letterSpacing: -0.2 },
  scrollArea: { flexGrow: 0 },
  card: { backgroundColor: colors.background, borderRadius: 14, padding: 14, gap: 8, marginBottom: 20 },
  routeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  routeCity: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.text, letterSpacing: -0.2 },
  routeArrow: { marginHorizontal: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  detailLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.textMuted, letterSpacing: 0.2, minWidth: 80 },
  detailValue: { fontFamily: fonts.body, fontSize: 14, color: colors.text, flex: 1, textAlign: 'right' },
  sectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 8,
  },
  stopSelector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.background, borderRadius: 12, padding: 14,
    marginBottom: 4, borderWidth: 1, borderColor: colors.border,
  },
  stopSelectorLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  stopSelectorText: { fontFamily: fonts.body, fontSize: 14, color: colors.text, flex: 1 },
  stopList: {
    backgroundColor: colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8, overflow: 'hidden',
  },
  stopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  stopRowText: { fontFamily: fonts.body, fontSize: 14, color: colors.text },
  stopRowTextActive: { fontFamily: fonts.bodyBold, color: colors.primary },
  stopRowMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: 12, paddingTop: 16 },
  pressed: { opacity: 0.75 },
  discardButton: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  discardText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.textMuted },
  saveButton: {
    flex: 2, paddingVertical: 14, borderRadius: 14,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  saveButtonDisabled: { opacity: 0.7 },
  saveText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },
  connectionLeg: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 4, gap: 8 },
  connectionLegLabel: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
});
