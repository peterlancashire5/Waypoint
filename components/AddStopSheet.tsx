import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import CityAutocomplete from '@/components/CityAutocomplete';
import type { CityResult } from '@/components/CityAutocomplete';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PendingStop {
  city: string;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  start_date: string | null; // ISO YYYY-MM-DD
  end_date: string | null;   // ISO YYYY-MM-DD
}

interface Props {
  visible: boolean;
  onAdd: (stop: PendingStop) => void;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDateInput(str: string): string | null {
  // Accept DD/MM/YYYY, DD-MM-YYYY, DD MM YYYY etc.
  const parts = str.replace(/[^0-9]/g, ' ').trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || m < 1 || m > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  const date = new Date(y, m - 1, d);
  if (date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddStopSheet({ visible, onAdd, onClose }: Props) {
  const [cityText, setCityText] = useState('');
  const [cityResult, setCityResult] = useState<CityResult | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  function reset() {
    setCityText('');
    setCityResult(null);
    setStartDate('');
    setEndDate('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleAdd() {
    if (!cityText.trim()) {
      Alert.alert('City required', 'Please enter a city name.');
      return;
    }

    const parsedStart = startDate.trim() ? parseDateInput(startDate) : null;
    const parsedEnd = endDate.trim() ? parseDateInput(endDate) : null;

    if (startDate.trim() && !parsedStart) {
      Alert.alert('Invalid date', 'Arrival date must be DD/MM/YYYY.');
      return;
    }
    if (endDate.trim() && !parsedEnd) {
      Alert.alert('Invalid date', 'Departure date must be DD/MM/YYYY.');
      return;
    }

    onAdd({
      city: cityResult?.city ?? cityText.trim(),
      country: cityResult?.country ?? null,
      latitude: cityResult?.lat ?? null,
      longitude: cityResult?.lng ?? null,
      start_date: parsedStart,
      end_date: parsedEnd,
    });

    reset();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          {/* Header */}
          <View style={styles.header}>
            <Pressable onPress={handleClose} hitSlop={8}>
              <Text style={styles.cancelBtn}>Cancel</Text>
            </Pressable>
            <Text style={styles.title}>Add Stop</Text>
            <Pressable onPress={handleAdd} hitSlop={8}>
              <Text style={styles.addBtn}>Add</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.label}>City</Text>
            <View style={styles.inputWrap}>
              <CityAutocomplete
                value={cityText}
                onChangeText={(t) => {
                  setCityText(t);
                  setCityResult(null);
                }}
                onSelect={(result) => {
                  setCityText(result.city);
                  setCityResult(result);
                }}
                placeholder="e.g. Tokyo"
                autoFocus
                style={styles.input}
                containerStyle={styles.autocompleteContainer}
              />
            </View>

            <Text style={styles.label}>Arrival date</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="DD/MM/YYYY  (optional)"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                returnKeyType="next"
              />
            </View>

            <Text style={styles.label}>Departure date</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={endDate}
                onChangeText={setEndDate}
                placeholder="DD/MM/YYYY  (optional)"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
                onSubmitEditing={handleAdd}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.white },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.text,
  },
  cancelBtn: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textMuted,
  },
  addBtn: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.primary,
  },

  body: { flex: 1 },
  bodyContent: { padding: 20, gap: 6 },

  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
  },

  inputWrap: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'visible',
  },

  autocompleteContainer: {
    overflow: 'visible',
  },

  input: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
});
