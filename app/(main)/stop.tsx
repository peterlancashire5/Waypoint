import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_ACCOMMODATION = {
  name: 'Mandarin Oriental Bangkok',
  address: '48 Oriental Avenue, Bang Rak, Bangkok 10500',
  checkIn: '15:00',
  checkOut: '12:00',
  confirmationRef: 'MO-BKK-2024-88421',
  wifi: { name: 'MO_Guest_5G', password: 'Oriental2024' },
  doorCode: '4821#',
};

const MOCK_DAYS = [
  {
    date: 'Thu 14 Mar',
    events: [
      { time: '14:00', title: 'Check in — Mandarin Oriental', note: 'River-view room requested' },
      { time: '17:30', title: 'Sunset on the terrace', note: null },
      { time: '19:30', title: 'Dinner at Sala Rim Naam', note: 'Reservation confirmed' },
    ],
    floating: ["Visit the Author's Lounge for afternoon tea"],
  },
  {
    date: 'Fri 15 Mar',
    events: [
      { time: '09:00', title: 'Wat Pho — Reclining Buddha', note: 'Arrive early to beat crowds' },
      { time: '11:30', title: 'Talat Noi street art walk', note: null },
      { time: '13:00', title: 'Lunch at Or Tor Kor Market', note: null },
      { time: '16:00', title: 'Chao Phraya river boat', note: null },
    ],
    floating: ['Pick up Thai silk from Jim Thompson House'],
  },
  {
    date: 'Sat 16 Mar',
    events: [
      { time: '08:30', title: 'Grand Palace & Wat Phra Kaew', note: 'Dress code: covered shoulders & knees' },
      { time: '14:00', title: 'Chatuchak Weekend Market', note: 'Section 26 for antiques' },
      { time: '20:00', title: 'Rooftop bar — Lebua Sky Bar', note: null },
    ],
    floating: ['Try mango sticky rice from the cart outside hotel'],
  },
  {
    date: 'Sun 17 Mar',
    events: [
      { time: '09:00', title: 'Morning walk along the river', note: null },
      { time: '12:00', title: 'Check out', note: null },
      { time: '14:30', title: 'Transfer to Hua Lamphong — train to Chiang Mai', note: 'Booking ref: TH-4821' },
    ],
    floating: [],
  },
];

