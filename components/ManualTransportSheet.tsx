import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import type { ParsedBooking, TransportBooking, TransportType } from '@/lib/claude';
import { transportIcon } from './BookingPreviewSheet';
import type { StopOption } from './BookingPreviewSheet';

// ─── Transport type selector ──────────────────────────────────────────────────

const TRANSPORT_TYPES: { key: TransportType; label: string }[] = [
  { key: 'flight', label: 'Flight' },
  { key: 'train',  label: 'Train'  },
  { key: 'bus',    label: 'Bus'    },
  { key: 'ferry',  label: 'Ferry'  },
];

// ─── Field config per transport type ─────────────────────────────────────────

interface FieldDef {
  key: keyof TransportBooking;
  label: string;
  placeholder: string;
  types: TransportType[];        // which modes show this field
  keyboard?: 'default' | 'numbers-and-punctuation';
}

const FIELDS: FieldDef[] = [
  { key: 'origin_city',         label: 'From',          placeholder: 'City',               types: ['flight','train','bus','ferry'] },
  { key: 'destination_city',    label: 'To',            placeholder: 'City',               types: ['flight','train','bus','ferry'] },
  { key: 'departure_date',      label: 'Departure date',placeholder: 'YYYY-MM-DD',         types: ['flight','train','bus','ferry'], keyboard: 'numbers-and-punctuation' },
  { key: 'departure_time',      label: 'Departure time',placeholder: 'HH:MM',              types: ['flight','train','bus','ferry'], keyboard: 'numbers-and-punctuation' },
  { key: 'arrival_date',        label: 'Arrival date',  placeholder: 'YYYY-MM-DD',         types: ['flight','train','bus','ferry'], keyboard: 'numbers-and-punctuation' },
  { key: 'arrival_time',        label: 'Arrival time',  placeholder: 'HH:MM',              types: ['flight','train','bus','ferry'], keyboard: 'numbers-and-punctuation' },
  { key: 'operator',            label: 'Airline',       placeholder: 'e.g. Thai Airways',  types: ['flight'] },
  { key: 'operator',            label: 'Operator',      placeholder: 'e.g. Eurostar',      types: ['train','bus','ferry'] },
  { key: 'service_number',      label: 'Flight no.',    placeholder: 'e.g. TG661',         types: ['flight'] },
  { key: 'service_number',      label: 'Train no.',     placeholder: 'e.g. 9001',          types: ['train'] },
  { key: 'service_number',      label: 'Service no.',   placeholder: 'Route or service',   types: ['bus','ferry'] },
  { key: 'booking_ref',         label: 'Booking ref',   placeholder: 'Confirmation code',  types: ['flight','train','bus','ferry'] },
  { key: 'seat',                label: 'Seat',          placeholder: 'e.g. 14A',           types: ['flight','train','bus','ferry'] },
  { key: 'gate',                label: 'Gate',          placeholder: 'e.g. B22',           types: ['flight'] },
  { key: 'terminal',            label: 'Terminal',      placeholder: 'e.g. T3',            types: ['flight'] },
  { key: 'coach',               label: 'Coach',         placeholder: 'e.g. Coach C',       types: ['train'] },
  { key: 'platform',            label: 'Platform',      placeholder: 'e.g. Platform 7',    types: ['train'] },
  { key: 'origin_station',      label: 'From station',  placeholder: 'Station name',       types: ['train'] },
  { key: 'destination_station', label: 'To station',    placeholder: 'Station name',       types: ['train'] },
  { key: 'pickup_point',        label: 'Pickup point',  placeholder: 'e.g. Central bus stn', types: ['bus'] },
  { key: 'deck',                label: 'Deck',          placeholder: 'e.g. Deck 7',        types: ['ferry'] },
  { key: 'cabin',               label: 'Cabin',         placeholder: 'e.g. 304',           types: ['ferry'] },
  { key: 'port_terminal',       label: 'Port/terminal', placeholder: 'Terminal name',       types: ['ferry'] },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyTransport(transport_type: TransportType): TransportBooking {
  return {
    type: 'transport',
    transport_type,
    operator: '',
    service_number: '',
    origin_city: '',
    destination_city: '',
    departure_date: '',
    departure_time: '',
    arrival_date: '',
    arrival_time: '',
    booking_ref: '',
    seat: null,
    gate: null, terminal: null,
    coach: null, platform: null, origin_station: null, destination_station: null,
    pickup_point: null,
    deck: null, cabin: null, port_terminal: null,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  stops: StopOption[];
  saving: boolean;
  onSave: (booking: ParsedBooking, stopId: string | null) => void;
  onDiscard: () => void;
}

export default function ManualTransportSheet({
  visible, stops, saving, onSave, onDiscard,
}: Props) {
  const insets = useSafeAreaInsets();
  const [transportType, setTransportType] = useState<TransportType>('flight');
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [stopPickerOpen, setStopPickerOpen] = useState(false);

  function reset() {
    setTransportType('flight');
    setValues({});
    setSelectedStopId(null);
    setStopPickerOpen(false);
  }

  function handleDiscard() {
    reset();
    onDiscard();
  }

  function handleSave() {
    const booking = emptyTransport(transportType);
    // Apply all values, converting empty strings to null for nullable fields
    const fieldsForType = FIELDS.filter((f) => f.types.includes(transportType));
    const seenKeys = new Set<string>();
    for (const field of fieldsForType) {
      const k = field.key as string;
      if (seenKeys.has(k)) continue; // operator/service_number appear twice; take first
      seenKeys.add(k);
      const v = (values[k] ?? '').trim();
      (booking as any)[k] = v || null;
    }
    // seat is special: typed as string | null but in values as string
    booking.seat = (values.seat ?? '').trim() || null;

    onSave(booking, selectedStopId);
    reset();
  }

  // Deduplicate fields: operator and service_number appear once per type in the list
  // but FIELDS has them multiple times for different labels. We filter to the active type,
  // then deduplicate by key — the first match for that type wins (correct label).
  const activeFields = (() => {
    const seen = new Set<string>();
    return FIELDS.filter((f) => {
      if (!f.types.includes(transportType)) return false;
      if (seen.has(f.key as string)) return false;
      seen.add(f.key as string);
      return true;
    });
  })();

  const selectedStop = stops.find((s) => s.id === selectedStopId) ?? null;

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={handleDiscard}>
      <TouchableWithoutFeedback onPress={saving ? undefined : handleDiscard}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavWrapper}
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          <Text style={styles.sheetTitle}>Add transport manually</Text>

          {/* Transport type selector */}
          <View style={styles.typeRow}>
            {TRANSPORT_TYPES.map(({ key, label }) => {
              const active = transportType === key;
              return (
                <Pressable
                  key={key}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                  onPress={() => { setTransportType(key); setValues({}); }}
                >
                  <Feather
                    name={transportIcon(key)}
                    size={13}
                    color={active ? colors.white : colors.textMuted}
                  />
                  <Text style={[styles.typeChipLabel, active && styles.typeChipLabelActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.scrollArea}
          >
            {/* Fields */}
            <View style={styles.card}>
              {activeFields.map((field, i) => (
                <View key={field.key as string + i}>
                  {i > 0 && <View style={styles.divider} />}
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={values[field.key as string] ?? ''}
                      onChangeText={(v) =>
                        setValues((prev) => ({ ...prev, [field.key as string]: v }))
                      }
                      placeholder={field.placeholder}
                      placeholderTextColor={colors.border}
                      keyboardType={field.keyboard === 'numbers-and-punctuation' ? 'numbers-and-punctuation' : 'default'}
                      returnKeyType="next"
                    />
                  </View>
                </View>
              ))}
            </View>

            {/* Stop selector */}
            <Text style={styles.sectionLabel}>Save to stop</Text>
            <Pressable
              style={styles.stopSelector}
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
            </Pressable>

            {stopPickerOpen && (
              <View style={styles.stopList}>
                <Pressable
                  style={styles.stopRow}
                  onPress={() => { setSelectedStopId(null); setStopPickerOpen(false); }}
                >
                  <Text style={[styles.stopRowText, !selectedStopId && styles.stopRowTextActive]}>
                    None
                  </Text>
                </Pressable>
                {stops.map((s) => (
                  <Pressable
                    key={s.id}
                    style={styles.stopRow}
                    onPress={() => { setSelectedStopId(s.id); setStopPickerOpen(false); }}
                  >
                    <Text style={[styles.stopRowText, s.id === selectedStopId && styles.stopRowTextActive]}>
                      {s.city}
                    </Text>
                    <Text style={styles.stopRowMeta}>{s.tripName}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.discardButton, pressed && { opacity: 0.7 }]}
              onPress={handleDiscard}
              disabled={saving}
            >
              <Text style={styles.discardText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                pressed && { opacity: 0.85 },
                saving && styles.saveButtonDisabled,
              ]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.saveText}>Save booking</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  kavWrapper: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20, maxHeight: '92%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14,
  },
  sheetTitle: {
    fontFamily: fonts.displayBold, fontSize: 20,
    color: colors.text, letterSpacing: -0.2, marginBottom: 16,
  },

  // Type chips
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  typeChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 8, borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1, borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.textMuted },
  typeChipLabelActive: { color: colors.white },

  scrollArea: { flexGrow: 0 },

  // Field card
  card: {
    backgroundColor: colors.white, borderRadius: 14, marginBottom: 20,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 16 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13, gap: 12,
  },
  fieldLabel: {
    fontFamily: fonts.body, fontSize: 14, color: colors.textMuted,
    width: 120, flexShrink: 0,
  },
  fieldInput: {
    flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.text,
    textAlign: 'right', padding: 0,
  },

  // Stop selector
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

  // Actions
  actions: { flexDirection: 'row', gap: 12, paddingTop: 14 },
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
});
