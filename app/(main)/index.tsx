import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { useAuth } from '@/hooks/useAuth';

export default function TripsScreen() {
  const { signOut } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.greeting}>Good morning</Text>
        <Text style={styles.title}>Your Trips</Text>
      </View>

      <View style={styles.empty}>
        <View style={styles.emptyIconContainer}>
          <Text style={styles.emptyIcon}>✦</Text>
        </View>
        <Text style={styles.emptyHeading}>No trips yet</Text>
        <Text style={styles.emptyBody}>
          Your upcoming adventures will appear here. Start by creating your first trip.
        </Text>
        <Pressable style={({ pressed }) => [styles.createButton, pressed && styles.createButtonPressed]}>
          <Text style={styles.createButtonLabel}>+ New Trip</Text>
        </Pressable>
      </View>

      {/* Temporary sign-out for development */}
      <Pressable style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutLabel}>Sign Out</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  greeting: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 34,
    color: colors.text,
    letterSpacing: -0.3,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyIcon: {
    fontSize: 36,
    color: colors.primary,
  },
  emptyHeading: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textMuted,
    textAlign: 'center',
  },
  createButton: {
    marginTop: 8,
    height: 52,
    paddingHorizontal: 32,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonPressed: {
    backgroundColor: colors.primaryDark,
  },
  createButtonLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.white,
    letterSpacing: 0.2,
  },
  signOutButton: {
    margin: 24,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
  },
});
