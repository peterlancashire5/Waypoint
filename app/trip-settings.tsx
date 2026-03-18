import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/typography';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
}

interface Collaborator extends Profile {
  isOwner: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

// ─── CollaboratorRow ─────────────────────────────────────────────────────────

interface CollaboratorRowProps {
  collab: Collaborator;
  isCurrentUserOwner: boolean;
  onRemove: (collab: Collaborator) => void;
}

function CollaboratorRow({ collab, isCurrentUserOwner, onRemove }: CollaboratorRowProps) {
  const showRemove = isCurrentUserOwner && !collab.isOwner;

  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.avatar}>
        <Text style={rowStyles.avatarText}>{getInitials(collab.email)}</Text>
      </View>
      <View style={rowStyles.info}>
        <Text style={rowStyles.email} numberOfLines={1}>{collab.email}</Text>
        {collab.isOwner && (
          <View style={rowStyles.badge}>
            <Text style={rowStyles.badgeText}>Creator</Text>
          </View>
        )}
      </View>
      {showRemove && (
        <Pressable
          style={rowStyles.removeButton}
          onPress={() => onRemove(collab)}
          hitSlop={8}
        >
          <Feather name="trash-2" size={16} color={colors.error} />
        </Pressable>
      )}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12, flexShrink: 0,
  },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#FFFFFF' },
  info: { flex: 1, gap: 3 },
  email: { fontFamily: fonts.body, fontSize: 14, color: colors.text },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EBF3F6', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: {
    fontFamily: fonts.bodyBold, fontSize: 10,
    color: colors.primary, letterSpacing: 0.5, textTransform: 'uppercase',
  },
  removeButton: { padding: 4 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripSettingsScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trip name
  const [tripName, setTripName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [nameSaving, setNameSaving] = useState(false);

  // Collaborators
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tripId) { setError('No trip specified.'); setLoading(false); return; }

    setLoading(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    setCurrentUserId(userId);

    // Fetch trip
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, name, owner_id')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      setError('Could not load trip settings.');
      setLoading(false);
      return;
    }

    setTripName(trip.name);
    setSavedName(trip.name);
    setOwnerId(trip.owner_id);

    // Fetch trip_members
    const { data: members } = await supabase
      .from('trip_members')
      .select('user_id')
      .eq('trip_id', tripId);

    // Collect all user IDs (owner + members) and fetch their profiles
    const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    const allUserIds = [trip.owner_id, ...memberIds];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', allUserIds);

    const profileMap = new Map<string, Profile>(
      (profiles ?? []).map((p: Profile) => [p.id, p])
    );

    const collabs: Collaborator[] = allUserIds.map((uid) => ({
      id: uid,
      email: profileMap.get(uid)?.email ?? uid, // fallback to id if profile missing
      display_name: profileMap.get(uid)?.display_name ?? null,
      isOwner: uid === trip.owner_id,
    }));

    setCollaborators(collabs);
    setLoading(false);
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  // ── Name save (on blur) ────────────────────────────────────────────────────

  async function handleNameBlur() {
    const trimmed = tripName.trim();
    if (!trimmed || trimmed === savedName) return;
    setNameSaving(true);
    const { error: updateError } = await supabase
      .from('trips')
      .update({ name: trimmed })
      .eq('id', tripId);
    if (updateError) {
      setTripName(savedName); // revert on failure
      Alert.alert('Error', 'Could not save trip name. Please try again.');
    } else {
      setSavedName(trimmed);
    }
    setNameSaving(false);
  }

  // ── Remove collaborator ─────────────────────────────────────────────────────

  function handleRemoveCollaborator(collab: Collaborator) {
    Alert.alert(
      'Remove collaborator',
      `Remove ${collab.email}? They'll lose access to this trip.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error: removeError } = await supabase
              .from('trip_members')
              .delete()
              .eq('trip_id', tripId)
              .eq('user_id', collab.id);
            if (removeError) {
              Alert.alert('Error', 'Could not remove collaborator. Please try again.');
              return;
            }
            // Refresh collaborator list
            setCollaborators((prev) => prev.filter((c) => c.id !== collab.id));
          },
        },
      ]
    );
  }

  // ── Leave trip (non-owner only) ────────────────────────────────────────────

  function handleLeaveTrip() {
    Alert.alert(
      'Leave this trip?',
      "You'll lose access to this trip and its itinerary.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            if (!currentUserId) return;
            const { error: leaveError } = await supabase
              .from('trip_members')
              .delete()
              .eq('trip_id', tripId)
              .eq('user_id', currentUserId);
            if (leaveError) {
              Alert.alert('Error', 'Could not leave trip. Please try again.');
              return;
            }
            router.replace('/(main)/trips');
          },
        },
      ]
    );
  }

  // ── Delete trip (owner only) ───────────────────────────────────────────────

  function handleDeleteTrip() {
    Alert.alert(
      'Delete this trip?',
      'This will permanently delete the trip for all collaborators.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error: deleteError } = await supabase
              .from('trips')
              .delete()
              .eq('id', tripId);
            if (deleteError) {
              Alert.alert('Error', 'Could not delete trip. Please try again.');
              return;
            }
            router.replace('/(main)/trips');
          },
        },
      ]
    );
  }

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => router.back()} style={styles.retryButton}>
          <Text style={styles.retryText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isOwner = currentUserId === ownerId;
  const memberCount = collaborators.length;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.navRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.navTitle}>Trip Settings</Text>
          <View style={styles.navSpacer} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Trip name section ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TRIP NAME</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.nameInput}
              value={tripName}
              onChangeText={setTripName}
              onBlur={handleNameBlur}
              placeholder="Trip name"
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
              blurOnSubmit
            />
            {nameSaving && (
              <ActivityIndicator size="small" color={colors.primary} style={styles.nameSaving} />
            )}
          </View>
        </View>

        {/* ── Collaborators section ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            COLLABORATORS ({memberCount})
          </Text>
          {collaborators.map((collab) => (
            <CollaboratorRow
              key={collab.id}
              collab={collab}
              isCurrentUserOwner={isOwner}
              onRemove={handleRemoveCollaborator}
            />
          ))}
          {/* TODO: Phase 3 — wire up invite link generation */}
          <Pressable
            style={[styles.inviteButton, styles.inviteButtonDisabled]}
            disabled
          >
            <Feather name="user-plus" size={16} color={colors.textMuted} />
            <Text style={styles.inviteButtonTextDisabled}>Invite someone</Text>
          </Pressable>
        </View>
        {/* ── Danger zone ── */}
        <View style={styles.dangerSection}>
          {isOwner ? (
            <Pressable style={styles.dangerButton} onPress={handleDeleteTrip}>
              <Feather name="trash-2" size={16} color={colors.error} />
              <Text style={styles.dangerButtonText}>Delete trip</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.dangerButton} onPress={handleLeaveTrip}>
              <Feather name="log-out" size={16} color={colors.error} />
              <Text style={styles.dangerButtonText}>Leave trip</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  safeTop: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  navRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backButton: { width: 36, alignItems: 'flex-start' },
  navTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
  navSpacer: { flex: 1 },

  scrollContent: { padding: 20, paddingBottom: 60 },

  section: {
    backgroundColor: colors.white, borderRadius: 16,
    padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 10,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  nameInput: {
    flex: 1,
    fontFamily: fonts.body, fontSize: 16, color: colors.text,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  nameSaving: { marginLeft: 8 },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  retryButton: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.primary },

  inviteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 12,
    paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: colors.primary,
  },
  inviteButtonDisabled: { borderColor: colors.border },
  inviteButtonTextDisabled: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.textMuted },

  dangerSection: { marginTop: 8 },
  dangerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: colors.error,
  },
  dangerButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.error },
});
