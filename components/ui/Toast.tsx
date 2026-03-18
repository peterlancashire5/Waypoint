// components/ui/Toast.tsx
//
// Generalised animated toast. Used for offline status messages (position: 'top')
// and the QuickCaptureFAB undo toast (position: 'bottom').

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastProps {
  message: string;
  position: 'top' | 'bottom';
  duration?: number;
  action?: ToastAction;
  /** Extra top offset (e.g. 40 when OfflineBanner is visible). Only used when position='top'. */
  topOffset?: number;
  onDismiss: () => void;
}

export default function Toast({
  message,
  position,
  duration = 3000,
  action,
  topOffset = 0,
  onDismiss,
}: ToastProps) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();

    timerRef.current = setTimeout(() => {
      dismiss();
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function dismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() =>
      onDismiss()
    );
  }

  function handleAction() {
    dismiss();
    action?.onPress();
  }

  const positionStyle =
    position === 'top'
      ? { top: insets.top + 8 + topOffset }
      : { bottom: 104 };

  return (
    <Animated.View style={[styles.toast, positionStyle, { opacity }]}>
      <Text style={styles.message} numberOfLines={2}>
        {message}
      </Text>
      {action && (
        <Pressable onPress={handleAction} hitSlop={8}>
          <Text style={styles.actionLabel}>{action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.text,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 9999,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.white,
    flex: 1,
  },
  actionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.accent,
    marginLeft: 12,
  },
});
