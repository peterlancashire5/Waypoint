// components/ui/OfflineBanner.tsx
//
// Thin full-width banner displayed below the system status bar when offline.
// Rendered from the root layout via NetworkProvider — zero per-screen changes needed.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { fonts } from '@/constants/typography';

const BANNER_HEIGHT = 32;

interface OfflineBannerProps {
  visible: boolean;
}

export default function OfflineBanner({ visible }: OfflineBannerProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-BANNER_HEIGHT)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : -BANNER_HEIGHT,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <Animated.View
      style={[
        styles.banner,
        { top: insets.top, transform: [{ translateY }] },
      ]}
      pointerEvents="none"
    >
      <Feather name="wifi-off" size={13} color="#fff" />
      <Text style={styles.text}>No internet connection</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BANNER_HEIGHT,
    backgroundColor: '#6B6460', // intentionally outside the standard palette — neutral muted tone for system-level status
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    zIndex: 9998,
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: '#fff',
    letterSpacing: 0.2,
  },
});
