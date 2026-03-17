import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
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
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import { updatePlace, deletePlace, type SavedPlace } from '@/lib/savedPlaceUtils';
import type { PlaceCategory } from '@/lib/placesEnrichment';

// ─── Category config ───────────────────────────────────────────────────────────

type CategoryConfig = {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
};

const PLACE_CATEGORIES: PlaceCategory[] = [
  'Restaurants', 'Bars', 'Museums', 'Activities', 'Sights', 'Shopping', 'Other',
];

const CATEGORY_CONFIG: Record<PlaceCategory, CategoryConfig> = {
  Restaurants: { icon: 'coffee',       iconBg: '#FBF0E8', iconColor: '#C07A4F', badgeBg: '#FBF0E8', badgeText: '#9A5C35' },
  Bars:        { icon: 'sunset',       iconBg: '#EDECF8', iconColor: '#5B5EA6', badgeBg: '#EDECF8', badgeText: '#3F4280' },
  Museums:     { icon: 'book-open',    iconBg: '#E8F2F5', iconColor: '#2C5F6E', badgeBg: '#E8F2F5', badgeText: '#2C5F6E' },
  Activities:  { icon: 'compass',      iconBg: '#E6F3EC', iconColor: '#2E7D5A', badgeBg: '#E6F3EC', badgeText: '#1E5C3F' },
  Sights:      { icon: 'camera',       iconBg: '#F8F0E0', iconColor: '#B07D2A', badgeBg: '#F8F0E0', badgeText: '#8A5F18' },
  Shopping:    { icon: 'shopping-bag', iconBg: '#F5EBF3', iconColor: '#8B4F7A', badgeBg: '#F5EBF3', badgeText: '#6A3A5B' },
  Other:       { icon: 'map-pin',      iconBg: '#EEECE9', iconColor: '#7A7570', badgeBg: '#EEECE9', badgeText: '#5A5550' },
};

