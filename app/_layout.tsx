import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_700Bold_Italic,
} from '@expo-google-fonts/playfair-display';
import {
  Lato_300Light,
  Lato_400Regular,
  Lato_700Bold,
} from '@expo-google-fonts/lato';
import { type Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// Keep the system splash screen visible until fonts + auth are ready.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // undefined = unknown, null = not logged in, Session = logged in
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const router = useRouter();
  const segments = useSegments();

  const [fontsLoaded, fontError] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    Lato_300Light,
    Lato_400Regular,
    Lato_700Bold,
  });

  // Hide splash once fonts and session are both resolved
  useEffect(() => {
    if ((fontsLoaded || fontError) && session !== undefined) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, session]);

  // Subscribe to auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Auth routing guard — use segments[0] (string) not segments (array) to
  // avoid a new array reference on every render triggering this repeatedly.
  const segment = segments[0];
  useEffect(() => {
    if ((!fontsLoaded && !fontError) || session === undefined) return;

    const inAuthGroup = segment === '(auth)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/');
    } else if (session && inAuthGroup) {
      router.replace('/(main)/');
    }
  }, [fontsLoaded, fontError, session, segment]);

  // Don't render anything until fonts and session are resolved
  if ((!fontsLoaded && !fontError) || session === undefined) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="leg" options={{ presentation: 'modal', headerShown: false }} />
      <Stack.Screen name="create-trip" options={{ presentation: 'modal', headerShown: false }} />
      <Stack.Screen name="stop-detail" options={{ headerShown: false }} />
      <Stack.Screen name="trip-detail" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
    </Stack>
  );
}
