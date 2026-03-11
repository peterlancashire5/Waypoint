import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

const ONBOARDING_KEY = 'waypoint_onboarding_complete';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Slide {
  id: string;
  symbol: string;
  heading: string;
  subheading: string;
  body: string;
  accentColor: string;
}

const slides: Slide[] = [
  {
    id: '1',
    symbol: '✦',
    heading: 'Plan every\ndetail',
    subheading: 'Trips that come together',
    body: 'Organise stops, legs, events, and inspiration in one beautiful place. Everything for your journey, exactly where you need it.',
    accentColor: colors.primary,
  },
  {
    id: '2',
    symbol: '◎',
    heading: 'Travel\ntogether',
    subheading: 'Shared plans, individual privacy',
    body: 'Invite friends and family to your trip. Everyone sees the shared itinerary — but your personal bookings stay yours alone.',
    accentColor: colors.accent,
  },
  {
    id: '3',
    symbol: '◈',
    heading: 'Your details,\nprotected',
    subheading: 'Private by design',
    body: 'Tickets, accommodation, and travel documents are visible only to you. Not to the trip owner, not to other members — nobody.',
    accentColor: colors.primaryDark,
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]?.index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  async function handleNext() {
    if (activeIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      await finish();
    }
  }

  async function finish() {
    await SecureStore.setItemAsync(ONBOARDING_KEY, 'true');
    router.replace('/(auth)/login');
  }

  const isLast = activeIndex === slides.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Skip */}
      <View style={styles.topBar}>
        <Pressable onPress={finish} hitSlop={12}>
          <Text style={styles.skipLabel}>Skip</Text>
        </Pressable>
      </View>

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={slides}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item }) => <SlideItem slide={item} />}
      />

      {/* Bottom controls */}
      <View style={styles.bottom}>
        {/* Dot indicators */}
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === activeIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>

        {/* CTA */}
        <Pressable
          style={({ pressed }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
          ]}
          onPress={handleNext}
        >
          <Text style={styles.ctaLabel}>
            {isLast ? 'Get started' : 'Next'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function SlideItem({ slide }: { slide: Slide }) {
  return (
    <View style={styles.slide}>
      {/* Illustration area */}
      <View style={[styles.illustrationContainer, { backgroundColor: slide.accentColor + '12' }]}>
        <View style={[styles.symbolCircle, { backgroundColor: slide.accentColor }]}>
          <Text style={styles.symbol}>{slide.symbol}</Text>
        </View>
      </View>

      {/* Copy */}
      <View style={styles.copy}>
        <Text style={styles.subheading}>{slide.subheading}</Text>
        <Text style={styles.heading}>{slide.heading}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  skipLabel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
  },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    paddingHorizontal: 32,
  },
  illustrationContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    borderRadius: 24,
    marginTop: 8,
  },
  symbolCircle: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  symbol: {
    fontSize: 44,
    color: colors.white,
  },
  copy: {
    paddingBottom: 16,
  },
  subheading: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.accent,
    marginBottom: 12,
  },
  heading: {
    fontFamily: fonts.displayBold,
    fontSize: 40,
    lineHeight: 48,
    color: colors.text,
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 25,
    color: colors.textMuted,
  },
  bottom: {
    paddingHorizontal: 32,
    paddingBottom: 32,
    paddingTop: 16,
    gap: 24,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.primary,
  },
  ctaButton: {
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonPressed: {
    backgroundColor: colors.primaryDark,
  },
  ctaLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    color: colors.white,
    letterSpacing: 0.2,
  },
});
