import React, { useRef, useState } from 'react';
import {
  Alert,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import QuickCaptureFAB from '@/components/QuickCaptureFAB';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxItem {
  id: string;
  placeName: string;
  category: string;
  note: string;
  daysAgo: number;
  color: string;
}

interface Trip {
  id: string;
  name: string;
  dateRange: string;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_ITEMS: InboxItem[] = [
  {
    id: 'i1',
    placeName: 'Sushi Saito',
    category: 'Restaurant',
    note: 'Apparently the best omakase in Tokyo — book 3 months ahead. Counter seats only.',
    daysAgo: 2,
    color: '#D4956E',
  },
  {
    id: 'i2',
    placeName: 'Bar Hemingway',
    category: 'Bar',
    note: 'Classic cocktail bar inside the Ritz Paris. Famous for the Bloody Mary.',
    daysAgo: 4,
    color: '#2C5F6E',
  },
  {
    id: 'i3',
    placeName: "Musée d'Orsay",
    category: 'Museum',
    note: 'The impressionist collection is incredible. Go on a weekday morning to avoid crowds.',
    daysAgo: 5,
    color: '#8B7355',
  },
  {
    id: 'i4',
    placeName: 'Naschmarkt',
    category: 'Market',
    note: "Vienna's famous open-air market. Saturday is best for the flea market section.",
    daysAgo: 7,
    color: '#5A8A6E',
  },
  {
    id: 'i5',
    placeName: 'Elephant Bar',
    category: 'Bar',
    note: 'Rooftop bar with panoramic views over the old town. Perfect for sunset drinks.',
    daysAgo: 11,
    color: '#9B6E8A',
  },
];

const MOCK_TRIPS: Trip[] = [
  { id: 't1', name: 'Southeast Asia', dateRange: '14 Mar – 8 Apr' },
  { id: 't2', name: 'Japan Winter', dateRange: '10 Jan – 22 Jan' },
  { id: 't3', name: 'Portugal Road Trip', dateRange: '3 Sep – 12 Sep 2025' },
];

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  Restaurant: { bg: '#FBF0E9', text: '#C07A4F' },
  Bar:        { bg: '#E9EFF8', text: '#3A5F8A' },
  Museum:     { bg: '#F2EDE7', text: '#7A6045' },
  Market:     { bg: '#EAF2EC', text: '#3A7A55' },
  Café:       { bg: '#FBF0E9', text: '#C07A4F' },
};

function categoryStyle(category: string) {
  return CATEGORY_COLORS[category] ?? { bg: colors.background, text: colors.textMuted };
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <Feather name="inbox" size={32} color={colors.textMuted} />
      </View>
      <Text style={styles.emptyHeading}>All caught up</Text>
      <Text style={styles.emptySubtitle}>
        Saved places will appear here when we can't match them to a trip
      </Text>
    </View>
  );
}

// ─── Inbox card ───────────────────────────────────────────────────────────────

function InboxCard({
  item,
  onFile,
}: {
  item: InboxItem;
  onFile: (item: InboxItem) => void;
}) {
  const cat = categoryStyle(item.category);
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={[styles.imagePlaceholder, { backgroundColor: item.color }]} />
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <Text style={styles.placeName} numberOfLines={1}>{item.placeName}</Text>
            <Text style={styles.timestamp}>
              {item.daysAgo === 1 ? '1 day ago' : `${item.daysAgo} days ago`}
            </Text>
          </View>
          <View style={[styles.categoryTag, { backgroundColor: cat.bg }]}>
            <Text style={[styles.categoryText, { color: cat.text }]}>{item.category}</Text>
          </View>
          <Text style={styles.note} numberOfLines={2}>{item.note}</Text>
        </View>
      </View>
      <Pressable
        style={({ pressed }) => [styles.fileButton, pressed && styles.fileButtonPressed]}
        onPress={() => onFile(item)}
      >
        <Feather name="folder-plus" size={14} color={colors.primary} />
        <Text style={styles.fileButtonText}>File to trip</Text>
      </Pressable>
    </View>
  );
}

