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

  // Hide splash once fonts are ready (or errored)
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

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

  // Redirect based on auth state once everything is ready
  useEffect(() => {
    if (session === undefined || !fontsLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (session && inAuthGroup) {
      router.replace('/(main)/');
    } else if (!session && !inAuthGroup) {
      router.replace('/(auth)/');
    }
  }, [session, fontsLoaded, segments]);

  // Don't render anything until fonts and session are resolved
  if (!fontsLoaded && !fontError) return null;
  if (session === undefined) return null;

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
