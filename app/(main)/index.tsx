import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeInDown,
  FadeInUp,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

const MOCK_TRIP = {
  name: 'Southeast Asia',
  dateRange: '14 Mar – 8 Apr',
  stops: [
    { id: 's1', city: 'Bangkok',      country: 'Thailand', lat: 13.7563, lng: 100.5018, nights: 3 },
    { id: 's2', city: 'Chiang Mai',   country: 'Thailand', lat: 18.7883, lng: 98.9853,  nights: 4 },
    { id: 's3', city: 'Luang Prabang',country: 'Laos',     lat: 19.8845, lng: 102.1347, nights: 3 },
    { id: 's4', city: 'Hanoi',        country: 'Vietnam',  lat: 21.0285, lng: 105.8542, nights: 4 },
    { id: 's5', city: 'Hội An',       country: 'Vietnam',  lat: 15.8801, lng: 108.3380, nights: 5 },
  ],
};

const MAP_REGION = {
  latitude: 16.5,
  longitude: 102.5,
  latitudeDelta: 12,
  longitudeDelta: 12,
};

function MapPin({ stop, index, isSelected, onPress }: {
  stop: typeof MOCK_TRIP.stops[0];
  index: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function handlePress() {
    scale.value = withSpring(1.3, { damping: 6, stiffness: 300 }, () => {
      scale.value = withSpring(1, { damping: 8, stiffness: 200 });
    });
    onPress();
  }

  return (
    <Marker
      coordinate={{ latitude: stop.lat, longitude: stop.lng }}
      onPress={handlePress}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
    >
      <Animated.View style={[styles.pinWrapper, animStyle]}>
        <View style={[styles.pin, isSelected && styles.pinSelected]}>
          <Text style={[styles.pinNumber, isSelected && styles.pinNumberSelected]}>
            {index + 1}
          </Text>
        </View>
        <View style={[styles.pinTail, isSelected && styles.pinTailSelected]} />
        {isSelected && (
          <View style={styles.pinLabel}>
            <Text style={styles.pinLabelText}>{stop.city}</Text>
          </View>
        )}
      </Animated.View>
    </Marker>
  );
}

function CityChip({ stop, index, isSelected, onPress }: {
  stop: typeof MOCK_TRIP.stops[0];
  index: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.chip, isSelected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipNumber, isSelected && styles.chipNumberSelected]}>{index + 1}</Text>
      <Text style={[styles.chipCity, isSelected && styles.chipCitySelected]}>{stop.city}</Text>
      <Text style={[styles.chipNights, isSelected && styles.chipNightsSelected]}>{stop.nights}n</Text>
    </Pressable>
  );
}

function FAB({ onPress }: { onPress: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.fab, animStyle]} entering={FadeInUp.delay(400).springify()}>
      <Pressable
        style={styles.fabInner}
        onPressIn={() => { scale.value = withSpring(0.93, { damping: 10, stiffness: 400 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 8, stiffness: 300 }); onPress(); }}
        hitSlop={8}
      >
        <Feather name="camera" size={22} color={colors.white} />
      </Pressable>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);
  const router = useRouter();
  const polylineCoords = MOCK_TRIP.stops.map((s) => ({ latitude: s.lat, longitude: s.lng }));

  function handleStopSelect(stop: typeof MOCK_TRIP.stops[0]) {
    const isAlreadySelected = selectedStopId === stop.id;
    setSelectedStopId(isAlreadySelected ? null : stop.id);
    if (!isAlreadySelected) {
      mapRef.current?.animateToRegion(
        { latitude: stop.lat - 0.5, longitude: stop.lng, latitudeDelta: 4, longitudeDelta: 4 },
        400,
      );
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        initialRegion={MAP_REGION}
        showsUserLocation={false}
        showsCompass={false}
        pitchEnabled={false}
      >
        <Polyline
          coordinates={polylineCoords}
          strokeColor={colors.primary}
          strokeWidth={2.5}
          lineDashPattern={[8, 6]}
          tappable
          onPress={() => router.push('/leg')}
        />
        {MOCK_TRIP.stops.map((stop, index) => (
          <MapPin
            key={stop.id}
            stop={stop}
            index={index}
            isSelected={selectedStopId === stop.id}
            onPress={() => handleStopSelect(stop)}
          />
        ))}
      </MapView>

      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <Animated.View style={styles.topBar} entering={FadeInDown.delay(100).springify()} pointerEvents="none">
          <View style={styles.topBarPill}>
            <Text style={styles.topBarLabel}>UPCOMING</Text>
            <Text style={styles.topBarTitle}>{MOCK_TRIP.name}</Text>
            <Text style={styles.topBarDates}>{MOCK_TRIP.dateRange}</Text>
          </View>
        </Animated.View>
      </SafeAreaView>

      <Animated.View style={styles.bottomSheet} entering={FadeInUp.delay(200).springify()}>
        <View style={styles.bottomHandle} />
        <Text style={styles.bottomLabel}>
          {MOCK_TRIP.stops.length} stops · {MOCK_TRIP.stops.reduce((a, s) => a + s.nights, 0)} nights
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          {MOCK_TRIP.stops.map((stop, index) => (
            <CityChip
              key={stop.id}
              stop={stop}
              index={index}
              isSelected={selectedStopId === stop.id}
              onPress={() => handleStopSelect(stop)}
            />
          ))}
        </ScrollView>
        <Pressable
          style={styles.viewTripButton}
          onPress={() => {
            const first = MOCK_TRIP.stops[0];
            router.push({ pathname: '/(main)/stop', params: { city: first.city, country: first.country, dateRange: '14–17 Mar' } });
          }}
        >
          <Text style={styles.viewTripLabel}>View trip details</Text>
          <Feather name="arrow-right" size={15} color={colors.primary} />
        </Pressable>
      </Animated.View>

      <View style={styles.fabContainer} pointerEvents="box-none">
        <FAB onPress={() => console.log('Quick capture')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: { paddingHorizontal: 20, paddingTop: 12 },
  topBarPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  topBarLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.2, color: colors.accent, marginBottom: 2 },
  topBarTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text, letterSpacing: -0.2 },
  topBarDates: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 2 },
  pinWrapper: { alignItems: 'center' },
  pin: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.white, borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  pinSelected: { backgroundColor: colors.primary },
  pinNumber: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary },
  pinNumberSelected: { color: colors.white },
  pinTail: { width: 2, height: 6, backgroundColor: colors.primary, borderRadius: 1, marginTop: -1 },
  pinTailSelected: { backgroundColor: colors.primary },
  pinLabel: { marginTop: 4, backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pinLabelText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.white },
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 12,
  },
  bottomHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 },
  bottomLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, letterSpacing: 0.3, paddingHorizontal: 20, marginBottom: 12 },
  chipsScroll: { paddingHorizontal: 16, gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.background, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipNumber: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted },
  chipNumberSelected: { color: 'rgba(255,255,255,0.7)' },
  chipCity: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  chipCitySelected: { color: colors.white },
  chipNights: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  chipNightsSelected: { color: 'rgba(255,255,255,0.65)' },
  viewTripButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 16, paddingTop: 14, marginHorizontal: 20,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  viewTripLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },
  fabContainer: { position: 'absolute', right: 20, bottom: 200 },
  fab: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent,
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  fabInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
