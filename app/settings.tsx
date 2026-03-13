import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      // _layout.tsx auth guard detects session → null and redirects to /(auth)/
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Account</Text>
          <View style={styles.headerSpacer} />
        </View>
      </SafeAreaView>

      <View style={styles.body}>
        {/* Email row */}
        <View style={styles.card}>
          <View style={styles.emailRow}>
            <View style={styles.emailIconWrap}>
              <Feather name="user" size={16} color={colors.primary} />
            </View>
            <View style={styles.emailBody}>
              <Text style={styles.emailLabel}>Signed in as</Text>
              <Text style={styles.emailValue} numberOfLines={1}>
                {email ?? '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* Sign out */}
        <Pressable
          style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <>
              <Feather name="log-out" size={16} color={colors.error} />
              <Text style={styles.signOutLabel}>Sign out</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  safeTop: {
    backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  headerTitle: {
    flex: 1, textAlign: 'center',
    fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text,
  },
  headerSpacer: { width: 36 },

  body: { padding: 16, gap: 12 },

  card: {
    backgroundColor: colors.white, borderRadius: 14,
    padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emailIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#EBF3F6', alignItems: 'center', justifyContent: 'center',
  },
  emailBody: { flex: 1 },
  emailLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  emailValue: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },

  signOutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.white, borderRadius: 14,
    paddingVertical: 15,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  signOutButtonPressed: { opacity: 0.75 },
  signOutLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.error },
});
