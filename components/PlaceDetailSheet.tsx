import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import type { PlaceCategory } from '@/lib/placesEnrichment';
import {
  updatePlace,
  assignInboxItem,
  movePlaceToInbox,
  deletePlace,
  type SavedPlace,
} from '@/lib/savedPlaceUtils';

// ─── Category config ──────────────────────────────────────────────────────────

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

function cfgFor(category: PlaceCategory | null | undefined): CategoryConfig {
  return category ? (CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.Other) : CATEGORY_CONFIG.Other;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripWithStops {
  id: string;
  name: string;
  stops: { id: string; city: string }[];
}

export interface PlaceDetailSheetProps {
  visible: boolean;
  place: SavedPlace | null;
  onClose: () => void;
  /** Called after a successful edit — update the place in the parent list. */
  onUpdated: (place: SavedPlace) => void;
  /** Called after deletion — remove the place from the parent list. */
  onDeleted: (placeId: string) => void;
  /** Called after the place is moved to another stop or to inbox — remove it from the parent list. */
  onMoved: (placeId: string) => void;
  /** Whether to show "Move to Inbox" in the move panel. False when already in inbox. */
  canMoveToInbox?: boolean;
}

type ViewMode = 'detail' | 'edit' | 'move';

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlaceDetailSheet({
  visible,
  place,
  onClose,
  onUpdated,
  onDeleted,
  onMoved,
  canMoveToInbox = true,
}: PlaceDetailSheetProps) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<ViewMode>('detail');

  // Edit state
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<PlaceCategory>('Restaurants');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Move state
  const [trips, setTrips] = useState<TripWithStops[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [tripsLoaded, setTripsLoaded] = useState(false);
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // Image state
  const [sourceImageError, setSourceImageError] = useState(false);

  // Reset to detail mode and pre-fill edit fields whenever a new place opens
  useEffect(() => {
    if (visible && place) {
      setMode('detail');
      setEditName(place.name);
      setEditCategory(place.category ?? 'Other');
      setEditNote(place.note ?? '');
      setSourceImageError(false);
    }
  }, [visible, place?.id]);

  // Reset expanded trip when entering move mode
  useEffect(() => {
    if (mode === 'move') {
      setExpandedTripId(null);
      loadTrips();
    }
  }, [mode]);

  async function loadTrips() {
    if (tripsLoaded) return;
    setLoadingTrips(true);
    try {
      const { data } = await supabase
        .from('trips')
        .select('id, name, stops(id, city, order_index)')
        .order('created_at', { ascending: false });

      if (data) {
        const mapped: TripWithStops[] = (data as any[]).map((t) => ({
          id: t.id,
          name: t.name,
          stops: ((t.stops ?? []) as any[])
            .slice()
            .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0)),
        }));
        setTrips(mapped);
        setTripsLoaded(true);
      }
    } catch (err: any) {
      console.warn('[PlaceDetailSheet] trips fetch error:', err?.message);
    } finally {
      setLoadingTrips(false);
    }
  }

  // ── Edit ────────────────────────────────────────────────────────────────────

  async function handleSaveEdit() {
    if (!place) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter a place name.');
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePlace(place.id, {
        name: trimmedName,
        category: editCategory,
        note: editNote.trim() || null,
      });
      onUpdated(updated);
      setMode('detail');
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Move ────────────────────────────────────────────────────────────────────

  async function handleMoveToStop(stopId: string, tripId: string) {
    if (!place || moving) return;
    setMoving(true);
    try {
      await assignInboxItem(place.id, stopId, tripId);
      onMoved(place.id);
      onClose();
    } catch (err: any) {
      Alert.alert('Could not move place', err?.message ?? 'Please try again.');
      setMoving(false);
    }
  }

  async function handleMoveToInbox() {
    if (!place || moving) return;
    setMoving(true);
    try {
      await movePlaceToInbox(place.id);
      onMoved(place.id);
      onClose();
    } catch (err: any) {
      Alert.alert('Could not move to inbox', err?.message ?? 'Please try again.');
      setMoving(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  function handleDeletePress() {
    if (!place) return;
    Alert.alert(
      `Delete "${place.name}"?`,
      'This place will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDelete },
      ],
    );
  }

  async function confirmDelete() {
    if (!place) return;
    try {
      await deletePlace(place.id);
      onDeleted(place.id);
      onClose();
    } catch (err: any) {
      Alert.alert('Could not delete place', err?.message ?? 'Please try again.');
    }
  }

  if (!visible || !place) return null;

  const cfg = cfgFor(place.category);
  const hasMap = place.latitude != null && place.longitude != null;
  const hasSourceImage = !!place.source_image_url && !sourceImageError;

  return (
    <Modal
      transparent
      visible
      animationType="slide"
      onRequestClose={mode === 'detail' ? onClose : () => setMode('detail')}
    >
      <TouchableWithoutFeedback onPress={mode === 'detail' ? onClose : undefined}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavWrapper}
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          {/* ── DETAIL MODE ─────────────────────────────────────────── */}
          {mode === 'detail' && (
            <>
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.detailContent}
                showsVerticalScrollIndicator={false}
              >
                {/* Source image thumbnail */}
                {hasSourceImage && (
                  <View style={styles.sourceImageWrap}>
                    <Image
                      source={{ uri: place.source_image_url! }}
                      style={styles.sourceImage}
                      resizeMode="cover"
                      onError={() => setSourceImageError(true)}
                    />
                  </View>
                )}

                {/* Icon + name + badge */}
                <View style={styles.detailHeader}>
                  <View style={[styles.detailIconCircle, { backgroundColor: cfg.iconBg }]}>
                    <Feather name={cfg.icon} size={22} color={cfg.iconColor} />
                  </View>
                  <View style={styles.detailHeaderText}>
                    <Text style={styles.placeName}>{place.name}</Text>
                    {!!place.category && (
                      <View style={[styles.categoryBadge, { backgroundColor: cfg.badgeBg, alignSelf: 'flex-start' }]}>
                        <Text style={[styles.categoryBadgeText, { color: cfg.badgeText }]}>
                          {place.category}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* City */}
                {!!place.city && (
                  <View style={styles.metaRow}>
                    <Feather name="map-pin" size={14} color={colors.textMuted} style={styles.metaIcon} />
                    <Text style={styles.metaText}>{place.city}</Text>
                  </View>
                )}

                {/* Address */}
                {!!place.address && (
                  <View style={styles.metaRow}>
                    <Feather name="navigation" size={14} color={colors.textMuted} style={styles.metaIcon} />
                    <Text style={styles.metaText}>{place.address}</Text>
                  </View>
                )}

                {/* Note */}
                {!!place.note && (
                  <View style={styles.noteCard}>
                    <Text style={styles.noteText}>{place.note}</Text>
                  </View>
                )}

                {/* Google Places photo */}
                {!!place.photo_url && (
                  <View style={styles.googlePhotoWrap}>
                    <Image
                      source={{ uri: place.photo_url }}
                      style={styles.googlePhoto}
                      resizeMode="cover"
                    />
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
              </ScrollView>

              {/* Fixed action buttons */}
              <View style={styles.detailActions}>
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => setMode('edit')}
                >
                  <Feather name="edit-2" size={15} color={colors.primary} style={styles.actionBtnIcon} />
                  <Text style={styles.actionBtnText}>Edit</Text>
                </Pressable>

                <View style={styles.actionSep} />

                <Pressable
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => setMode('move')}
                >
                  <Feather name="corner-up-right" size={15} color={colors.primary} style={styles.actionBtnIcon} />
                  <Text style={styles.actionBtnText}>Move to…</Text>
                </Pressable>

                <View style={styles.actionSep} />

                <Pressable
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                  onPress={handleDeletePress}
                >
                  <Feather name="trash-2" size={15} color={colors.error} style={styles.actionBtnIcon} />
                  <Text style={[styles.actionBtnText, { color: colors.error }]}>Delete</Text>
                </Pressable>
              </View>
            </>
          )}

          {/* ── EDIT MODE ───────────────────────────────────────────── */}
          {mode === 'edit' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.editContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Sub-header */}
              <View style={styles.subHeader}>
                <Pressable onPress={() => setMode('detail')} hitSlop={8} style={styles.backBtn}>
                  <Feather name="arrow-left" size={20} color={colors.text} />
                </Pressable>
                <Text style={styles.subHeaderTitle}>Edit place</Text>
                <View style={{ width: 28 }} />
              </View>

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
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Note</Text>
              <View style={[styles.inputCard, { marginBottom: 24 }]}>
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

              {/* Save / Cancel */}
              <View style={styles.btnRow}>
                <Pressable
                  style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => setMode('detail')}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.85 },
                    saving && { opacity: 0.6 },
                  ]}
                  onPress={handleSaveEdit}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={colors.white} />
                    : <Text style={styles.primaryBtnText}>Save</Text>
                  }
                </Pressable>
              </View>
            </ScrollView>
          )}

          {/* ── MOVE MODE ───────────────────────────────────────────── */}
          {mode === 'move' && (
            <>
              {/* Sub-header */}
              <View style={styles.subHeader}>
                <Pressable onPress={() => setMode('detail')} hitSlop={8} style={styles.backBtn}>
                  <Feather name="arrow-left" size={20} color={colors.text} />
                </Pressable>
                <Text style={styles.subHeaderTitle}>Move to…</Text>
                <View style={{ width: 28 }} />
              </View>

              {/* Move to Inbox */}
              {canMoveToInbox && (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.inboxOptionBtn, pressed && { opacity: 0.7 }]}
                    onPress={handleMoveToInbox}
                    disabled={moving}
                  >
                    <View style={styles.inboxOptionIcon}>
                      <Feather name="inbox" size={16} color={colors.primary} />
                    </View>
                    <Text style={styles.inboxOptionText}>Move to Inbox</Text>
                    {moving
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Feather name="chevron-right" size={16} color={colors.border} />
                    }
                  </Pressable>

                  <Text style={styles.orLabel}>— or assign to a stop —</Text>
                </>
              )}

              {/* Trips + stops */}
              {loadingTrips ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 24 }} />
              ) : trips.length === 0 ? (
                <Text style={styles.noTripsText}>No trips found.</Text>
              ) : (
                <ScrollView style={styles.moveScroll} showsVerticalScrollIndicator={false}>
                  {trips.map((trip) => (
                    <View key={trip.id}>
                      <Pressable
                        style={({ pressed }) => [styles.tripHeader, pressed && { opacity: 0.7 }]}
                        onPress={() =>
                          setExpandedTripId(expandedTripId === trip.id ? null : trip.id)
                        }
                      >
                        <View style={styles.tripHeaderLeft}>
                          <Feather name="briefcase" size={14} color={colors.primary} style={{ marginRight: 8 }} />
                          <Text style={styles.tripHeaderName}>{trip.name}</Text>
                        </View>
                        <Feather
                          name={expandedTripId === trip.id ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={colors.textMuted}
                        />
                      </Pressable>

                      {expandedTripId === trip.id && (
                        trip.stops.length === 0 ? (
                          <View style={styles.stopRowEmpty}>
                            <Text style={styles.stopRowEmptyText}>No stops in this trip</Text>
                          </View>
                        ) : (
                          trip.stops.map((stop) => (
                            <Pressable
                              key={stop.id}
                              style={({ pressed }) => [
                                styles.stopRow,
                                pressed && { backgroundColor: colors.background },
                              ]}
                              onPress={() => handleMoveToStop(stop.id, trip.id)}
                              disabled={moving}
                            >
                              <Feather name="map-pin" size={13} color={colors.textMuted} style={{ marginRight: 10 }} />
                              <Text style={styles.stopRowCity}>{stop.city}</Text>
                              {moving
                                ? <ActivityIndicator size="small" color={colors.primary} />
                                : <Feather name="chevron-right" size={14} color={colors.border} />
                              }
                            </Pressable>
                          ))
                        )
                      )}
                    </View>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  kavWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    maxHeight: '92%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },

  // ── Shared scroll area ───────────────────────────────────────────────────

  scrollArea: {
    flexGrow: 0,
    maxHeight: '70%',
  },

  // ── Detail mode ──────────────────────────────────────────────────────────

  detailContent: {
    paddingBottom: 8,
  },

  sourceImageWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 16,
    height: 180,
    backgroundColor: colors.background,
  },
  sourceImage: {
    width: '100%',
    height: '100%',
  },

  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 14,
  },
  detailIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  detailHeaderText: {
    flex: 1,
    gap: 6,
  },
  placeName: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: colors.text,
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  categoryBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  metaIcon: {
    marginTop: 1,
  },
  metaText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },

  noteCard: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
  },

  googlePhotoWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    height: 160,
    backgroundColor: colors.background,
  },
  googlePhoto: {
    width: '100%',
    height: '100%',
  },

  mapWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    height: 160,
    marginBottom: 4,
  },
  map: {
    flex: 1,
  },

  // ── Detail action buttons ────────────────────────────────────────────────

  detailActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 12,
    paddingTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  actionBtnIcon: {
    marginRight: 5,
  },
  actionBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.primary,
  },
  actionSep: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },

  // ── Edit mode ────────────────────────────────────────────────────────────

  editContent: {
    paddingBottom: 8,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {
    width: 28,
  },
  subHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.displayBold,
    fontSize: 18,
    color: colors.text,
    letterSpacing: -0.2,
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
    marginBottom: 16,
  },
  textInput: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    padding: 0,
  },
  noteInput: {
    minHeight: 72,
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
  catChipTextSelected: {
    color: colors.white,
  },

  btnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.textMuted,
  },
  primaryBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.white,
  },

  // ── Move mode ────────────────────────────────────────────────────────────

  inboxOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  inboxOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EBF3F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxOptionText: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.primary,
  },

  orLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 12,
  },

  moveScroll: {
    maxHeight: 320,
  },

  tripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tripHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  tripHeaderName: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },

  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingLeft: 30,
    paddingRight: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stopRowCity: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
  },
  stopRowEmpty: {
    paddingVertical: 10,
    paddingLeft: 30,
  },
  stopRowEmptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },

  noTripsText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginVertical: 24,
  },
});
