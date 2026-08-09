import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { OfflineNotice } from '@/components/offline-state';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { PushToggleRow } from '@/components/push-controls';
import { Badge, InfoRow, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { clearBadge } from '@/lib/badge';
import { signOutAndClearOfflineAccess } from '@/lib/auth';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { clearPushForSignOut } from '@/lib/push';
import { useEvent } from '@/state/event';
import { GAME_STYLE_LABELS } from '@/state/types';

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    accountAccess,
    me,
    myTeam,
    myPlayingGroup,
    event,
    updateMyProfile,
    participantById,
  } = useEvent();
  const offline = useBrowserDefinitelyOffline();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.fullName);
  const [handicap, setHandicap] = useState(
    me.handicap === null ? '' : String(me.handicap),
  );

  const pickPhoto = async () => {
    if (offline) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Allow photo access in Settings to change your profile picture.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      // The local uri shows immediately; the upload swaps in the hosted url.
      updateMyProfile({ avatarUrl: result.assets[0].uri });
    }
  };

  const save = () => {
    if (offline) return;
    const parsed = handicap.trim() === '' ? null : Number(handicap);
    if (parsed !== null && Number.isNaN(parsed)) {
      Alert.alert('Check your handicap', 'Enter a number, for example 8.4.');
      return;
    }
    updateMyProfile({ fullName: name.trim() || me.fullName, handicap: parsed });
    setEditing(false);
  };

  const teammates = myTeam
    ? myTeam.memberIds
        .filter((id) => id !== me.id)
        .map((id) => participantById(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
    : [];

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingHorizontal: 20,
          paddingBottom: 130,
          gap: 20,
        }}
        showsVerticalScrollIndicator={false}>
        {offline ? (
          <OfflineNotice
            compact
            message="Your saved profile is available, but profile photos, name and handicap changes, notification settings, and sign out require a connection. Reconnect and try again."
          />
        ) : null}

        {/* Identity */}
        <View style={styles.identity}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            accessibilityState={{ disabled: offline }}
            accessibilityHint={
              offline ? 'Changing your profile photo requires a connection.' : undefined
            }
            disabled={offline}
            onPress={pickPhoto}
            style={[styles.avatarWrap, offline && styles.disabledControl]}>
            <ParticipantAvatar participant={me} size={96} />
            <View style={styles.avatarEdit}>
              <Text style={styles.avatarEditText}>EDIT</Text>
            </View>
          </Pressable>

          {editing ? (
            <TextInput
              value={name}
              onChangeText={setName}
              editable={!offline}
              style={styles.nameInput}
              placeholder="Your name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              selectionColor={colors.highlight}
            />
          ) : (
            <Text style={styles.name}>{me.fullName}</Text>
          )}

          {accountAccess?.profile?.isClubAdmin ? (
            <Badge label="CLUB ADMIN" />
          ) : me.isAdmin ? (
            <Badge label="EVENT ADMIN" />
          ) : (
            <Badge label="PARTICIPANT" />
          )}
        </View>

        {/* Handicap + event details */}
        <View style={styles.card}>
          {editing ? (
            <View style={styles.editRow}>
              <Text style={styles.editLabel}>HANDICAP</Text>
              <TextInput
                value={handicap}
                onChangeText={setHandicap}
                editable={!offline}
                style={styles.handicapInput}
                keyboardType="decimal-pad"
                placeholder="—"
                placeholderTextColor="rgba(255,255,255,0.35)"
                selectionColor={colors.highlight}
              />
            </View>
          ) : (
            <InfoRow
              label="HANDICAP"
              value={me.handicap === null ? '—' : String(me.handicap)}
            />
          )}
          <InfoRow label="EVENT" value={event.name} />
          <InfoRow label="FORMAT" value={GAME_STYLE_LABELS[event.gameStyle]} />
          <InfoRow label="TEAM" value={myTeam?.name ?? 'Unassigned'} />
          <InfoRow
            label={event.startFormat === 'shotgun' ? 'SHOTGUN START' : 'TEE TIME'}
            value={myPlayingGroup?.teeTime ?? '—'}
          />
          <InfoRow
            label="STARTING HOLE"
            value={
              myPlayingGroup?.startingHole
                ? String(myPlayingGroup.startingHole)
                : '—'
            }
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: offline }}
          accessibilityHint={
            offline ? 'Editing your profile requires a connection.' : undefined
          }
          disabled={offline}
          style={[styles.editButton, offline && styles.disabledControl]}
          onPress={editing ? save : () => setEditing(true)}>
          <Text style={styles.editButtonText}>
            {editing ? 'SAVE CHANGES' : 'EDIT PROFILE'}
          </Text>
        </Pressable>

        {accountAccess?.profile?.isClubAdmin ? (
          <View style={styles.clubAdminSection}>
            <SectionLabel color={colors.link} size={10}>
              club admin
            </SectionLabel>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Club Admin"
              accessibilityHint="Manage club events, members, and event announcements."
              style={({ pressed }) => [
                styles.clubAdminButton,
                pressed && styles.clubAdminButtonPressed,
              ]}
              onPress={() => router.push('/admin-events')}>
              <View style={styles.clubAdminCopy}>
                <Text style={styles.clubAdminTitle}>MANAGE CLUB</Text>
                <Text style={styles.clubAdminSubtitle}>
                  Events, members, and event announcements
                </Text>
              </View>
              <Text style={styles.clubAdminArrow}>›</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Teammates */}
        {teammates.length > 0 ? (
          <View style={{ gap: 10 }}>
            <SectionLabel color={colors.link} size={10}>
              teammates
            </SectionLabel>
            <View>
              {teammates.map((mate, i) => {
                return (
                  <Pressable
                    key={mate.id}
                    disabled={!mate.claimed}
                    onPress={() =>
                      mate.claimed
                        ? router.push({
                            pathname: '/direct-message',
                            params: { participant: mate.id },
                          })
                        : undefined
                    }
                    style={[
                      styles.mateRow,
                      i < teammates.length - 1 && styles.mateRowBorder,
                    ]}>
                    <ParticipantAvatar participant={mate} size={36} />
                    <Text style={styles.mateName}>{mate.fullName}</Text>
                    <Text style={styles.mateHcp}>
                      {mate.handicap === null ? '—' : `${mate.handicap} HCP`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <PushToggleRow disabled={offline} />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: offline }}
          accessibilityHint={
            offline ? 'Reconnect before signing out of this device.' : undefined
          }
          disabled={offline}
          style={[styles.signOut, offline && styles.disabledControl]}
          onPress={async () => {
            // Drop this device's push registration first, so the next person to
            // sign in on this phone doesn't inherit the last one's alerts — or
            // their unread count sitting on the icon.
            await clearPushForSignOut();
            await clearBadge();
            await signOutAndClearOfflineAccess();
            router.replace('/');
          }}>
          <Text style={styles.signOutText}>SIGN OUT</Text>
        </Pressable>
      </ScrollView>
      <FloatingNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b2a22',
  },
  identity: {
    alignItems: 'center',
    gap: 12,
  },
  avatarWrap: {
    alignItems: 'center',
  },
  disabledControl: {
    opacity: 0.42,
  },
  avatarEdit: {
    marginTop: -12,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  avatarEditText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.highlight,
  },
  name: {
    fontFamily: fonts.serif,
    fontSize: 34,
    color: '#ffffff',
    textAlign: 'center',
  },
  nameInput: {
    fontFamily: fonts.serif,
    fontSize: 34,
    color: '#ffffff',
    textAlign: 'center',
    alignSelf: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(123,255,178,0.4)',
    paddingBottom: 4,
  },
  card: {
    backgroundColor: 'rgba(15,17,16,0.4)',
    paddingHorizontal: 16,
  },
  editRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textMuted,
  },
  handicapInput: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
    textAlign: 'right',
    minWidth: 80,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(123,255,178,0.4)',
  },
  editButton: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(123,255,178,0.12)',
  },
  editButtonText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.highlight,
  },
  clubAdminSection: { gap: 10 },
  clubAdminButton: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.28)',
    backgroundColor: 'rgba(123,255,178,0.08)',
  },
  clubAdminButtonPressed: { backgroundColor: 'rgba(123,255,178,0.14)' },
  clubAdminCopy: { flex: 1, gap: 5 },
  clubAdminTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.highlight,
  },
  clubAdminSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
  },
  clubAdminArrow: { fontSize: 22, color: 'rgba(255,255,255,0.5)' },
  mateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(15,17,16,0.4)',
  },
  mateRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  mateName: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  mateHcp: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
  },
  signOut: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  signOutText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
});
