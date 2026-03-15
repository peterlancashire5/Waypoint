import { useState } from 'react';
import { Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { Feather } from '@expo/vector-icons';
import { InboxCountContext } from '@/lib/inboxCount';

// ─── Badged inbox icon ────────────────────────────────────────────────────────

function BadgedInboxIcon({
  color,
  size,
  count,
}: {
  color: string;
  size: number;
  count: number;
}) {
  return (
    <View style={{ width: size + 10, height: size + 4, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="inbox" size={size} color={color} />
      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: 0,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: '#E53935',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.bodyBold,
              fontSize: 10,
              color: '#fff',
              lineHeight: 14,
            }}
          >
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function MainLayout() {
  const [inboxCount, setInboxCount] = useState(0);

  return (
    <InboxCountContext.Provider value={{ inboxCount, setInboxCount }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.white,
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
            title: 'Map',
            tabBarIcon: ({ color, size }) => (
              <Feather name="map" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="trips"
          options={{
            title: 'Trips',
            tabBarIcon: ({ color, size }) => (
              <Feather name="briefcase" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            title: 'Inbox',
            tabBarIcon: ({ color, size }) => (
              <BadgedInboxIcon color={color} size={size} count={inboxCount} />
            ),
          }}
        />
        <Tabs.Screen name="stop" options={{ href: null }} />
        <Tabs.Screen name="leg" options={{ href: null }} />
      </Tabs>
    </InboxCountContext.Provider>
  );
}
