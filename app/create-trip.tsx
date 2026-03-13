import React, { useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type TripType = 'single' | 'multi';

interface TripStop {
  id: string;
  city: string;
  nights: string;
  lat: number | null;
  lng: number | null;
  geocoding: boolean;
}

interface GeoResult {
  lat: number;
  lng: number;
  name: string;
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

async function geocodeCity(name: string, signal?: AbortSignal): Promise<GeoResult | null> {
  try {
    const encoded = encodeURIComponent(name.trim());
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encoded}&count=1&language=en&format=json`,
      { signal },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const r = json?.results?.[0];
    if (!r) return null;
    return { lat: r.latitude, lng: r.longitude, name: r.name };
  } catch {
    return null;
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseDate(str: string): Date | null {
  const parts = str.replace(/[^0-9]/g, ' ').trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || m < 1 || m > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  const date = new Date(y, m - 1, d);
  return date.getDate() === d ? date : null;
}

function addDays(date: Date, n: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtDay(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function fmtRange(start: Date, end: Date): string {
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${MONTHS[start.getMonth()]}`;
  }
  return `${fmtDay(start)} – ${fmtDay(end)}`;
}

function stopDateRange(tripStart: string, stops: TripStop[], idx: number): string {
  const base = parseDate(tripStart);
  const nights = parseInt(stops[idx].nights, 10);
  if (!base || isNaN(nights) || nights <= 0) return '— –– ——';
  let offset = 0;
  for (let i = 0; i < idx; i++) {
    const n = parseInt(stops[i].nights, 10);
    if (!isNaN(n) && n > 0) offset += n;
  }
  return fmtRange(addDays(base, offset), addDays(base, offset + nights));
}

function totalNights(stops: TripStop[]): number {
  return stops.reduce((sum, s) => {
    const n = parseInt(s.nights, 10);
    return sum + (isNaN(n) || n < 0 ? 0 : n);
  }, 0);
}

function tripEndDate(tripStart: string, stops: TripStop[]): string {
  const base = parseDate(tripStart);
  const total = totalNights(stops);
  if (!base || total === 0) return '——';
  return fmtDay(addDays(base, total));
}

function tripDateRange(tripStart: string, stops: TripStop[]): string {
  const base = parseDate(tripStart);
  const total = totalNights(stops);
  if (!base || total === 0) return '—';
  return `${fmtDay(base)} – ${fmtDay(addDays(base, total))}`;
}

// ─── Progress Dots ────────────────────────────────────────────────────────────

function ProgressDots({ step }: { step: number }) {
  return (
    <View style={styles.dotsContainer}>
      {[1, 2, 3, 4].map((n) => (
        <View
          key={n}
          style={[
            styles.dot,
            n < step && styles.dotComplete,
            n === step && styles.dotActive,
          ]}
        />
      ))}
    </View>
  );
}

// ─── Shared Footer ────────────────────────────────────────────────────────────

interface FooterProps {
  onNext: () => void;
  nextEnabled?: boolean;
  nextLabel?: string;
  nextIcon?: string;
  onBack?: () => void;
}

function Footer({ onNext, nextEnabled = true, nextLabel = 'Next', nextIcon = 'arrow-right', onBack }: FooterProps) {
  return (
    <View style={styles.footer}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.secondaryButton}>
          <Feather name="arrow-left" size={18} color={colors.text} />
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={[styles.primaryButton, styles.primaryButtonFlex, !nextEnabled && styles.primaryButtonDisabled]}
        onPress={onNext}
        disabled={!nextEnabled}
      >
        <Text style={[styles.primaryButtonText, !nextEnabled && styles.primaryButtonTextDisabled]}>
          {nextLabel}
        </Text>
        <Feather name={nextIcon as any} size={18} color={nextEnabled ? colors.white : colors.border} />
      </Pressable>
    </View>
  );
}

// ─── Step 1: Trip Name ────────────────────────────────────────────────────────

