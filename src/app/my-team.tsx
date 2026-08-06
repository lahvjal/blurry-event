import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { OfflineNotice } from '@/components/offline-state';
import { PageHeader } from '@/components/page-header';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { ActionButton, Badge, InfoRow, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { useEvent } from '@/state/event';
import { GAME_STYLE_LABELS, isTeamFormat, teamSize } from '@/state/types';

export default function MyTeam() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    event,
    me,
    myTeam,
    myPlayingGroup,
    participants,
    invites,
    participantById,
    teamOf,
    inviteToTeam,
  } = useEvent();
  const offline = useBrowserDefinitelyOffline();

  const [showRoster, setShowRoster] = useState(false);

  if (!myTeam && !myPlayingGroup) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="my team" />
        <View style={[styles.empty, { paddingTop: insets.top + 54 + 60 }]}>
          <Text style={styles.emptyTitle}>No playing group yet</Text>
          <Text style={styles.emptyBody}>
            An admin will place you into a four-player start slot. Check back before
            pairings close.
          </Text>
        </View>
        <FloatingNav />
      </View>
    );
  }

  const scoringMemberIds = myTeam?.memberIds ?? [me.id];
  const members = scoringMemberIds
    .map((id) => participantById(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const capacity = isTeamFormat(event.gameStyle) ? teamSize(event.gameStyle) : 1;
  const openSlots = myTeam?.individualException
    ? 0
    : myTeam
      ? Math.max(0, capacity - members.length)
      : 0;
  const pendingInvites = invites.filter(
    (inv) => inv.teamId === myTeam?.id && inv.status === 'pending',
  );

  // Anyone not already on a team, and not already invited by us.
  const available = participants.filter(
    (p) =>
      !teamOf(p.id) &&
      !pendingInvites.some((inv) => inv.invitedParticipantId === p.id),
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader
        title={myTeam ? 'my team' : 'my group'}
        subtitle={myTeam?.name ?? myPlayingGroup?.name}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingBottom: 130,
          gap: 20,
        }}
        showsVerticalScrollIndicator={false}>
        {/* Tee time hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel}>
              {(myTeam?.name ?? myPlayingGroup?.name ?? 'PLAYING GROUP').toUpperCase()}
              {myPlayingGroup?.startingHole
                ? ` · HOLE ${myPlayingGroup.startingHole}`
                : ''}
            </Text>
            <Badge label={openSlots > 0 ? `${openSlots} OPEN` : 'CONFIRMED'} />
          </View>
          <Text style={styles.teeTime}>{myPlayingGroup?.teeTime ?? 'TBD'}</Text>
          <Text style={styles.heroSub}>
            {GAME_STYLE_LABELS[event.gameStyle]}
            {isTeamFormat(event.gameStyle)
              ? myTeam?.individualException
                ? ' · individual exception · team-owned card'
                : ' · one card per scoring team'
              : ' · individual cards'}
          </Text>
        </View>

        <View style={styles.body}>
          {offline && openSlots > 0 ? (
            <OfflineNotice
              compact
              message="Team details remain available, but inviting a player requires a connection. Reconnect and try again."
            />
          ) : null}

          {/* Roster */}
          <SectionLabel color={colors.link} size={10}>
            {myTeam ? 'scoring team' : 'individual'} · {members.length}/{capacity}
          </SectionLabel>
          <View>
            {members.map((member, i) => {
              const isMe = member.id === me.id;
              return (
                <View
                  key={member.id}
                  style={[
                    styles.memberRow,
                    i < members.length - 1 && styles.memberRowBorder,
                  ]}>
                  <ParticipantAvatar participant={member} size={36} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.memberName}>{member.fullName}</Text>
                    {isMe ? <Text style={styles.youTag}>YOU</Text> : null}
                  </View>
                  <Text style={styles.memberHcp}>
                    {member.handicap === null ? '—' : `${member.handicap} HCP`}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Pending invites */}
          {pendingInvites.length > 0 ? (
            <View style={{ gap: 10 }}>
              <SectionLabel color={colors.link} size={10}>
                invited
              </SectionLabel>
              {pendingInvites.map((inv) => {
                const invited = participantById(inv.invitedParticipantId);
                return (
                  <View key={inv.id} style={styles.inviteRow}>
                    <Text style={styles.inviteName}>{invited?.fullName ?? 'Player'}</Text>
                    <Text style={styles.invitePending}>PENDING</Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Invite a player */}
          {openSlots > 0 ? (
            showRoster ? (
              <View style={{ gap: 10 }}>
                <View style={styles.sectionHeader}>
                  <SectionLabel color={colors.link} size={10}>
                    invite a player
                  </SectionLabel>
                  <Pressable onPress={() => setShowRoster(false)}>
                    <Text style={styles.cancel}>CANCEL</Text>
                  </Pressable>
                </View>
                {available.length === 0 ? (
                  <Text style={styles.emptyBody}>
                    Everyone is already on a team. An admin can move players around.
                  </Text>
                ) : (
                  available.map((p) => (
                    <View key={p.id} style={styles.inviteRow}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={styles.inviteName}>{p.fullName}</Text>
                        <Text style={styles.memberHcp}>
                          {p.handicap === null ? '—' : `${p.handicap} HCP`}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: offline }}
                        accessibilityHint={
                          offline ? 'Inviting a player requires a connection.' : undefined
                        }
                        disabled={offline}
                        style={[
                          styles.inviteButton,
                          offline && styles.inviteButtonDisabled,
                        ]}
                        onPress={() => inviteToTeam(p.id)}>
                        <Text style={styles.inviteButtonText}>INVITE</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            ) : (
              <ActionButton
                label={`INVITE A PLAYER · ${openSlots} SPOT${openSlots > 1 ? 'S' : ''}`}
                height={64}
                disabled={offline}
                accessibilityHint={
                  offline ? 'Inviting a player requires a connection.' : undefined
                }
                onPress={() => setShowRoster(true)}
              />
            )
          ) : null}

          {/* Logistics */}
          <View style={styles.card}>
            <InfoRow
              label={event.startFormat === 'shotgun' ? 'SHOTGUN START' : 'TEE TIME'}
              value={myPlayingGroup?.teeTime ?? 'TBD'}
            />
            <InfoRow
              label="STARTING HOLE"
              value={
                myPlayingGroup?.startingHole
                  ? String(myPlayingGroup.startingHole)
                  : 'TBD'
              }
            />
            <InfoRow label="PLAYING GROUP" value={myPlayingGroup?.name ?? 'TBD'} />
            <InfoRow label="CART" value={myPlayingGroup?.cart ?? '—'} />
            <InfoRow label="CHECK-IN" value={event.checkInTime} />
          </View>

          {myPlayingGroup ? (
            <View style={{ gap: 10 }}>
              <SectionLabel color={colors.link} size={10}>
                playing together · {myPlayingGroup.memberIds.length}/4
              </SectionLabel>
              {myPlayingGroup.memberIds.map((participantId) => {
                const player = participantById(participantId);
                if (!player) return null;
                return (
                  <View key={player.id} style={styles.inviteRow}>
                    <Text style={styles.inviteName}>{player.fullName}</Text>
                    <Text style={styles.memberHcp}>
                      {player.handicap === null ? '—' : `${player.handicap} HCP`}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          <ActionButton
            label={myTeam ? 'OPEN TEAM SCORECARD' : 'OPEN MY SCORECARD'}
            onPress={() => router.push('/scorecard')}
          />
        </View>
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
  empty: {
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 32,
    color: '#ffffff',
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  hero: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 10,
    backgroundColor: 'rgba(15,17,16,0.2)',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
  },
  teeTime: {
    fontFamily: fonts.serif,
    fontSize: 60,
    lineHeight: 62,
    color: '#ffffff',
  },
  heroSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  body: {
    paddingHorizontal: 20,
    gap: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: 'rgba(15,17,16,0.45)',
  },
  memberRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  memberName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  youTag: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.highlight,
  },
  memberHcp: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(15,17,16,0.45)',
  },
  inviteName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  invitePending: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
  },
  inviteButton: {
    backgroundColor: 'rgba(123,255,178,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  inviteButtonText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
  },
  inviteButtonDisabled: {
    opacity: 0.4,
  },
  card: {
    backgroundColor: 'rgba(15,17,16,0.4)',
    paddingHorizontal: 16,
  },
});