function cfgFor(cat: PlaceCategory | null | undefined): CategoryConfig {
  return cat ? (CATEGORY_CONFIG[cat] ?? CATEGORY_CONFIG.Other) : CATEGORY_CONFIG.Other;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StopInfo {
  id: string;
  city: string;
  start_date: string | null;
  end_date: string | null;
}

// SavedPlace extended with joined stop data from the fetch
interface PlaceWithStop extends SavedPlace {
  stops: StopInfo | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatStopLabel(stop: StopInfo): string {
  const { city, start_date, end_date } = stop;
  if (!start_date) return city;
  const s = new Date(start_date + 'T00:00:00');
  if (!end_date) return `${city} · ${s.getDate()} ${MONTHS[s.getMonth()]}`;
  const e = new Date(end_date + 'T00:00:00');
  const dateStr =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
      ? `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]}`
      : `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
  return `${city} · ${dateStr}`;
}

/** Returns "Name, address" or "Name, city" or just "Name" for use as a Maps search query. */
function disambiguatedQuery(place: PlaceWithStop): string {
  if (place.address) return `${place.name}, ${place.address}`;
  const city = place.city ?? place.stops?.city;
  if (city) return `${place.name}, ${city}`;
  return place.name;
}

function appleMapsUrl(place: PlaceWithStop): string {
  const encoded = encodeURIComponent(disambiguatedQuery(place));
  if (place.latitude != null && place.longitude != null) {
    return `maps://?q=${encoded}&ll=${place.latitude},${place.longitude}`;
  }
  return `maps://?q=${encoded}`;
}

function googleMapsNativeUrl(place: PlaceWithStop): string {
  const encoded = encodeURIComponent(disambiguatedQuery(place));
  if (place.latitude != null && place.longitude != null) {
    return `comgooglemaps://?q=${encoded}&center=${place.latitude},${place.longitude}`;
  }
  return `comgooglemaps://?q=${encoded}`;
}

function googleMapsWebUrl(place: PlaceWithStop): string {
  const encoded = encodeURIComponent(disambiguatedQuery(place));
  if (place.google_place_id) {
    return `https://www.google.com/maps/search/?api=1&query=${encoded}&query_place_id=${place.google_place_id}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlaceDetailScreen() {
  const router = useRouter();
  const { placeId } = useLocalSearchParams<{ placeId: string }>();

  const [place, setPlace] = useState<PlaceWithStop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<PlaceCategory>('Other');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Image error state
  const [photoError, setPhotoError] = useState(false);
  const [sourceImageError, setSourceImageError] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!placeId) {
      setError('No place specified.');
      setLoading(false);
      return;
    }

    (async () => {
      const { data, error: fetchErr } = await supabase
        .from('saved_items')
        .select('*, stops(id, city, start_date, end_date)')
        .eq('id', placeId)
        .single();

      if (fetchErr || !data) {
        setError('Could not load this place.');
        setLoading(false);
        return;
      }

      const raw = data as any;
      setPlace({
        ...raw,
        stops: raw.stops ?? null,
      } as PlaceWithStop);
      setLoading(false);
    })();
  }, [placeId]);

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastOpacity.setValue(0);
    Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setToastMsg(null);
      });
    }, 3000);
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────

  function enterEdit() {
    if (!place) return;
    setEditName(place.name);
    setEditCategory(place.category ?? 'Other');
    setEditNote(place.note ?? '');
    setEditMode(true);
  }

  function hasEdits(): boolean {
    if (!place) return false;
    return (
      editName.trim() !== place.name ||
      editCategory !== (place.category ?? 'Other') ||
      editNote.trim() !== (place.note ?? '')
    );
  }

  function handleCancelEdit() {
    if (!hasEdits()) {
      setEditMode(false);
      return;
    }
    Alert.alert(
      'Discard changes?',
      'Your edits to this place haven\'t been saved.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => setEditMode(false) },
      ]
    );
  }

  async function handleSave() {
    if (!place) return;
    const name = editName.trim();
    if (!name) {
      Alert.alert('Name required', 'Please enter a place name.');
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePlace(place.id, {
        name,
        category: editCategory,
        note: editNote.trim() || null,
      });
      setPlace(prev => prev ? { ...prev, ...updated } : prev);
      setEditMode(false);
      showToast('Changes saved');
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function handleDelete() {
    if (!place) return;
    Alert.alert(
      'Delete this place?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDelete },
      ]
    );
  }

  async function confirmDelete() {
    if (!place) return;
    try {
      await deletePlace(place.id);
      router.back();
    } catch (err: any) {
      Alert.alert('Could not delete', err?.message ?? 'Please try again.');
    }
  }

  // ── Maps ───────────────────────────────────────────────────────────────────

  async function handleOpenMaps() {
    if (!place) return;

    const googleInstalled = await Linking.canOpenURL('comgooglemaps://');

    const options: Array<{ text: string; onPress: () => void }> = [
      {
        text: 'Apple Maps',
        onPress: () => Linking.openURL(appleMapsUrl(place)),
      },
    ];

    options.push({
      text: 'Google Maps',
      onPress: () => Linking.openURL(
        googleInstalled ? googleMapsNativeUrl(place) : googleMapsWebUrl(place)
      ),
    });

    Alert.alert(
      'Open in Maps',
      undefined,
      [
        ...options.map(o => ({ text: o.text, onPress: o.onPress })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }

  // ── Loading / Error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centredFull}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !place) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <SafeAreaView edges={['top']} style={styles.safeTop}>
          <View style={styles.navRow}>
            <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
              <Feather name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          </View>
        </SafeAreaView>
        <View style={styles.centredFull}>
          <Text style={styles.errorText}>{error ?? 'Something went wrong.'}</Text>
          <Pressable style={styles.goBackBtn} onPress={() => router.back()}>
            <Text style={styles.goBackText}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const cfg = cfgFor(place.category);
  const hasPhoto = !!place.photo_url && !photoError;
  const hasSourceImage = !!place.source_image_url && !sourceImageError;
  const hasHero = hasPhoto || hasSourceImage;
  const hasMap = place.latitude != null && place.longitude != null;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* ── Header ── */}
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.navRow}>
          {editMode ? (
            <Pressable onPress={handleCancelEdit} hitSlop={8} style={styles.navTextLeft}>
              <Text style={styles.navCancel}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
              <Feather name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          )}

          <View style={styles.navSpacer} />

          {editMode ? (
            <Pressable onPress={handleSave} disabled={saving} hitSlop={8} style={styles.navTextRight}>
              {saving
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={styles.navSave}>Save</Text>
              }
            </Pressable>
          ) : (
            <Pressable onPress={enterEdit} hitSlop={8} style={styles.navTextRight}>
              <Text style={styles.navEdit}>Edit</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      {/* ── Body ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero image */}
          {!editMode && hasHero && (
            <View style={styles.heroWrap}>
              <Image
                source={{ uri: hasPhoto ? place.photo_url! : place.source_image_url! }}
                style={styles.heroImage}
                resizeMode="cover"
                onError={() => {
                  if (hasPhoto) setPhotoError(true);
                  else setSourceImageError(true);
                }}
              />
            </View>
          )}

          {/* No hero — icon placeholder */}
          {!editMode && !hasHero && (
            <View style={[styles.iconPlaceholder, { backgroundColor: cfg.iconBg }]}>
              <Feather name={cfg.icon} size={40} color={cfg.iconColor} />
            </View>
          )}

          {/* ── DISPLAY MODE ── */}
          {!editMode && (
            <>
              {/* Name + badge */}
              <Text style={styles.placeName}>{place.name}</Text>
              {!!place.category && (
                <View style={[styles.categoryBadge, { backgroundColor: cfg.badgeBg }]}>
                  <Text style={[styles.categoryBadgeText, { color: cfg.badgeText }]}>
                    {place.category}
                  </Text>
                </View>
              )}

              {/* Meta rows */}
              {!!place.address && (
                <View style={styles.metaRow}>
                  <Feather name="map-pin" size={14} color={colors.textMuted} style={styles.metaIcon} />
                  <Text style={styles.metaText}>{place.address}</Text>
                </View>
              )}

              {!!place.stops && (
                <View style={styles.metaRow}>
                  <Feather name="briefcase" size={14} color={colors.textMuted} style={styles.metaIcon} />
                  <Text style={styles.metaText}>{formatStopLabel(place.stops)}</Text>
                </View>
              )}

              {/* Note card */}
              {!!place.note && (
                <View style={styles.noteCard}>
                  <Text style={styles.noteText}>{place.note}</Text>
                </View>
              )}

              {/* Map preview */}
              {hasMap && (
                <View style={styles.mapWrap} pointerEvents="none">
                  <MapView
                    provider={PROVIDER_DEFAULT}
                    style={styles.map}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    initialRegion={{
                      latitude: place.latitude!,
                      longitude: place.longitude!,
                      latitudeDelta: 0.006,
                      longitudeDelta: 0.006,
                    }}
                  >
                    <Marker
                      coordinate={{ latitude: place.latitude!, longitude: place.longitude! }}
                      title={place.name}
                    />
                  </MapView>
                </View>
              )}

              {/* Action buttons */}
              <View style={styles.actionsSection}>
                <Pressable
                  style={({ pressed }) => [styles.mapsBtn, pressed && { opacity: 0.8 }]}
                  onPress={handleOpenMaps}
                >
                  <Feather name="map" size={16} color={colors.primary} style={styles.mapsBtnIcon} />
                  <Text style={styles.mapsBtnText}>Open in Maps</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
                  onPress={handleDelete}
                >
                  <Text style={styles.deleteBtnText}>Delete Place</Text>
                </Pressable>
              </View>
            </>
          )}

          {/* ── EDIT MODE ── */}
          {editMode && (
            <View style={styles.editSection}>
              {/* Name */}
              <Text style={styles.fieldLabel}>Name</Text>
              <View style={styles.inputCard}>
                <TextInput
                  style={styles.textInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Place name"
                  placeholderTextColor={colors.border}
                  autoFocus
                  returnKeyType="done"
                />
              </View>

              {/* Category */}
              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.categoryGrid}>
                {PLACE_CATEGORIES.map((cat) => {
                  const selected = editCategory === cat;
                  const catCfg = CATEGORY_CONFIG[cat];
                  return (
                    <Pressable
                      key={cat}
                      style={[styles.catChip, selected && styles.catChipSelected]}
                      onPress={() => setEditCategory(cat)}
                    >
                      <Feather
                        name={catCfg.icon}
                        size={13}
                        color={selected ? colors.white : catCfg.iconColor}
                        style={{ marginRight: 5 }}
                      />
                      <Text style={[styles.catChipText, selected && styles.catChipTextSelected]}>
                        {cat}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Note */}
              <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Note</Text>
              <View style={[styles.inputCard, styles.noteInputCard]}>
                <TextInput
                  style={[styles.textInput, styles.noteInput]}
                  value={editNote}
                  onChangeText={setEditNote}
                  placeholder="Description, tips, hours…"
                  placeholderTextColor={colors.border}
                  multiline
                  blurOnSubmit
                />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Toast */}
      {toastMsg ? (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centredFull: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  safeTop: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  backBtn: { width: 36, alignItems: 'flex-start' },
  navSpacer: { flex: 1 },
  navTextLeft: { paddingRight: 4 },
  navTextRight: { paddingLeft: 4 },
  navCancel: { fontFamily: fonts.body, fontSize: 16, color: colors.textMuted },
  navEdit: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.primary },
  navSave: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.primary },

  scrollContent: { paddingBottom: 60 },

  // Hero
  heroWrap: {
    height: 240,
    backgroundColor: colors.background,
  },
  heroImage: { width: '100%', height: '100%' },

  iconPlaceholder: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Display mode content
  placeName: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.text,
    letterSpacing: -0.3,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
    lineHeight: 34,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    marginHorizontal: 20,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 16,
  },
  categoryBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.2,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 20,
    marginBottom: 8,
    gap: 8,
  },
  metaIcon: { marginTop: 2 },
  metaText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },

  noteCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
  },

  mapWrap: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 14,
    overflow: 'hidden',
    height: 180,
  },
  map: { flex: 1 },

  actionsSection: {
    marginTop: 28,
    marginHorizontal: 20,
    gap: 12,
  },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  mapsBtnIcon: { marginRight: 8 },
  mapsBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.primary,
  },
  deleteBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  deleteBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.error,
  },

  // Edit mode
  editSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  fieldLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  inputCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  noteInputCard: { marginBottom: 12 },
  textInput: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    padding: 0,
  },
  noteInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  catChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  catChipText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text,
  },
  catChipTextSelected: { color: colors.white },

  // Error state
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 16,
    textAlign: 'center',
  },
  goBackBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  goBackText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },

  // Toast
  toast: {
    position: 'absolute',
    bottom: 36,
    left: 20,
    right: 20,
    backgroundColor: colors.text,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  toastText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.white,
    textAlign: 'center',
  },
});
