import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark';

interface ButtonProps extends PressableProps {
  label: string;
  variant?: Variant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  labelStyle,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles[`${variant}Pressed` as keyof typeof styles],
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' || variant === 'ghost' ? colors.primary : colors.white}
          size="small"
        />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label` as keyof typeof styles], labelStyle]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  // Primary — teal fill
  primary: {
    backgroundColor: colors.primary,
  },
  primaryPressed: {
    backgroundColor: colors.primaryDark,
  },
  primaryLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.white,
    letterSpacing: 0.2,
  },
  // Secondary — outlined
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  secondaryPressed: {
    backgroundColor: '#F0EDE8',
  },
  secondaryLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.2,
  },
  // Ghost — no border, text only
  ghost: {
    backgroundColor: 'transparent',
  },
  ghostPressed: {
    backgroundColor: '#F0EDE8',
  },
  ghostLabel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
  },
  // Dark — black fill (for Apple sign-in style)
  dark: {
    backgroundColor: colors.black,
  },
  darkPressed: {
    backgroundColor: '#333333',
  },
  darkLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.white,
    letterSpacing: 0.2,
  },
  // States
  disabled: {
    opacity: 0.45,
  },
  label: {}, // base label (overridden per variant above)
});