function Step1({ tripName, setTripName, onNext }: {
  tripName: string;
  setTripName: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.stepContainer}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepLabel}>Step 1 of 4</Text>
        <Text style={styles.stepTitle}>Name your{'\n'}trip</Text>

        <View>
          <Text style={styles.fieldLabel}>Trip name</Text>
          <TextInput
            style={styles.titleInput}
            value={tripName}
            onChangeText={setTripName}
            placeholder="e.g. Summer in Italy"
            placeholderTextColor={colors.border}
            autoFocus
            returnKeyType="done"
          />
          <View style={[styles.titleUnderline, tripName.length > 0 && styles.titleUnderlineActive]} />
        </View>
      </ScrollView>

      <Footer onNext={onNext} nextEnabled={tripName.trim().length > 0} />
    </View>
  );
}

// ─── Step 2: Trip Type ────────────────────────────────────────────────────────

function TypeCard({ icon, title, subtitle, selected, onPress }: {
  icon: string; title: string; subtitle: string; selected: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.typeCard,
        selected && styles.typeCardSelected,
        pressed && !selected && styles.typeCardPressed,
      ]}
      onPress={onPress}
    >
      <View style={[styles.typeCardIcon, selected && styles.typeCardIconSelected]}>
        <Feather name={icon as any} size={22} color={selected ? colors.white : colors.primary} />
      </View>
      <View style={styles.typeCardBody}>
        <Text style={[styles.typeCardTitle, selected && styles.typeCardTitleSelected]}>{title}</Text>
        <Text style={styles.typeCardSubtitle}>{subtitle}</Text>
      </View>
      <View style={[styles.typeCardCheck, selected && styles.typeCardCheckSelected]}>
        {selected && <Feather name="check" size={13} color={colors.white} />}
      </View>
    </Pressable>
  );
}

function Step2({ tripType, onSelect, onBack }: {
  tripType: TripType | null;
  onSelect: (t: TripType) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.stepContainer}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
        <Text style={styles.stepLabel}>Step 2 of 4</Text>
        <Text style={styles.stepTitle}>What kind{'\n'}of trip?</Text>

        <View style={styles.typeCards}>
          <TypeCard
            icon="map-pin"
            title="Single Destination"
            subtitle="One place, with travel in and out"
            selected={tripType === 'single'}
            onPress={() => onSelect('single')}
          />
          <TypeCard
            icon="git-branch"
            title="Multi-Stop"
            subtitle="A route across multiple cities"
            selected={tripType === 'multi'}
            onPress={() => onSelect('multi')}
          />
        </View>
      </ScrollView>

      <View style={styles.backOnlyFooter}>
        <Pressable onPress={onBack} style={styles.secondaryButton}>
          <Feather name="arrow-left" size={18} color={colors.text} />
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Step 3 (Single): Destination + Dates ─────────────────────────────────────

function Step3Single({
  destination, setDestination, arrivalDate, setArrivalDate,
  departureDate, setDepartureDate, departureDateUnknown, setDepartureDateUnknown,
  geocodingDestination, onDestinationBlur, onNext, onBack,
}: {
  destination: string;
  setDestination: (v: string) => void;
  arrivalDate: string;
  setArrivalDate: (v: string) => void;
  departureDate: string;
  setDepartureDate: (v: string) => void;
  departureDateUnknown: boolean;
  setDepartureDateUnknown: (v: boolean) => void;
  geocodingDestination: boolean;
  onDestinationBlur: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const canProceed = destination.trim().length > 0 && arrivalDate.trim().length > 0;

  return (
    <View style={styles.stepContainer}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepLabel}>Step 3 of 4</Text>
        <Text style={styles.stepTitle}>Where are{'\n'}you going?</Text>

        {/* City */}
        <View>
          <View style={styles.dateLabelRow}>
            <Text style={styles.fieldLabel}>Destination</Text>
            {geocodingDestination && (
              <ActivityIndicator size="small" color={colors.textMuted} />
            )}
          </View>
          <TextInput
            style={styles.titleInput}
            value={destination}
            onChangeText={setDestination}
            onBlur={onDestinationBlur}
            placeholder="e.g. Barcelona"
            placeholderTextColor={colors.border}
            autoFocus
            returnKeyType="done"
          />
          <View style={[styles.titleUnderline, destination.length > 0 && styles.titleUnderlineActive]} />
        </View>

        {/* Arrival date */}
        <View style={styles.dateBlock}>
          <Text style={styles.fieldLabel}>Arrival date</Text>
          <TextInput
            style={styles.dateInput}
            value={arrivalDate}
            onChangeText={setArrivalDate}
            placeholder="DD / MM / YYYY"
            placeholderTextColor={colors.border}
            keyboardType="numbers-and-punctuation"
          />
        </View>

        {/* Departure date */}
        <View style={styles.dateBlock}>
          <View style={styles.dateLabelRow}>
            <Text style={styles.fieldLabel}>Departure date</Text>
            <Pressable
              onPress={() => {
                setDepartureDateUnknown(!departureDateUnknown);
                if (!departureDateUnknown) setDepartureDate('');
              }}
              hitSlop={8}
            >
              <Text style={styles.unknownToggle}>
                {departureDateUnknown ? 'Add date' : "Don't know yet"}
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.dateInput, departureDateUnknown && styles.dateInputMuted]}
            value={departureDateUnknown ? '' : departureDate}
            onChangeText={setDepartureDate}
            placeholder={departureDateUnknown ? 'TBD' : 'DD / MM / YYYY'}
            placeholderTextColor={departureDateUnknown ? colors.textMuted : colors.border}
            keyboardType="numbers-and-punctuation"
            editable={!departureDateUnknown}
          />
        </View>
      </ScrollView>

      <Footer onNext={onNext} nextEnabled={canProceed} onBack={onBack} />
    </View>
  );
}