// ─── File bottom sheet ────────────────────────────────────────────────────────

function FileSheet({
  visible,
  item,
  onClose,
  onSelect,
}: {
  visible: boolean;
  item: InboxItem | null;
  onClose: () => void;
  onSelect: (trip: Trip) => void;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 60,
      friction: 12,
    }).start();
  }, [visible]);

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.sheetOverlay} />
      </TouchableWithoutFeedback>
      <Animated.View style={[styles.sheet, { transform: [{ translateY }], paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>File to trip</Text>
        {item && (
          <Text style={styles.sheetSubtitle}>
            Where should <Text style={styles.sheetSubtitleBold}>{item.placeName}</Text> go?
          </Text>
        )}
        <View style={styles.sheetDivider} />
        {MOCK_TRIPS.map((trip) => (
          <TouchableOpacity
            key={trip.id}
            style={styles.tripRow}
            activeOpacity={0.7}
            onPress={() => onSelect(trip)}
          >
            <View style={styles.tripRowLeft}>
              <Text style={styles.tripRowName}>{trip.name}</Text>
              <Text style={styles.tripRowDate}>{trip.dateRange}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.border} />
          </TouchableOpacity>
        ))}
      </Animated.View>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const SHOW_EMPTY = false;

export default function InboxScreen() {
  const [items, setItems] = useState<InboxItem[]>(SHOW_EMPTY ? [] : MOCK_ITEMS);
  const [sheetItem, setSheetItem] = useState<InboxItem | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  // ── File-to-trip ─────────────────────────────────────────────────────────

  function openSheet(item: InboxItem) {
    setSheetItem(item);
    setSheetVisible(true);
  }

  function closeSheet() {
    setSheetVisible(false);
  }

  function handleSelect(_trip: Trip) {
    if (!sheetItem) return;
    setItems((prev) => prev.filter((i) => i.id !== sheetItem.id));
    setSheetVisible(false);
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Inbox</Text>
            <Text style={styles.headerSubtitle}>Items waiting to be filed</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Content */}
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.countLabel}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </Text>
          {items.map((item) => (
            <InboxCard key={item.id} item={item} onFile={openSheet} />
          ))}
        </ScrollView>
      )}

      <FileSheet
        visible={sheetVisible}
        item={sheetItem}
        onClose={closeSheet}
        onSelect={handleSelect}
      />

      <QuickCaptureFAB />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  flex1: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerLeft: { flex: 1 },
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
  scrollContent: { padding: 16, paddingBottom: 40 },

  countLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // Card
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  imagePlaceholder: { width: 64, height: 64, borderRadius: 10, flexShrink: 0 },
  cardBody: { flex: 1, gap: 5 },
  cardTopRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', gap: 8,
  },
  placeName: {
    fontFamily: fonts.displayBold, fontSize: 16, color: colors.text,
    letterSpacing: -0.1, flex: 1,
  },
  timestamp: {
    fontFamily: fonts.body, fontSize: 11, color: colors.textMuted,
    flexShrink: 0, marginTop: 1,
  },
  categoryTag: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  categoryText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, lineHeight: 18 },

  // File button
  fileButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.background,
  },
  fileButtonPressed: { opacity: 0.7 },
  fileButtonText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.primary },

  // Empty state
  emptyWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, paddingBottom: 60,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyHeading: {
    fontFamily: fonts.displayBold, fontSize: 22, color: colors.text,
    letterSpacing: -0.2, marginBottom: 8, textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.body, fontSize: 14, color: colors.textMuted,
    textAlign: 'center', lineHeight: 20,
  },

  // Bottom sheet (file-to-trip)
  sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  sheetTitle: {
    fontFamily: fonts.displayBold, fontSize: 20, color: colors.text,
    letterSpacing: -0.2, marginBottom: 4,
  },
  sheetSubtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  sheetSubtitleBold: { fontFamily: fonts.bodyBold, color: colors.text },
  sheetDivider: { height: 1, backgroundColor: colors.border, marginBottom: 4 },
  tripRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tripRowLeft: { gap: 2 },
  tripRowName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  tripRowDate: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
});
