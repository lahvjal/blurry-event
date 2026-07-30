import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { PAGE_HEADER_HEIGHT, PageHeader } from '@/components/page-header';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { Badge, InfoRow, Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';

export default function ParticipantProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const { me, participantById, teamOf } = useEvent();
  const participant = params.id ? participantById(params.id) : undefined;
  const team = participant ? teamOf(participant.id) : undefined;
  const isMe = participant?.id === me.id;

  return (
    <View style={styles.root}>
      <Noise />
      <PageHeader title="PLAYER PROFILE" showMore={false} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + PAGE_HEADER_HEIGHT + 28,
          paddingHorizontal: 20,
          paddingBottom: 140,
          gap: 24,
        }}
        showsVerticalScrollIndicator={false}>
        {participant ? (
          <>
            <View style={styles.identity}>
              <ParticipantAvatar participant={participant} size={104} />
              <Text style={styles.name}>{participant.fullName}</Text>
              <Badge label={isMe ? 'YOU' : 'PLAYER'} />
            </View>

            <View style={styles.details}>
              <InfoRow
                label="HANDICAP"
                value={
                  participant.handicap === null
                    ? '—'
                    : String(participant.handicap)
                }
              />
              <InfoRow label="TEAM" value={team?.name ?? 'Unassigned'} />
            </View>

            {!isMe ? (
              <Pressable
                style={styles.messageButton}
                onPress={() =>
                  router.push({
                    pathname: '/direct-message',
                    params: { participant: participant.id },
                  })
                }>
                <Text style={styles.messageButtonText}>MESSAGE</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.messageButton}
                onPress={() => router.push('/profile')}>
                <Text style={styles.messageButtonText}>OPEN MY PROFILE</Text>
              </Pressable>
            )}
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Player unavailable</Text>
            <Text style={styles.emptyBody}>
              This player may no longer be on the event roster.
            </Text>
          </View>
        )}
      </ScrollView>
      <FloatingNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  identity: {
    alignItems: 'center',
    gap: 12,
  },
  name: {
    fontFamily: fonts.serif,
    fontSize: 38,
    lineHeight: 42,
    color: '#ffffff',
    textAlign: 'center',
  },
  details: {
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  messageButton: {
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(93,146,115,0.18)',
  },
  messageButtonText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  empty: {
    gap: 10,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 32,
    color: '#ffffff',
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.5)',
  },
});
