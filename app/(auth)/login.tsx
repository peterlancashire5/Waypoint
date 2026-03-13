import React, { useRef, useState } from 'react';
import {
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

// ─── Error mapping ────────────────────────────────────────────────────────────

function mapAuthError(err: any): string {
  const msg: string = err?.message ?? '';
  if (msg.includes('Invalid login credentials'))
    return 'Incorrect email or password. Please try again.';
  if (msg.includes('Email not confirmed'))
    return 'Please verify your email address before signing in.';
  if (msg.includes('User already registered'))
    return 'An account with this email already exists. Try signing in instead.';
  if (msg.includes('Password should be at least') || msg.includes('password'))
    return 'Password must be at least 6 characters.';
  if (msg.includes('Unable to validate email address') || msg.includes('valid email'))
    return 'Please enter a valid email address.';
  if (msg.includes('rate limit') || msg.includes('too many requests'))
    return 'Too many attempts. Please wait a moment and try again.';
  return msg || 'Something went wrong. Please try again.';
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithEmail, signUpWithEmail, signInWithApple, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  const anyLoading = loadingEmail || loadingApple || loadingGoogle;

  function clearError() {
    if (errorMessage) setErrorMessage('');
  }

  async function handleEmailAuth() {
    setErrorMessage('');

    // ── Client-side validation ─────────────────────────────────────────
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please enter your email and password.');
      return;
    }
    if (mode === 'signup') {
      if (password.length < 8) {
        setErrorMessage('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage("Passwords don't match.");
        return;
      }
    }

    // ── API call ───────────────────────────────────────────────────────
    setLoadingEmail(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
        // On success the auth state change listener in _layout.tsx routes to /(main)/
      }
    } catch (err: any) {
      setErrorMessage(mapAuthError(err));
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handleApple() {
    setLoadingApple(true);
    try {
      await signInWithApple();
    } catch (err: any) {
      if (err?.code !== '1001') {
        setErrorMessage(mapAuthError(err));
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
      setErrorMessage(mapAuthError(err));
    } finally {
      setLoadingGoogle(false);
    }
  }

  function toggleMode() {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setPassword('');
    setConfirmPassword('');
    setErrorMessage('');
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
          {/* Back */}
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

          {/* Social */}
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

          {/* Form */}
          <View style={styles.form}>
            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(v) => { setEmail(v); clearError(); }}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!anyLoading}
              />
            </View>

            {/* Password */}
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
                  ref={passwordRef}
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={(v) => { setPassword(v); clearError(); }}
                  placeholder={mode === 'signin' ? '••••••••' : 'At least 8 characters'}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  returnKeyType={mode === 'signup' ? 'next' : 'done'}
                  onSubmitEditing={
                    mode === 'signup'
                      ? () => confirmPasswordRef.current?.focus()
                      : handleEmailAuth
                  }
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

            {/* Confirm password — signup only */}
            {mode === 'signup' && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Confirm password</Text>
                <View style={styles.passwordContainer}>
                  <TextInput
                    ref={confirmPasswordRef}
                    style={[styles.input, styles.passwordInput]}
                    value={confirmPassword}
                    onChangeText={(v) => { setConfirmPassword(v); clearError(); }}
                    placeholder="Re-enter your password"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showPassword}
                    autoComplete="new-password"
                    returnKeyType="done"
                    onSubmitEditing={handleEmailAuth}
                    editable={!anyLoading}
                  />
                </View>
              </View>
            )}

            {/* Inline error */}
            {errorMessage ? (
              <Text style={styles.errorMessage}>{errorMessage}</Text>
            ) : null}

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

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  errorMessage: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.error,
    lineHeight: 20,
    marginTop: -4, // tighten the gap slightly so it reads as attached to the form
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
