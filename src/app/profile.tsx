import { Image } from 'expo-image';
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
import { PushToggleRow } from '@/components/push-controls';
import { Badge, InfoRow, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { clearPushForSignOut } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { localAvatar, useEvent } from '@/state/event';
import { GAME_STYLE_LABELS } from '@/state/types';

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me, myTeam, event, updateMyProfile, participantById } = useEvent();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.fullName);
  const [handicap, setHandicap] = useState(
    me.handicap === null ? '' : String(me.handicap),
  );

  const avatarSource = me.avatarUrl ? { uri: me.avatarUrl } : localAvatar(me.id);

  const pickPhoto = async () => {
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
        {/* Identity */}
        <View style={styles.identity}>
          <Pressable onPress={pickPhoto} style={styles.avatarWrap}>
            {avatarSource ? (
              <Image source={avatarSource} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitials}>{me.initials}</Text>
              </View>
            )}
            <View style={styles.avatarEdit}>
              <Text style={styles.avatarEditText}>EDIT</Text>
            </View>
          </Pressable>

          {editing ? (
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.nameInput}
              placeholder="Your name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              selectionColor={colors.highlight}
            />
          ) : (
            <Text style={styles.name}>{me.fullName}</Text>
          )}

          {me.isAdmin ? <Badge label="EVENT ADMIN" /> : <Badge label="PARTICIPANT" />}
        </View>

        {/* Handicap + event details */}
        <View style={styles.card}>
          {editing ? (
            <View style={styles.editRow}>
              <Text style={styles.editLabel}>HANDICAP</Text>
              <TextInput
                value={handicap}
                onChangeText={setHandicap}
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
          <InfoRow label="TEE TIME" value={myTeam?.teeTime ?? '—'} />
          <InfoRow
            label="STARTING HOLE"
            value={myTeam?.startingHole ? String(myTeam.startingHole) : '—'}
          />
        </View>

        <Pressable
          style={styles.editButton}
          onPress={editing ? save : () => setEditing(true)}>
          <Text style={styles.editButtonText}>
            {editing ? 'SAVE CHANGES' : 'EDIT PROFILE'}
          </Text>
        </Pressable>

        {/* Teammates */}
        {teammates.length > 0 ? (
          <View style={{ gap: 10 }}>
            <SectionLabel color={colors.link} size={10}>
              teammates
            </SectionLabel>
            <View>
              {teammates.map((mate, i) => {
                const src = localAvatar(mate.id);
                return (
                  <Pressable
                    key={mate.id}
                    onPress={() =>
                      router.push({
                        pathname: '/direct-message',
                        params: { participant: mate.id },
                      })
                    }
                    style={[
                      styles.mateRow,
                      i < teammates.length - 1 && styles.mateRowBorder,
                    ]}>
                    {src ? (
                      <Image source={src} style={styles.mateAvatar} />
                    ) : (
                      <View style={[styles.mateAvatar, styles.avatarFallback]}>
                        <Text style={styles.mateInitials}>{mate.initials}</Text>
                      </View>
                    )}
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

        <PushToggleRow />

        <Pressable
          style={styles.signOut}
          onPress={async () => {
            // Drop this device's push registration first, so the next person to
            // sign in on this phone doesn't inherit the last one's alerts.
            await clearPushForSignOut();
            await supabase.auth.signOut();
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
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarFallback: {
    backgroundColor: '#333634',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: '#5a5f5c',
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
  mateAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  mateInitials: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: '#5a5f5c',
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
