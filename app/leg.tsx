import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_LEG = {
  from: 'Bangkok',
  to: 'Chiang Mai',
  type: 'flight' as const,
  date: '17 Mar',
  duration: '1h 20m',
  operator: 'Bangkok Airways',
  flightNumber: 'PG 207',
  departure: { time: '06:45', station: 'Suvarnabhumi Airport', code: 'BKK' },
  arrival: { time: '08:05', station: 'Chiang Mai International', code: 'CNX' },
  seat: '14A — Window',
  confirmationRef: 'BKAIR-882441',
  status: 'Confirmed' as const,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function TransportIcon({ type, size = 20, color = colors.primary }: {
  type: 'flight' | 'train' | 'bus' | 'ferry';
  size?: number;
  color?: string;
}) {
  const iconMap = {
    flight: 'airplane' as const,
    train: 'train' as const,
    bus: 'bus' as const,
    ferry: 'ferry' as const,
  };
  return <MaterialCommunityIcons name={iconMap[type]} size={size} color={color} />;
}

function InfoRow({ icon, label, value, mono = false }: {
  icon: string;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon as any} size={15} color={colors.textMuted} style={styles.infoIcon} />
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, mono && styles.infoValueMono]}>{value}</Text>
      </View>
    </View>
  );
}

function RouteTimeline({ leg }: { leg: typeof MOCK_LEG }) {
  return (
    <View style={styles.routeTimeline}>
      <View style={styles.routeEndpoint}>
        <Text style={styles.routeTime}>{leg.departure.time}</Text>
        <Text style={styles.routeCode}>{leg.departure.code}</Text>
        <Text style={styles.routeStation}>{leg.departure.station}</Text>
      </View>
      <View style={styles.routeMiddle}>
        <View style={styles.routeDot} />
        <View style={styles.routeLine} />
        <TransportIcon type={leg.type} size={18} color={colors.primary} />
        <View style={styles.routeLine} />
        <View style={styles.routeDot} />
        <Text style={styles.routeDuration}>{leg.duration}</Text>
      </View>
      <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
        <Text style={styles.routeTime}>{leg.arrival.time}</Text>
        <Text style={styles.routeCode}>{leg.arrival.code}</Text>
        <Text style={[styles.routeStation, styles.routeStationRight]}>{leg.arrival.station}</Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LegScreen() {
  const router = useRouter();
  const leg = MOCK_LEG;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Drag handle */}
      <View style={styles.handleBar}>
        <View style={styles.handle} />
      </View>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.transportBadge}>
              <TransportIcon type={leg.type} size={14} color={colors.primary} />
              <Text style={styles.transportLabel}>
                {leg.type.charAt(0).toUpperCase() + leg.type.slice(1)}
              </Text>
            </View>
            <View style={[styles.statusPill, styles.statusConfirmed]}>
              <View style={styles.statusDot} />
              <Text style={styles.statusLabel}>{leg.status}</Text>
            </View>
          </View>
          <Text style={styles.routeTitle}>{leg.from} → {leg.to}</Text>
          <Text style={styles.routeMeta}>{leg.date} · {leg.duration}</Text>
        </View>

        {/* Route timeline card */}
        <View style={styles.card}>
          <RouteTimeline leg={leg} />
        </View>

        {/* Booking details card */}
        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>Booking details</Text>
          <View style={styles.divider} />
          <InfoRow icon="tag" label="Operator" value={leg.operator} />
          <InfoRow icon="hash" label="Flight number" value={leg.flightNumber} />
          <InfoRow icon="user" label="Seat" value={leg.seat} />
          <InfoRow icon="file-text" label="Confirmation" value={leg.confirmationRef} mono />
        </View>

        {/* Barcode card */}
        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>Boarding pass</Text>
          <View style={styles.divider} />
          <View style={styles.barcodePlaceholder}>
            <View style={styles.barcodeStripes} />
            <Text style={styles.barcodeText}>Scan at gate · {leg.flightNumber}</Text>
          </View>
          <Pressable style={styles.walletButton}>
            <MaterialCommunityIcons name="wallet" size={18} color={colors.white} />
            <Text style={styles.walletButtonLabel}>Add to Apple Wallet</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Close button */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.closeButton} onPress={() => router.back()}>
          <Text style={styles.closeButtonLabel}>Close</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  flex1: { flex: 1 },

  // Handle
  handleBar: { paddingTop: 12, paddingBottom: 4, alignItems: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },

  scrollContent: { padding: 20, paddingBottom: 8 },

  // Header
  header: { marginBottom: 20 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  transportBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#EBF3F6', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  transportLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  statusConfirmed: { backgroundColor: '#EAF5EE' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  statusLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.success },
  routeTitle: {
    fontFamily: fonts.displayBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.3, marginBottom: 4,
  },
  routeMeta: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },

  // Cards
  card: {
    backgroundColor: colors.white, borderRadius: 16, marginBottom: 16,
    borderWidth: 1, borderColor: colors.border,
    padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  cardSectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase',
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },

  // Route timeline
  routeTimeline: { flexDirection: 'row', alignItems: 'flex-start' },
  routeEndpoint: { flex: 1 },
  routeEndpointRight: { alignItems: 'flex-end' },
  routeTime: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.text, letterSpacing: -0.3 },
  routeCode: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary, marginTop: 2 },
  routeStation: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginTop: 2, lineHeight: 15 },
  routeStationRight: { textAlign: 'right' },
  routeMiddle: {
    flex: 1, alignItems: 'center', gap: 4, paddingTop: 8, paddingHorizontal: 8,
  },
  routeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  routeLine: { flex: 1, width: 1, backgroundColor: colors.border, minHeight: 12 },
  routeDuration: {
    fontFamily: fonts.body, fontSize: 11, color: colors.textMuted,
    marginTop: 4, textAlign: 'center',
  },

  // Info rows
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  infoIcon: { marginTop: 1, marginRight: 10, width: 16 },
  infoContent: { flex: 1 },
  infoLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginBottom: 1 },
  infoValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  infoValueMono: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.5, color: colors.text },

  // Barcode
  barcodePlaceholder: {
    backgroundColor: colors.background, borderRadius: 12,
    height: 100, marginBottom: 14,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  barcodeStripes: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
  },
  barcodeText: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, zIndex: 1 },
  walletButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: colors.text, borderRadius: 12, paddingVertical: 13,
  },
  walletButtonLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },

  // Footer
  footer: { paddingHorizontal: 20, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  closeButton: {
    backgroundColor: colors.background, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  closeButtonLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
});
