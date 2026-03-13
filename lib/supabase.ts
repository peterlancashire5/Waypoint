import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// Replace these with your real Supabase project
// values once the project is created.
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://bvrgvzxerdefiklgtclw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2cmd2enhlcmRlZmlrbGd0Y2x3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDAwODksImV4cCI6MjA4ODkxNjA4OX0.Ykkv8pXQfaYyEou0xnV0-inJ8pvMLMpNioLvj55t8cU';

// SecureStore adapter so Supabase tokens are stored
// in the device's encrypted keychain, not AsyncStorage.
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