// ─── Step 3 (Multi): Trip Start + Stops with Nights ──────────────────────────

function Step3Multi({
  tripStartDate, setTripStartDate, stops, onAdd, onRemove, onUpdate, onMove,
  onCityBlur, onNext, onBack,
}: {
  tripStartDate: string;
  setTripStartDate: (v: string) => void;
  stops: TripStop[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: 'city' | 'nights', value: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onCityBlur: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const canProceed = stops.length > 0 && stops.every((s) => s.city.trim().length > 0);

  return (
    <View style={styles.stepContainer}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepLabel}>Step 3 of 4</Text>
        <Text style={styles.stepTitle}>Add your{'\n'}stops</Text>

        {/* Trip start date */}
        <View style={styles.tripStartBlock}>
          <Text style={styles.fieldLabel}>Trip starts</Text>
          <TextInput
            style={styles.dateInput}
            value={tripStartDate}
            onChangeText={setTripStartDate}
            placeholder="DD / MM / YYYY"
            placeholderTextColor={colors.border}
            keyboardType="numbers-and-punctuation"
          />
        </View>

        {/* Stops list */}
        {stops.length === 0 ? (
          <View style={styles.emptyStops}>
            <View style={styles.emptyStopsIcon}>
              <Feather name="map-pin" size={26} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyStopsText}>No stops yet</Text>
            <Text style={styles.emptyStopsHint}>Add at least one stop to continue</Text>
          </View>
        ) : (
          <View style={styles.stopsList}>
            {stops.map((stop, index) => {
              const range = stopDateRange(tripStartDate, stops, index);
              return (
                <View key={stop.id} style={styles.stopCard}>
                  {/* City row */}
                  <View style={styles.stopCardTop}>
                    <View style={styles.stopIndex}>
                      <Text style={styles.stopIndexText}>{index + 1}</Text>
                    </View>
                    <TextInput
                      style={styles.stopCityInput}
                      value={stop.city}
                      onChangeText={(v) => onUpdate(stop.id, 'city', v)}
                      onBlur={() => onCityBlur(stop.id)}
                      placeholder="City name"
                      placeholderTextColor={colors.border}
                      autoFocus={index === stops.length - 1 && stop.city === ''}
                      returnKeyType="done"
                    />
                    {stop.geocoding && (
                      <ActivityIndicator size="small" color={colors.textMuted} style={styles.stopGeoSpinner} />
                    )}
                    <View style={styles.stopReorder}>
                      <Pressable onPress={() => onMove(stop.id, 'up')} disabled={index === 0} hitSlop={4}>
                        <Feather name="chevron-up" size={15} color={index === 0 ? colors.border : colors.textMuted} />
                      </Pressable>
                      <Pressable onPress={() => onMove(stop.id, 'down')} disabled={index === stops.length - 1} hitSlop={4}>
                        <Feather name="chevron-down" size={15} color={index === stops.length - 1 ? colors.border : colors.textMuted} />
                      </Pressable>
                    </View>
                    <Pressable onPress={() => onRemove(stop.id)} hitSlop={8} style={styles.removeButton}>
                      <Feather name="x" size={15} color={colors.textMuted} />
                    </Pressable>
                  </View>

                  {/* Nights + date range row */}
                  <View style={styles.stopCardBottom}>
                    <TextInput
                      style={styles.nightsInput}
                      value={stop.nights}
                      onChangeText={(v) => onUpdate(stop.id, 'nights', v.replace(/\D/g, ''))}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.border}
                    />
                    <Text style={styles.nightsLabel}>nights</Text>
                    <Text style={styles.stopMidDot}>·</Text>
                    <Text style={styles.stopDateRange}>{range}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <Pressable onPress={onAdd} style={styles.addStopButton}>
          <Feather name="plus" size={16} color={colors.primary} />
          <Text style={styles.addStopText}>Add stop</Text>
        </Pressable>
      </ScrollView>

      <Footer onNext={onNext} nextEnabled={canProceed} onBack={onBack} />
    </View>
  );
}

// ─── Step 4 (Single): Review ──────────────────────────────────────────────────

function Step4Single({ tripName, destination, arrivalDate, departureDate, departureDateUnknown, onBack, onCreate, saving }: {
  tripName: string;
  destination: string;
  arrivalDate: string;
  departureDate: string;
  departureDateUnknown: boolean;
  onBack: () => void;
  onCreate: () => void;
  saving?: boolean;
}) {
  const departureLine = departureDateUnknown ? 'TBD' : departureDate || '—';

  return (
    <View style={styles.stepContainer}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
        <Text style={styles.stepLabel}>Step 4 of 4</Text>
        <Text style={styles.stepTitle}>Review</Text>

        <View style={styles.reviewCard}>
          <View style={styles.reviewTypePill}>
            <Feather name="map-pin" size={11} color={colors.primary} />
            <Text style={styles.reviewTypePillText}>Single Destination</Text>
          </View>

          <Text style={styles.reviewTripName}>{tripName}</Text>

          <View style={styles.reviewRow}>
            <Feather name="map-pin" size={14} color={colors.textMuted} />
            <Text style={styles.reviewMeta}>{destination}</Text>
          </View>

          <View style={styles.reviewDivider} />

          <View style={styles.reviewRow}>
            <Feather name="log-in" size={14} color={colors.textMuted} />
            <Text style={styles.reviewMetaLabel}>Arrival</Text>
            <Text style={styles.reviewMeta}>{arrivalDate || '—'}</Text>
          </View>

          <View style={styles.reviewRow}>
            <Feather name="log-out" size={14} color={colors.textMuted} />
            <Text style={styles.reviewMetaLabel}>Departure</Text>
            {departureDateUnknown ? (
              <View style={styles.tbdBadge}>
                <Text style={styles.tbdBadgeText}>TBD</Text>
              </View>
            ) : (
              <Text style={styles.reviewMeta}>{departureLine}</Text>
            )}
          </View>

          <View style={styles.reviewNote}>
            <Feather name="info" size={13} color={colors.textMuted} />
            <Text style={styles.reviewNoteText}>
              Transport details (flights, trains, tickets) can be added after creating the trip.
            </Text>
          </View>
        </View>
      </ScrollView>

      <Footer onNext={onCreate} nextLabel={saving ? 'Saving…' : 'Create Trip'} nextIcon="check" nextEnabled={!saving} onBack={onBack} />
    </View>
  );
}

// ─── Step 4 (Multi): Review ───────────────────────────────────────────────────

function Step4Multi({ tripName, tripStartDate, stops, onBack, onCreate, saving }: {
  tripName: string;
  tripStartDate: string;
  stops: TripStop[];
  onBack: () => void;
  onCreate: () => void;
  saving?: boolean;
}) {
  const total = totalNights(stops);
  const endDate = tripEndDate(tripStartDate, stops);
  const dateRange = tripDateRange(tripStartDate, stops);

  return (
    <View style={styles.stepContainer}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
        <Text style={styles.stepLabel}>Step 4 of 4</Text>
        <Text style={styles.stepTitle}>Review</Text>

        <View style={styles.reviewCard}>
          <View style={styles.reviewTypePill}>
            <Feather name="git-branch" size={11} color={colors.primary} />
            <Text style={styles.reviewTypePillText}>Multi-Stop</Text>
          </View>

          <Text style={styles.reviewTripName}>{tripName}</Text>

          {tripStartDate ? (
            <View style={styles.reviewRow}>
              <Feather name="calendar" size={14} color={colors.textMuted} />
              <Text style={styles.reviewMeta}>{dateRange}</Text>
            </View>
          ) : null}

          <View style={styles.reviewDivider} />

          {/* Stop list */}
          <View style={styles.reviewRoute}>
            {stops.map((stop, index) => {
              const range = stopDateRange(tripStartDate, stops, index);
              const nights = parseInt(stop.nights, 10);
              return (
                <View key={stop.id} style={styles.reviewRouteStop}>
                  {index < stops.length - 1 && <View style={styles.reviewRouteLine} />}
                  <View style={styles.reviewRouteDot} />
                  <View style={styles.reviewRouteBody}>
                    <Text style={styles.reviewRouteCity}>{stop.city}</Text>
                    <Text style={styles.reviewRouteMeta}>
                      {range !== '— –– ——' ? range : '—'}
                      {!isNaN(nights) && nights > 0 ? `  ·  ${nights} nights` : ''}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.reviewDivider} />

          {/* Totals */}
          <View style={styles.reviewTotals}>
            <Text style={styles.reviewTotalsText}>
              {stops.length} stop{stops.length !== 1 ? 's' : ''}
              {total > 0 ? `  ·  ${total} nights total` : ''}
              {endDate !== '——' ? `  ·  ends ${endDate}` : ''}
            </Text>
          </View>
        </View>
      </ScrollView>

      <Footer onNext={onCreate} nextLabel={saving ? 'Saving…' : 'Create Trip'} nextIcon="check" nextEnabled={!saving} onBack={onBack} />
    </View>
  );
}

// ─── Modal Root ───────────────────────────────────────────────────────────────

export default function CreateTripModal() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [tripName, setTripName] = useState('');
  const [tripType, setTripType] = useState<TripType | null>(null);

  // Single destination state
  const [destination, setDestination] = useState('');
  const [destinationGeo, setDestinationGeo] = useState<GeoResult | null>(null);
  const [geocodingDestination, setGeocodingDestination] = useState(false);
  const destGeoAbort = useRef<AbortController | null>(null);

  const [arrivalDate, setArrivalDate] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [departureDateUnknown, setDepartureDateUnknown] = useState(false);

  // Multi-stop state
  const [tripStartDate, setTripStartDate] = useState('');
  const [stops, setStops] = useState<TripStop[]>([]);
  const stopGeoAborts = useRef<Record<string, AbortController>>({});

  const [saving, setSaving] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goTo = (next: number) => {
    const dir = next > step ? -1 : 1;
    Animated.timing(slideAnim, { toValue: dir * 380, duration: 200, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(-dir * 380);
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    });
  };

  // ── Destination (single) change + blur ────────────────────────────────────

  const handleDestinationChange = (v: string) => {
    setDestination(v);
    setDestinationGeo(null); // clear stale geo when user edits
  };

  const handleDestinationBlur = async () => {
    const name = destination.trim();
    if (!name) return;

    destGeoAbort.current?.abort();
    const controller = new AbortController();
    destGeoAbort.current = controller;

    setGeocodingDestination(true);
    const result = await geocodeCity(name, controller.signal);

    if (!controller.signal.aborted) {
      setDestinationGeo(result);
      setGeocodingDestination(false);
    }
  };

  // ── Stop management (multi) ────────────────────────────────────────────────

  const addStop = () =>
    setStops((prev) => [...prev, { id: Date.now().toString(), city: '', nights: '', lat: null, lng: null, geocoding: false }]);

  const removeStop = (id: string) => {
    stopGeoAborts.current[id]?.abort();
    delete stopGeoAborts.current[id];
    setStops((prev) => prev.filter((s) => s.id !== id));
  };

  const updateStop = (id: string, field: 'city' | 'nights', value: string) =>
    setStops((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      // Clear stale geo whenever the city text changes
      if (field === 'city') return { ...s, city: value, lat: null, lng: null };
      return { ...s, [field]: value };
    }));

  const handleCityBlur = async (id: string) => {
    const stop = stops.find((s) => s.id === id);
    if (!stop || !stop.city.trim()) return;
    const cityAtBlur = stop.city.trim();

    stopGeoAborts.current[id]?.abort();
    const controller = new AbortController();
    stopGeoAborts.current[id] = controller;

    setStops((prev) => prev.map((s) => s.id === id ? { ...s, geocoding: true } : s));

    const result = await geocodeCity(cityAtBlur, controller.signal);

    if (!controller.signal.aborted) {
      setStops((prev) => prev.map((s) => {
        if (s.id !== id) return s;
        // Discard if user changed the city while we were geocoding
        if (s.city.trim() !== cityAtBlur) return { ...s, geocoding: false };
        return { ...s, geocoding: false, lat: result?.lat ?? null, lng: result?.lng ?? null };
      }));
    }
  };

  const moveStop = (id: string, dir: 'up' | 'down') => {
    setStops((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (dir === 'up' && idx === 0) return prev;
      if (dir === 'down' && idx === prev.length - 1) return prev;
      const next = [...prev];
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function toISODate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ── Create Single ──────────────────────────────────────────────────────────

  const createSingle = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        Alert.alert('Not signed in', 'Please sign in to create a trip.');
        setSaving(false);
        return;
      }

      const startDate = parseDate(arrivalDate);
      const endDate = departureDateUnknown ? null : parseDate(departureDate);

      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .insert({
          name: tripName,
          type: 'single',
          owner_id: user.id,
          start_date: startDate ? toISODate(startDate) : null,
          end_date: endDate ? toISODate(endDate) : null,
        })
        .select()
        .single();

      if (tripError) {
        console.error('Trip insert error:', JSON.stringify(tripError, null, 2));
        Alert.alert('Could not create trip', `${tripError.message}\n\nCode: ${tripError.code}\nHint: ${tripError.hint ?? 'none'}`);
        return;
      }

      await supabase.from('stops').insert({
        trip_id: trip.id,
        city: destinationGeo?.name ?? destination,
        latitude: destinationGeo?.lat ?? null,
        longitude: destinationGeo?.lng ?? null,
        order_index: 0,
        start_date: startDate ? toISODate(startDate) : null,
        end_date: endDate ? toISODate(endDate) : null,
      });

      router.back();
    } catch (e) {
      console.error('Failed to create trip:', e);
    } finally {
      setSaving(false);
    }
  };

  // ── Create Multi ───────────────────────────────────────────────────────────

  const createMulti = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        Alert.alert('Not signed in', 'Please sign in to create a trip.');
        setSaving(false);
        return;
      }

      const startDate = parseDate(tripStartDate);
      const total = totalNights(stops);
      const endDate = startDate && total > 0 ? addDays(startDate, total) : null;

      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .insert({
          name: tripName,
          type: 'multi',
          owner_id: user.id,
          start_date: startDate ? toISODate(startDate) : null,
          end_date: endDate ? toISODate(endDate) : null,
        })
        .select()
        .single();

      if (tripError) {
        console.error('Trip insert error:', JSON.stringify(tripError, null, 2));
        Alert.alert('Could not create trip', `${tripError.message}\n\nCode: ${tripError.code}\nHint: ${tripError.hint ?? 'none'}`);
        return;
      }

      let offset = 0;
      const stopRows = stops.map((s, idx) => {
        const nights = parseInt(s.nights, 10) || 0;
        const stopStart = startDate ? addDays(startDate, offset) : null;
        const stopEnd = stopStart && nights > 0 ? addDays(stopStart, nights) : null;
        offset += nights;
        return {
          trip_id: trip.id,
          city: s.city,
          latitude: s.lat ?? null,
          longitude: s.lng ?? null,
          nights,
          order_index: idx,
          start_date: stopStart ? toISODate(stopStart) : null,
          end_date: stopEnd ? toISODate(stopEnd) : null,
        };
      });

      await supabase.from('stops').insert(stopRows);

      router.back();
    } catch (e) {
      console.error('Failed to create trip:', e);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeButton}>
            <Feather name="x" size={20} color={colors.text} />
          </Pressable>
          <ProgressDots step={step} />
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[styles.flex, { transform: [{ translateX: slideAnim }] }]}>

            {step === 1 && (
              <Step1 tripName={tripName} setTripName={setTripName} onNext={() => goTo(2)} />
            )}

            {step === 2 && (
              <Step2
                tripType={tripType}
                onSelect={(t) => { setTripType(t); goTo(3); }}
                onBack={() => goTo(1)}
              />
            )}

            {step === 3 && tripType === 'single' && (
              <Step3Single
                destination={destination}
                setDestination={handleDestinationChange}
                arrivalDate={arrivalDate} setArrivalDate={setArrivalDate}
                departureDate={departureDate} setDepartureDate={setDepartureDate}
                departureDateUnknown={departureDateUnknown}
                setDepartureDateUnknown={setDepartureDateUnknown}
                geocodingDestination={geocodingDestination}
                onDestinationBlur={handleDestinationBlur}
                onNext={() => goTo(4)} onBack={() => goTo(2)}
              />
            )}

            {step === 3 && tripType === 'multi' && (
              <Step3Multi
                tripStartDate={tripStartDate} setTripStartDate={setTripStartDate}
                stops={stops} onAdd={addStop} onRemove={removeStop}
                onUpdate={updateStop} onMove={moveStop}
                onCityBlur={handleCityBlur}
                onNext={() => goTo(4)} onBack={() => goTo(2)}
              />
            )}

            {step === 4 && tripType === 'single' && (
              <Step4Single
                tripName={tripName} destination={destination}
                arrivalDate={arrivalDate} departureDate={departureDate}
                departureDateUnknown={departureDateUnknown}
                onBack={() => goTo(3)} onCreate={createSingle} saving={saving}
              />
            )}

            {step === 4 && tripType === 'multi' && (
              <Step4Multi
                tripName={tripName} tripStartDate={tripStartDate} stops={stops}
                onBack={() => goTo(3)} onCreate={createMulti} saving={saving}
              />
            )}

          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  closeButton: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center',
  },
  headerSpacer: { width: 34 },

  // Progress dots
  dotsContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 22, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  dotComplete: { backgroundColor: '#8AB8C4' },

  // Step shell
  stepContainer: { flex: 1 },
  stepContent: { padding: 24, paddingBottom: 8, flexGrow: 1 },
  stepLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.0,
    textTransform: 'uppercase', color: colors.textMuted, marginBottom: 8,
  },
  stepTitle: {
    fontFamily: fonts.displayBold, fontSize: 36, lineHeight: 44,
    letterSpacing: -0.3, color: colors.text, marginBottom: 36,
  },

  // Common field styles
  fieldLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.0,
    textTransform: 'uppercase', color: colors.textMuted, marginBottom: 10,
  },

  // Title-style big underline input
  titleInput: {
    fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 42,
    letterSpacing: -0.3, color: colors.text, paddingVertical: 4, minHeight: 50,
  },
  titleUnderline: { height: 2, backgroundColor: colors.border, marginTop: 6, borderRadius: 1 },
  titleUnderlineActive: { backgroundColor: colors.primary },

  // Box date input
  dateInput: {
    fontFamily: fonts.body, fontSize: 14, color: colors.text,
    paddingVertical: 11, paddingHorizontal: 12,
    backgroundColor: colors.white, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  dateInputMuted: { backgroundColor: colors.background, color: colors.textMuted },

  // Date field blocks
  dateBlock: { marginTop: 28 },
  tripStartBlock: { marginBottom: 28 },
  dateLabelRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  unknownToggle: {
    fontFamily: fonts.bodyBold, fontSize: 12,
    color: colors.primary, letterSpacing: 0.2,
  },

  // Type choice cards
  typeCards: { gap: 14 },
  typeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: colors.white, borderRadius: 16, padding: 18,
    borderWidth: 1.5, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  typeCardSelected: { borderColor: colors.primary, backgroundColor: '#F0F7F9' },
  typeCardPressed: { opacity: 0.85 },
  typeCardIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: '#EBF3F6', alignItems: 'center', justifyContent: 'center',
  },
  typeCardIconSelected: { backgroundColor: colors.primary },
  typeCardBody: { flex: 1, gap: 4 },
  typeCardTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text },
  typeCardTitleSelected: { color: colors.primary },
  typeCardSubtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  typeCardCheck: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  typeCardCheckSelected: { backgroundColor: colors.primary, borderColor: colors.primary },

  // Stops (multi)
  emptyStops: { alignItems: 'center', paddingVertical: 44, gap: 8 },
  emptyStopsIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyStopsText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  emptyStopsHint: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  stopsList: { gap: 10, marginBottom: 16 },
  stopCard: {
    backgroundColor: colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10,
  },
  stopCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopIndex: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#EBF3F6', alignItems: 'center', justifyContent: 'center',
  },
  stopIndexText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.primary },
  stopCityInput: {
    flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text, paddingVertical: 10,
  },
  stopGeoSpinner: { marginRight: 2 },
  stopReorder: { alignItems: 'center', gap: 2 },
  removeButton: { padding: 4 },

  stopCardBottom: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: 32,
    marginTop: 4,
  },
  nightsInput: {
    fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text,
    width: 42, textAlign: 'center',
    paddingVertical: 5, paddingHorizontal: 8,
    backgroundColor: colors.background, borderRadius: 7,
    borderWidth: 1, borderColor: colors.border,
  },
  nightsLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
  stopMidDot: { fontFamily: fonts.body, fontSize: 13, color: colors.border },
  stopDateRange: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  addStopButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1,
    borderColor: '#8AB8C4', backgroundColor: '#F0F7F9',
  },
  addStopText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },

  // Review card
  reviewCard: {
    backgroundColor: colors.white, borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  reviewTypePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: '#EBF3F6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 12,
  },
  reviewTypePillText: {
    fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.6,
    textTransform: 'uppercase', color: colors.primary,
  },
  reviewTripName: {
    fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 32,
    letterSpacing: -0.2, color: colors.text, marginBottom: 14,
  },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  reviewMetaLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.textMuted, width: 72 },
  reviewMeta: { fontFamily: fonts.body, fontSize: 14, color: colors.text },
  reviewDivider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },

  tbdBadge: {
    backgroundColor: colors.background, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.border,
  },
  tbdBadgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted, letterSpacing: 0.5 },

  reviewNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.background, borderRadius: 10, padding: 12, marginTop: 14,
  },
  reviewNoteText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, lineHeight: 18 },

  // Multi-stop review route
  reviewRoute: { gap: 12 },
  reviewRouteStop: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingLeft: 4, position: 'relative',
  },
  reviewRouteDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary,
    marginTop: 4, zIndex: 1,
  },
  reviewRouteLine: {
    position: 'absolute', left: 7, top: 12, width: 2, height: 28, backgroundColor: colors.border,
  },
  reviewRouteBody: { flex: 1, gap: 2 },
  reviewRouteCity: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  reviewRouteMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  reviewTotals: { alignItems: 'center' },
  reviewTotalsText: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  // Footer variants
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 16,
    backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border,
  },
  backOnlyFooter: {
    paddingHorizontal: 20, paddingVertical: 16,
    backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border,
  },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: colors.primary,
    paddingHorizontal: 22, paddingVertical: 14, borderRadius: 14,
  },
  primaryButtonFlex: { flex: 1 },
  primaryButtonDisabled: { backgroundColor: '#EBF3F6' },
  primaryButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },
  primaryButtonTextDisabled: { color: colors.border },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white,
  },
  secondaryButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
});
