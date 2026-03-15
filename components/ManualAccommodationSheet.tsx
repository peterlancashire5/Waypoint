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
import type { StopOption } from './BookingPreviewSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ManualAccommodationData {
  name: string;
  address: string | null;
  check_in_date: string | null;   // YYYY-MM-DD
  check_out_date: string | null;  // YYYY-MM-DD
  check_in_time: string | null;   // HH:MM  → saved to check_in (time column)
  check_out_time: string | null;  // HH:MM  → saved to check_out (time column)
  confirmation_ref: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  door_code: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalises free-text date input to YYYY-MM-DD.
 * Accepts: YYYY-MM-DD (unchanged), DD/MM/YYYY, MM/DD/YYYY.
 * When DD vs MM is ambiguous (both ≤ 12), treats as DD/MM/YYYY.
 */
function normalizeDate(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const aNum = parseInt(m[1], 10);
    const bNum = parseInt(m[2], 10);
    const year = m[3];
    let day: number, month: number;
    if (aNum > 12) { day = aNum; month = bNum; }
    else if (bNum > 12) { month = aNum; day = bNum; }
    else { day = aNum; month = bNum; }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return trimmed;
}

// ─── Field sections ───────────────────────────────────────────────────────────

interface FieldDef {
  key: keyof ManualAccommodationData;
  label: string;
  placeholder: string;
  keyboard?: 'default' | 'numbers-and-punctuation';
  secure?: boolean;
}

const PROPERTY_FIELDS: FieldDef[] = [
  { key: 'name',    label: 'Property name', placeholder: 'Hotel or rental name' },
  { key: 'address', label: 'Address',       placeholder: 'Street address' },
];

const DATE_FIELDS: FieldDef[] = [
  { key: 'check_in_date',  label: 'Check-in date',  placeholder: 'DD/MM/YYYY or YYYY-MM-DD', keyboard: 'numbers-and-punctuation' },
  { key: 'check_in_time',  label: 'Check-in time',  placeholder: 'HH:MM',                    keyboard: 'numbers-and-punctuation' },
  { key: 'check_out_date', label: 'Check-out date', placeholder: 'DD/MM/YYYY or YYYY-MM-DD', keyboard: 'numbers-and-punctuation' },
  { key: 'check_out_time', label: 'Check-out time', placeholder: 'HH:MM',                    keyboard: 'numbers-and-punctuation' },
];

const BOOKING_FIELDS: FieldDef[] = [
  { key: 'confirmation_ref', label: 'Confirmation ref', placeholder: 'Booking reference' },
];

const ACCESS_FIELDS: FieldDef[] = [
  { key: 'wifi_name',     label: 'WiFi name',     placeholder: 'Network name'     },
  { key: 'wifi_password', label: 'WiFi password', placeholder: 'Password', secure: true },
  { key: 'door_code',     label: 'Door code',     placeholder: 'Entry code or PIN' },
];

// ─── Sub-component: a card of fields ─────────────────────────────────────────

function FieldCard({
  fields,
  values,
  onChange,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <View style={styles.card}>
      {fields.map((field, i) => (
        <View key={field.key as string}>
          {i > 0 && <View style={styles.divider} />}
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <TextInput
              style={styles.fieldInput}
              value={values[field.key as string] ?? ''}
              onChangeText={(v) => onChange(field.key as string, v)}
              placeholder={field.placeholder}
              placeholderTextColor={colors.border}
              keyboardType={
                field.keyboard === 'numbers-and-punctuation'
                  ? 'numbers-and-punctuation'
                  : 'default'
              }
              secureTextEntry={field.secure ?? false}
              returnKeyType="next"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  stops: StopOption[];
  saving: boolean;
  onSave: (data: ManualAccommodationData, stopId: string | null) => void;
  onDiscard: () => void;
}

export default function ManualAccommodationSheet({
  visible, stops, saving, onSave, onDiscard,
}: Props) {
  const insets = useSafeAreaInsets();
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [stopPickerOpen, setStopPickerOpen] = useState(false);

  function reset() {
    setValues({});
    setSelectedStopId(null);
    setStopPickerOpen(false);
  }

  function handleDiscard() {
    reset();
    onDiscard();
  }

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function str(key: keyof ManualAccommodationData): string | null {
    const v = (values[key as string] ?? '').trim();
    return v || null;
  }

  function handleSave() {
    const data: ManualAccommodationData = {
      name: str('name') ?? '',
      address: str('address'),
      check_in_date: normalizeDate(values.check_in_date ?? '') || null,
      check_out_date: normalizeDate(values.check_out_date ?? '') || null,
      check_in_time: str('check_in_time'),
      check_out_time: str('check_out_time'),
      confirmation_ref: str('confirmation_ref'),
      wifi_name: str('wifi_name'),
      wifi_password: str('wifi_password'),
      door_code: str('door_code'),
    };
    onSave(data, selectedStopId);
    reset();
  }

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
          <Text style={styles.sheetTitle}>Add accommodation</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.scrollArea}
          >
            {/* Property */}
            <Text style={styles.sectionLabel}>Property</Text>
            <FieldCard fields={PROPERTY_FIELDS} values={values} onChange={handleChange} />

            {/* Dates & times */}
            <Text style={styles.sectionLabel}>Dates &amp; times</Text>
            <FieldCard fields={DATE_FIELDS} values={values} onChange={handleChange} />

            {/* Booking reference */}
            <Text style={styles.sectionLabel}>Booking</Text>
            <FieldCard fields={BOOKING_FIELDS} values={values} onChange={handleChange} />

            {/* Access codes */}
            <Text style={styles.sectionLabel}>Access</Text>
            <FieldCard fields={ACCESS_FIELDS} values={values} onChange={handleChange} />

            {/* Stop selector */}
            <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Save to stop</Text>
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
                <Text style={styles.saveText}>Save accommodation</Text>
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

  scrollArea: { flexGrow: 0 },

  sectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 8,
  },

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
