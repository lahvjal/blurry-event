import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { PageHeader } from '@/components/page-header';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { leaveConversation } from '@/lib/chat';
import { conversationTitle, initialsOf, useConversationDetail } from '@/state/chat';
import { useEvent } from '@/state/event';

export default function GroupDetails() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me, participantById } = useEvent();
  const params = useLocalSearchParams<{ id?: string }>();
  const conversationId = params.id ?? null;

  const { conversation, loading, error } = useConversationDetail(conversationId);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const title = conversation
    ? conversationTitle(conversation, me.id, participantById, event.name)
    : 'Conversation';
  const members = (conversation?.memberIds ?? [])
    .map((id) => participantById(id))
    .filter((player): player is NonNullable<typeof player> => Boolean(player));
  const creatorName = conversation?.createdBy
    ? participantById(conversation.createdBy)?.fullName.split(' ')[0]
    : null;

  // The all-hands thread is the whole roster by definition: nobody adds to it
  // or leaves it.
  const isEventGroup = conversation?.kind === 'event_group';

  const leave = async () => {
    if (!conversationId || leaving) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveConversation(conversationId);
      router.replace('/messages');
    } catch (caught) {
      setLeaveError((caught as { message?: string })?.message ?? 'Could not leave.');
      setLeaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <Noise />
      <PageHeader title="GROUP SETTINGS" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 20,
          paddingHorizontal: 20,
          paddingBottom: 140,
          gap: 16,
        }}
        showsVerticalScrollIndicator={false}>
        {/* Group card */}
        <View style={styles.groupCard}>
          <View style={styles.groupHeader}>
            <View style={styles.groupAvatar}>
              <Text style={styles.groupAvatarText}>{initialsOf(title)}</Text>
            </View>
            <View style={{ gap: 5, flex: 1 }}>
              <Text style={styles.groupName}>{title}</Text>
              <Text style={styles.groupMeta}>
                {members.length} {members.length === 1 ? 'member' : 'members'}
                {creatorName ? ` · Created by ${creatorName}` : ''}
              </Text>
            </View>
          </View>
          {isEventGroup ? (
            <Text style={styles.groupDescription}>
              Everyone playing the {event.name} is in this one.
            </Text>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.sectionLabel}>MEMBERS · {members.length}</Text>
        {isEventGroup ? null : (
          <Pressable
            onPress={() =>
              conversationId
                ? router.push({
                    pathname: '/create-group',
                    params: { add: conversationId },
                  })
                : undefined
            }>
            <Text style={styles.addPeople}>ADD PEOPLE</Text>
          </Pressable>
        )}

        <View>
          {members.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{member.initials}</Text>
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={styles.memberName}>
                  {member.fullName}
                  {member.id === me.id ? '  ·  YOU' : ''}
                </Text>
                <Text style={styles.memberRole}>
                  {member.id === conversation?.createdBy ? 'CREATED THIS GROUP' : 'MEMBER'}
                </Text>
              </View>
            </View>
          ))}
          {!loading && members.length === 0 ? (
            <Text style={styles.error}>This conversation is no longer available.</Text>
          ) : null}
        </View>

        {leaveError ? <Text style={styles.error}>{leaveError}</Text> : null}

        {isEventGroup ? null : (
          <Pressable style={styles.leaveButton} onPress={leave} disabled={leaving}>
            <Text style={styles.leaveText}>
              {leaving ? 'LEAVING…' : 'LEAVE GROUP'}
            </Text>
          </Pressable>
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
  groupCard: {
    backgroundColor: '#181d1a',
    padding: 20,
    gap: 16,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  groupAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1e3629',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupAvatarText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.highlight,
  },
  groupName: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: '#ffffff',
  },
  groupMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  groupDescription: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
  },
  addPeople: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333634',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#5a5f5c',
  },
  memberName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  memberRole: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
  },
  error: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#ff9d9d',
  },
  leaveButton: {
    backgroundColor: '#521a2b',
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
});
