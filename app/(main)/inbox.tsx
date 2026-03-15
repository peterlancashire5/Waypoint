import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import {
  fetchInboxItems,
  type SavedPlace,
} from '@/lib/savedPlaceUtils';
import { useInboxCount } from '@/lib/inboxCount';
import type { PlaceCategory } from '@/lib/placesEnrichment';
import QuickCaptureFAB from '@/components/QuickCaptureFAB';
import PlaceDetailSheet from '@/components/PlaceDetailSheet';

// ─── Category config ──────────────────────────────────────────────────────────

type CategoryConfig = {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
};

const CATEGORY_CONFIG: Record<PlaceCategory, CategoryConfig> = {
  Restaurants: { icon: 'coffee',       iconBg: '#FBF0E8', iconColor: '#C07A4F', badgeBg: '#FBF0E8', badgeText: '#9A5C35' },
  Bars:        { icon: 'sunset',       iconBg: '#EDECF8', iconColor: '#5B5EA6', badgeBg: '#EDECF8', badgeText: '#3F4280' },
  Museums:     { icon: 'book-open',    iconBg: '#E8F2F5', iconColor: '#2C5F6E', badgeBg: '#E8F2F5', badgeText: '#2C5F6E' },
  Activities:  { icon: 'compass',      iconBg: '#E6F3EC', iconColor: '#2E7D5A', badgeBg: '#E6F3EC', badgeText: '#1E5C3F' },
  Sights:      { icon: 'camera',       iconBg: '#F8F0E0', iconColor: '#B07D2A', badgeBg: '#F8F0E0', badgeText: '#8A5F18' },
  Shopping:    { icon: 'shopping-bag', iconBg: '#F5EBF3', iconColor: '#8B4F7A', badgeBg: '#F5EBF3', badgeText: '#6A3A5B' },
  Other:       { icon: 'map-pin',      iconBg: '#EEECE9', iconColor: '#7A7570', badgeBg: '#EEECE9', badgeText: '#5A5550' },
};

const FALLBACK_CFG: CategoryConfig = CATEGORY_CONFIG.Other;

function cfgFor(category: PlaceCategory | null | undefined): CategoryConfig {
  return category ? (CATEGORY_CONFIG[category] ?? FALLBACK_CFG) : FALLBACK_CFG;
}

// ─── Inbox row ────────────────────────────────────────────────────────────────

function InboxRow({
  place,
  onPress,
}: {
  place: SavedPlace;
  onPress: () => void;
}) {
  const cfg = cfgFor(place.category);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={[styles.rowIcon, { backgroundColor: cfg.iconBg }]}>
        <Feather name={cfg.icon} size={18} color={cfg.iconColor} />
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>{place.name}</Text>
        {!!place.city && (
          <Text style={styles.rowCity} numberOfLines={1}>{place.city}</Text>
        )}
      </View>

      {!!place.category && (
        <View style={[styles.categoryBadge, { backgroundColor: cfg.badgeBg }]}>
          <Text style={[styles.categoryBadgeText, { color: cfg.badgeText }]}>
            {place.category}
          </Text>
        </View>
      )}

      <Feather name="chevron-right" size={16} color={colors.border} style={{ marginLeft: 6 }} />
    </Pressable>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconCircle}>
        <Feather name="inbox" size={28} color={colors.textMuted} />
      </View>
      <Text style={styles.emptyHeading}>Inbox is empty</Text>
      <Text style={styles.emptySubtitle}>
        Places that can't be matched to a stop will appear here
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InboxScreen() {
  const { setInboxCount } = useInboxCount();

  const [items, setItems] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail sheet state
  const [selectedPlace, setSelectedPlace] = useState<SavedPlace | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  // ── Load inbox items ────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    setLoading(true);
    try {
      const places = await fetchInboxItems(session.user.id);
      setItems(places);
      setInboxCount(places.length);
    } catch (err: any) {
      console.warn('[inbox] fetch error:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [setInboxCount]);

  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems]),
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Inbox</Text>
          {!loading && items.length > 0 && (
            <Text style={styles.headerSubtitle}>
              {items.length}{' '}
              {items.length === 1 ? 'place' : 'places'} waiting to be assigned
            </Text>
          )}
          {!loading && items.length === 0 && (
            <Text style={styles.headerSubtitle}>All caught up</Text>
          )}
        </View>
      </SafeAreaView>

      {/* Content */}
      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.countLabel}>
            {items.length} {items.length === 1 ? 'place' : 'places'}
          </Text>
          {items.map((place) => (
            <InboxRow
              key={place.id}
              place={place}
              onPress={() => { setSelectedPlace(place); setDetailVisible(true); }}
            />
          ))}
        </ScrollView>
      )}

      {/* Place detail sheet */}
      <PlaceDetailSheet
        visible={detailVisible}
        place={selectedPlace}
        canMoveToInbox={false}
        onClose={() => setDetailVisible(false)}
        onUpdated={(updated) => {
          setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          setDetailVisible(false);
        }}
        onDeleted={(placeId) => {
          const next = items.filter((p) => p.id !== placeId);
          setItems(next);
          setInboxCount(next.length);
          setDetailVisible(false);
        }}
        onMoved={(placeId) => {
          const next = items.filter((p) => p.id !== placeId);
          setItems(next);
          setInboxCount(next.length);
          setDetailVisible(false);
        }}
      />

      <QuickCaptureFAB />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  safeTop: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.text,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },

  listContent: { padding: 16, paddingBottom: 100 },

  countLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // ── Inbox row ───────────────────────────────────────────────────────────────

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  rowPressed: { opacity: 0.85 },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowBody: { flex: 1 },
  rowName: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 2,
  },
  rowCity: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },
  categoryBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  categoryBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  // ── Empty state ─────────────────────────────────────────────────────────────

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyHeading: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: colors.text,
    letterSpacing: -0.2,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

});
