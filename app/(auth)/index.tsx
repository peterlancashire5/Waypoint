import React, { useEffect } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/colors';
import { fonts, textStyles } from '@/constants/typography';

const ONBOARDING_KEY = 'waypoint_onboarding_complete';

export default function SplashScreen() {
  const router = useRouter();

  async function handleGetStarted() {
    const seen = await SecureStore.getItemAsync(ONBOARDING_KEY);
    if (seen) {
      router.push('/(auth)/login');
    } else {
      router.push('/(auth)/onboarding');
    }
  }

  function handleSignIn() {
    router.push('/(auth)/login');
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Logo mark */}
      <View style={styles.logoMark}>
        <Text style={styles.logoSymbol}>◈</Text>
      </View>

      {/* Wordmark + tagline */}
      <View style={styles.wordmarkContainer}>
        <Text style={styles.wordmark}>Waypoint</Text>
        <Text style={styles.tagline}>Your journey, beautifully organised</Text>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          onPress={handleGetStarted}
        >
          <Text style={styles.primaryButtonLabel}>Get Started</Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={handleSignIn}>
          <Text style={styles.secondaryButtonLabel}>I already have an account</Text>
        </Pressable>
      </View>

      {/* Subtle footer decoration */}
      <View style={styles.footer}>
        <View style={styles.footerDot} />
        <View style={[styles.footerDot, styles.footerDotActive]} />
        <View style={styles.footerDot} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    // Soft shadow
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  logoSymbol: {
    fontSize: 32,
    color: colors.white,
  },
  wordmarkContainer: {
    alignItems: 'center',
    marginBottom: 64,
  },
  wordmark: {
    fontFamily: fonts.displayBold,
    fontSize: 52,
    color: colors.text,
    letterSpacing: -1,
    marginBottom: 12,
  },
  tagline: {
    fontFamily: fonts.displayItalic,
    fontSize: 18,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  actions: {
    width: '100%',
    gap: 14,
  },
  primaryButton: {
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
  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
  },
  primaryButtonLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    color: colors.white,
    letterSpacing: 0.2,
  },
  secondaryButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonLabel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
  },
  footer: {
    position: 'absolute',
    bottom: 48,
    flexDirection: 'row',
    gap: 6,
  },
  footerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  footerDotActive: {
    backgroundColor: colors.accent,
    width: 20,
    borderRadius: 3,
  },
});
