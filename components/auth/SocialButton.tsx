import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from 'react-native';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

type Provider = 'apple' | 'google';

interface SocialButtonProps extends PressableProps {
  provider: Provider;
  loading?: boolean;
}

const config: Record<Provider, { label: string; bgColor: string; textColor: string; borderColor?: string }> = {
  apple: {
    label: 'Continue with Apple',
    bgColor: colors.black,
    textColor: colors.white,
  },
  google: {
    label: 'Continue with Google',
    bgColor: colors.surface,
    textColor: colors.text,
    borderColor: colors.border,
  },
};

export function SocialButton({ provider, loading = false, disabled, ...rest }: SocialButtonProps) {
  const { label, bgColor, textColor, borderColor } = config[provider];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bgColor, borderColor: borderColor ?? 'transparent', borderWidth: borderColor ? 1.5 : 0 },
        pressed && { opacity: 0.8 },
        isDisabled && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text style={[styles.label, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    letterSpacing: 0.2,
  },
});
