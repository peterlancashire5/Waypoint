import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CityResult {
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
}

interface Suggestion {
  placeId: string;
  city: string;
  country: string;
}

export interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (result: CityResult) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  autoFocus?: boolean;
  returnKeyType?: 'done' | 'next' | 'go' | 'search' | 'send';
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';
const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_BASE = 'https://places.googleapis.com/v1/places';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function extractCountry(secondaryText: string): string {
  const parts = secondaryText.split(',').map((p) => p.trim());
  return parts[parts.length - 1] ?? secondaryText;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CityAutocomplete({
  value,
  onChangeText,
  onSelect,
  placeholder = 'City',
  placeholderTextColor = colors.border,
  autoFocus = false,
  returnKeyType = 'done',
  style,
  containerStyle,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [containerHeight, setContainerHeight] = useState(0);

  const sessionTokenRef = useRef<string>(generateToken());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set to true in onPressIn so onBlur knows not to dismiss before onPress fires
  const selectingRef = useRef(false);

  const fetchSuggestions = useCallback(async (text: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
        },
        body: JSON.stringify({
          input: text.trim(),
          includedPrimaryTypes: ['locality'],
          sessionToken: sessionTokenRef.current,
        }),
        signal: controller.signal,
      });

      if (!res.ok || controller.signal.aborted) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      const json = await res.json();
      const raw: any[] = json?.suggestions ?? [];
      const parsed: Suggestion[] = raw
        .filter((s) => s?.placePrediction?.placeId)
        .map((s) => {
          const p = s.placePrediction;
          const mainText =
            p?.structuredFormat?.mainText?.text ?? p?.text?.text ?? '';
          const secondaryText =
            p?.structuredFormat?.secondaryText?.text ?? '';
          return {
            placeId: p.placeId as string,
            city: mainText as string,
            country: extractCountry(secondaryText),
          };
        });

      if (!controller.signal.aborted) {
        setSuggestions(parsed);
        setShowDropdown(parsed.length > 0);
        setLoading(false);
      }
    } catch {
      if (!abortRef.current?.signal.aborted) {
        setSuggestions([]);
        setShowDropdown(false);
        setLoading(false);
      }
    }
  }, []);

  function handleChangeText(text: string) {
    onChangeText(text);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!text.trim() || text.trim().length < 2) {
      abortRef.current?.abort();
      setSuggestions([]);
      setShowDropdown(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceTimer.current = setTimeout(() => fetchSuggestions(text), 300);
  }

  async function handleSelect(suggestion: Suggestion) {
    setShowDropdown(false);
    setSuggestions([]);
    onChangeText(suggestion.city);

    // Fetch lat/lng from Place Details (Essentials tier — location field only)
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const token = sessionTokenRef.current;
      sessionTokenRef.current = generateToken(); // new session after selection

      const url = `${DETAILS_BASE}/${suggestion.placeId}?sessionToken=${token}`;
      const res = await fetch(url, {
        headers: {
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'location',
        },
      });
      if (res.ok) {
        const json = await res.json();
        lat = json?.location?.latitude ?? null;
        lng = json?.location?.longitude ?? null;
      }
    } catch {
      // lat/lng remain null — acceptable, trip can still be created
    }

    onSelect({ city: suggestion.city, country: suggestion.country, lat, lng });
  }

  function handleDismiss() {
    setShowDropdown(false);
    setSuggestions([]);
  }

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
    };
  }, []);

  const dropdownVisible = showDropdown && containerHeight > 0;

  return (
    <View
      style={[styles.container, containerStyle]}
      onLayout={(e) => setContainerHeight(e.nativeEvent.layout.height)}
    >
      <TextInput
        style={style}
        value={value}
        onChangeText={handleChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        autoFocus={autoFocus}
        returnKeyType={returnKeyType}
        autoCorrect={false}
        autoCapitalize="words"
        onBlur={() => {
          // Delay so onPressIn on a suggestion can set selectingRef first
          if (!selectingRef.current) handleDismiss();
        }}
      />

      {dropdownVisible && (
        <View style={[styles.dropdown, { top: containerHeight }]}>
          {loading && suggestions.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            suggestions.map((s, i) => (
              <Pressable
                key={s.placeId}
                style={({ pressed }) => [
                  styles.suggestionRow,
                  i < suggestions.length - 1 && styles.suggestionDivider,
                  pressed && styles.suggestionPressed,
                ]}
                onPressIn={() => { selectingRef.current = true; }}
                onPress={() => {
                  selectingRef.current = false;
                  handleSelect(s);
                }}
                onPressOut={() => { selectingRef.current = false; }}
              >
                <Text style={styles.suggestionCity}>{s.city}</Text>
                <Text style={styles.suggestionCountry}>{s.country}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // overflow: 'visible' lets the absolutely positioned dropdown escape this
  // container without being clipped. Callers must also set overflow: 'visible'
  // on any ancestor Views that would otherwise clip it.
  container: {
    overflow: 'visible',
  },
  dropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 999,
    elevation: 999,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    overflow: 'hidden',
    maxHeight: 240,
  },
  loadingRow: {
    padding: 14,
    alignItems: 'center',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionPressed: {
    backgroundColor: colors.background,
  },
  suggestionCity: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  suggestionCountry: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 8,
  },
});
