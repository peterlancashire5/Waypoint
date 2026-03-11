import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { SocialButton } from '@/components/auth/SocialButton';
import { Divider } from '@/components/ui/Divider';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';

type Mode = 'signin' | 'signup';

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithEmail, signUpWithEmail, signInWithApple, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  const anyLoading = loadingEmail || loadingApple || loadingGoogle;

  async function handleEmailAuth() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoadingEmail(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handleApple() {
    setLoadingApple(true);
    try {
      await signInWithApple();
    } catch (err: any) {
      // Silently ignore user-cancelled Apple sign-in
      if (err?.code !== '1001') {
        Alert.alert('Error', err?.message ?? 'Apple sign-in failed.');
      }
    } finally {
      setLoadingApple(false);
    }
  }

  async function handleGoogle() {
    setLoadingGoogle(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Google sign-in failed.');
    } finally {
      setLoadingGoogle(false);
    }
  }

  function toggleMode() {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setPassword('');
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back / header */}
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backLabel}>← Back</Text>
          </Pressable>

          {/* Heading */}
          <View style={styles.header}>
            <Text style={styles.heading}>
              {mode === 'signin' ? 'Welcome\nback' : 'Create\naccount'}
            </Text>
            <Text style={styles.subheading}>
              {mode === 'signin'
                ? 'Sign in to continue your journey'
                : 'Start organising your travels'}
            </Text>
          </View>

          {/* Social sign-in */}
          <View style={styles.socialGroup}>
            {Platform.OS === 'ios' && (
              <SocialButton
                provider="apple"
                loading={loadingApple}
                disabled={anyLoading}
                onPress={handleApple}
              />
            )}
            <SocialButton
              provider="google"
              loading={loadingGoogle}
              disabled={anyLoading}
              onPress={handleGoogle}
            />
          </View>

          <Divider label="or continue with email" />

          {/* Email / password form */}
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!anyLoading}
              />
            </View>

            <View style={styles.field}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>Password</Text>
                {mode === 'signin' && (
                  <Pressable hitSlop={8}>
                    <Text style={styles.forgotLabel}>Forgot password?</Text>
                  </Pressable>
                )}
              </View>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={mode === 'signin' ? '••••••••' : 'At least 8 characters'}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  editable={!anyLoading}
                />
                <Pressable
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={8}
                >
                  <Text style={styles.eyeLabel}>{showPassword ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>
            </View>

            <Button
              label={mode === 'signin' ? 'Sign In' : 'Create Account'}
              variant="primary"
              loading={loadingEmail}
              disabled={anyLoading}
              onPress={handleEmailAuth}
            />
          </View>

          {/* Toggle mode */}
          <View style={styles.toggleRow}>
            <Text style={styles.togglePrompt}>
              {mode === 'signin' ? 'New to Waypoint?' : 'Already have an account?'}
            </Text>
            <Pressable onPress={toggleMode} hitSlop={8}>
              <Text style={styles.toggleAction}>
                {mode === 'signin' ? ' Create account' : ' Sign in'}
              </Text>
            </Pressable>
          </View>

          {/* Legal */}
          <Text style={styles.legal}>
            By continuing you agree to our{' '}
            <Text style={styles.legalLink}>Terms of Service</Text> and{' '}
            <Text style={styles.legalLink}>Privacy Policy</Text>.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  backButton: {
    paddingTop: 12,
    paddingBottom: 8,
    alignSelf: 'flex-start',
  },
  backLabel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
  },
  header: {
    marginTop: 20,
    marginBottom: 36,
  },
  heading: {
    fontFamily: fonts.displayBold,
    fontSize: 44,
    lineHeight: 52,
    color: colors.text,
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  subheading: {
    fontFamily: fonts.displayItalic,
    fontSize: 17,
    color: colors.textMuted,
  },
  socialGroup: {
    gap: 12,
    marginBottom: 24,
  },
  form: {
    gap: 20,
    marginTop: 24,
    marginBottom: 28,
  },
  field: {
    gap: 8,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
  },
  forgotLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.primary,
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 64,
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  eyeLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.primary,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  togglePrompt: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
  },
  toggleAction: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.primary,
  },
  legal: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  legalLink: {
    color: colors.primary,
  },
});