const MOCK_SAVED = [
  { id: '1', name: 'Nahm Restaurant', category: 'Restaurant', color: '#D4956E' },
  { id: '2', name: 'Wat Arun', category: 'Temple', color: '#2C5F6E' },
  { id: '3', name: 'MOCA Bangkok', category: 'Museum', color: '#7A8C6E' },
  { id: '4', name: 'Sretsis Parlour', category: 'Café', color: '#C0A882' },
  { id: '5', name: 'Asiatique Night Market', category: 'Market', color: '#8C6E7A' },
  { id: '6', name: 'Pak Khlong Talat', category: 'Market', color: '#6E7A8C' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SegmentTabs({ active, onChange }: { active: string; onChange: (t: string) => void }) {
  const tabs = ['Logistics', 'Days', 'Saved'];
  return (
    <View style={styles.segmentWrapper}>
      <View style={styles.segmentTrack}>
        {tabs.map((tab) => (
          <Pressable
            key={tab}
            style={[styles.segmentTab, active === tab && styles.segmentTabActive]}
            onPress={() => onChange(tab)}
          >
            <Text style={[styles.segmentLabel, active === tab && styles.segmentLabelActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon as any} size={15} color={colors.textMuted} style={styles.infoIcon} />
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function LogisticsTab() {
  const acc = MOCK_ACCOMMODATION;
  return (
    <ScrollView style={styles.flex1} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionHeading}>Accommodation</Text>
      <Card>
        <Text style={styles.cardTitle}>{acc.name}</Text>
        <Text style={styles.cardAddress}>{acc.address}</Text>
        <View style={styles.divider} />
        <InfoRow icon="log-in" label="Check-in" value={acc.checkIn} />
        <InfoRow icon="log-out" label="Check-out" value={acc.checkOut} />
        <InfoRow icon="hash" label="Confirmation" value={acc.confirmationRef} />
        <View style={styles.divider} />
        <InfoRow icon="wifi" label="Wi-Fi network" value={acc.wifi.name} />
        <InfoRow icon="lock" label="Wi-Fi password" value={acc.wifi.password} />
        <InfoRow icon="key" label="Door code" value={acc.doorCode} />
        <View style={styles.divider} />
        <Pressable style={styles.confirmationButton}>
          <Feather name="file-text" size={15} color={colors.primary} />
          <Text style={styles.confirmationButtonLabel}>View confirmation</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

function DaysTab() {
  return (
    <ScrollView style={styles.flex1} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      {MOCK_DAYS.map((day) => (
        <View key={day.date} style={styles.dayBlock}>
          <Text style={styles.dayHeader}>{day.date}</Text>
          <View style={styles.timeline}>
            {day.events.map((event, i) => (
              <View key={i} style={styles.timelineRow}>
                <View style={styles.timelineLeft}>
                  <Text style={styles.timelineTime}>{event.time}</Text>
                  <View style={styles.timelineDotCol}>
                    <View style={styles.timelineDot} />
                    {i < day.events.length - 1 || day.floating.length > 0 ? (
                      <View style={styles.timelineLine} />
                    ) : null}
                  </View>
                </View>
                <View style={styles.timelineBody}>
                  <Text style={styles.timelineTitle}>{event.title}</Text>
                  {event.note && <Text style={styles.timelineNote}>{event.note}</Text>}
                </View>
              </View>
            ))}
            {day.floating.map((item, i) => (
              <View key={`f${i}`} style={styles.floatingRow}>
                <View style={styles.floatingDotCol}>
                  <View style={styles.floatingDot} />
                </View>
                <View style={styles.floatingBody}>
                  <Text style={styles.floatingTag}>While I'm here</Text>
                  <Text style={styles.floatingTitle}>{item}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function SavedTab() {
  const col1 = MOCK_SAVED.filter((_, i) => i % 2 === 0);
  const col2 = MOCK_SAVED.filter((_, i) => i % 2 === 1);
  return (
    <ScrollView style={styles.flex1} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <View style={styles.savedGrid}>
        <View style={styles.savedCol}>
          {col1.map((place) => (
            <SavedCard key={place.id} place={place} />
          ))}
        </View>
        <View style={styles.savedCol}>
          {col2.map((place) => (
            <SavedCard key={place.id} place={place} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function SavedCard({ place }: { place: typeof MOCK_SAVED[0] }) {
  return (
    <View style={styles.savedCard}>
      <View style={[styles.savedImagePlaceholder, { backgroundColor: place.color }]} />
      <View style={styles.savedCardBody}>
        <Text style={styles.savedCardName}>{place.name}</Text>
        <View style={styles.savedCategoryTag}>
          <Text style={styles.savedCategoryLabel}>{place.category}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function StopScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ city: string; country: string; dateRange: string }>();
  const [activeTab, setActiveTab] = useState('Logistics');

  const city = params.city ?? 'Bangkok';
  const country = params.country ?? 'Thailand';
  const dateRange = params.dateRange ?? '14–17 Mar';

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerCity}>{city}</Text>
            <Text style={styles.headerMeta}>{country} · {dateRange}</Text>
          </View>
          <Pressable style={styles.headerAction} hitSlop={8}>
            <Feather name="more-horizontal" size={22} color={colors.text} />
          </Pressable>
        </View>

        {/* Segment tabs */}
        <SegmentTabs active={activeTab} onChange={setActiveTab} />
      </SafeAreaView>

      {/* Tab content */}
      {activeTab === 'Logistics' && <LogisticsTab />}
      {activeTab === 'Days' && <DaysTab />}
      {activeTab === 'Saved' && <SavedTab />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  headerText: { flex: 1, alignItems: 'center' },
  headerCity: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text, letterSpacing: -0.2 },
  headerMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 1 },
  headerAction: { width: 36, alignItems: 'flex-end' },

  // Segment tabs
  segmentWrapper: { paddingHorizontal: 16, paddingBottom: 12 },
  segmentTrack: {
    flexDirection: 'row', backgroundColor: colors.background,
    borderRadius: 10, padding: 3,
  },
  segmentTab: {
    flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8,
  },
  segmentTabActive: {
    backgroundColor: colors.white,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  segmentLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.textMuted },
  segmentLabelActive: { color: colors.primary },

  // Shared tab layout
  tabContent: { padding: 16, paddingBottom: 40 },

  // Cards
  card: {
    backgroundColor: colors.white, borderRadius: 16,
    padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.text, marginBottom: 4 },
  cardAddress: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  sectionHeading: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 10,
  },

  // Info rows
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  infoIcon: { marginTop: 1, marginRight: 10, width: 16 },
  infoContent: { flex: 1 },
  infoLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginBottom: 1 },
  infoValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },

  // Confirmation button
  confirmationButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.primary, borderRadius: 10,
  },
  confirmationButtonLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },

  // Timeline (Days tab)
  dayBlock: { marginBottom: 28 },
  dayHeader: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 12,
  },
  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', marginBottom: 4 },
  timelineLeft: { width: 72, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  timelineTime: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.textMuted, paddingTop: 2, width: 38 },
  timelineDotCol: { alignItems: 'center', paddingTop: 6 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  timelineLine: { width: 1.5, flex: 1, backgroundColor: colors.border, minHeight: 24, marginTop: 2 },
  timelineBody: { flex: 1, paddingBottom: 16 },
  timelineTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text, lineHeight: 20 },
  timelineNote: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 2 },

  // Floating "while I'm here"
  floatingRow: { flexDirection: 'row', marginBottom: 8 },
  floatingDotCol: { width: 72, alignItems: 'flex-end', paddingRight: 8, paddingTop: 6 },
  floatingDot: {
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.white,
  },
  floatingBody: {
    flex: 1,
    backgroundColor: '#FDF6F1', borderRadius: 10, borderWidth: 1,
    borderColor: '#EDCFBA', paddingHorizontal: 12, paddingVertical: 8,
  },
  floatingTag: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.accent, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 },
  floatingTitle: { fontFamily: fonts.body, fontSize: 13, color: colors.text },

  // Saved grid
  savedGrid: { flexDirection: 'row', gap: 12 },
  savedCol: { flex: 1, gap: 12 },
  savedCard: {
    backgroundColor: colors.white, borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  savedImagePlaceholder: { width: '100%', aspectRatio: 1.1 },
  savedCardBody: { padding: 10 },
  savedCardName: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text, marginBottom: 6 },
  savedCategoryTag: {
    alignSelf: 'flex-start', backgroundColor: colors.background,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  savedCategoryLabel: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 },
});
