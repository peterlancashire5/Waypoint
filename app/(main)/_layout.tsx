import { Tabs } from 'expo-router';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

export default function MainLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 20,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.body,
          fontSize: 11,
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color }) => (
            // Placeholder — swap for an icon library component when added
            <TabIcon label="✦" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

// Minimal text-based tab icon placeholder
function TabIcon({ label, color }: { label: string; color: string }) {
  return (
    <>{/* eslint-disable-next-line react-native/no-inline-styles */}
      <TabIconText label={label} color={color} />
    </>
  );
}

import { Text } from 'react-native';
function TabIconText({ label, color }: { label: string; color: string }) {
  return (
    <Text style={{ fontSize: 20, color, lineHeight: 24 }}>{label}</Text>
  );
}
