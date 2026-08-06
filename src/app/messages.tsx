import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { OfflineNotice } from '@/components/offline-state';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { PushPrompt } from '@/components/push-controls';
import { SearchField } from '@/components/search-field';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import {
  conversationTitle,
  formatInboxTime,
  initialsOf,
  useConversations,
} from '@/state/chat';
import { useEvent } from '@/state/event';
import { ConversationSummary } from '@/state/types';

export default function Messages() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me, participantById } = useEvent();
  const offline = useBrowserDefinitelyOffline();
  const { conversations, loading, error } = useConversations();
  const [query, setQuery] = React.useState('');

  const rows = React.useMemo(
    () =>
      conversations.map((conversation) => ({
        conversation,
        title: conversationTitle(conversation, me.id, participantById, event.name),
        preview: previewOf(conversation, me.id, participantById),
        directParticipant:
          conversation.kind === 'direct'
            ? participantById(
                conversation.memberIds.find((id) => id !== me.id) ?? '',
              )
            : undefined,
      })),
    [conversations, me.id, participantById, event.name],
  );

  const term = query.trim().toLowerCase();
  const filtered = term
    ? rows.filter(
        (row) =>
          row.title.toLowerCase().includes(term) ||
          row.preview.toLowerCase().includes(term),
      )
    : rows;

  return (
    <View style={styles.root}>
      <Noise />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Messages</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
            accessibilityHint={
              offline ? 'Starting a conversation requires a connection.' : undefined
            }
            accessibilityState={{ disabled: offline }}
            disabled={offline}
            style={[styles.newButton, offline && styles.newButtonDisabled]}
            onPress={() => router.push('/new-message')}>
            <Text style={styles.newButtonText}>+</Text>
          </Pressable>
        </View>

        {/* Search */}
        <SearchField
          value={query}
          onChangeText={setQuery}
          style={{ marginBottom: 8 }}
        />

        {offline ? (
          <OfflineNotice
            compact
            message="Saved conversations and recent messages are available. Starting a new conversation requires a connection; reconnect and try again."
            style={styles.offlineNotice}
          />
        ) : null}

        {me.claimed && !offline ? <PushPrompt /> : null}

        {error ? <Text style={styles.notice}>{error}</Text> : null}

        {/* Conversations */}
        {filtered.map(({ conversation, title, preview, directParticipant }) => {
          const unread = conversation.unreadCount > 0;
          return (
            <Pressable
              key={conversation.id}
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname:
                    conversation.kind === 'direct'
                      ? '/direct-message'
                      : '/group-conversation',
                  params: { id: conversation.id },
                })
              }>
              {directParticipant ? (
                <ParticipantAvatar participant={directParticipant} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialsOf(title)}</Text>
                </View>
              )}
              <View style={styles.rowInfo}>
                <Text style={[styles.rowName, !unread && styles.rowNameRead]}>
                  {title}
                </Text>
                <Text style={styles.rowPreview} numberOfLines={2}>
                  {preview}
                </Text>
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTime}>
                  {formatInboxTime(conversation.lastActivityAt)}
                </Text>
                {unread ? <View style={styles.unreadDot} /> : null}
              </View>
            </Pressable>
          );
        })}

        {!loading && filtered.length === 0 ? (
          <Text style={styles.notice}>
            {term
              ? `No conversations match “${query}”.`
              : me.claimed
                ? 'No conversations yet. Tap + to start one.'
                : 'Sign in with your invite code to message the field.'}
          </Text>
        ) : null}
      </ScrollView>
      <FloatingNav />
    </View>
  );
}

/** "Marco: I booked the 8:20." — the sender is only worth naming in a group. */
function previewOf(
  conversation: ConversationSummary,
  myId: string,
  participantById: (id: string) => { fullName: string } | undefined,
): string {
  if (
    conversation.lastActivityKind === 'reaction' &&
    conversation.lastReactionEmoji
  ) {
    const reactor =
      participantById(conversation.lastReactorId ?? '')?.fullName.split(' ')[0] ??
      'Someone';
    const message = conversation.lastReactionMessageBody?.trim();
    const media =
      conversation.lastReactionMessageMediaMimeType === 'image/gif'
        ? 'GIF'
        : conversation.lastReactionMessageMediaMimeType
          ? 'photo'
          : null;
    return `${reactor} reacted ${conversation.lastReactionEmoji}${
      message ? ` to “${message}”` : media ? ` to a ${media}` : ''
    }`;
  }

  const message =
    conversation.lastMessageBody?.trim() ||
    (conversation.lastMessageMediaMimeType === 'image/gif'
      ? 'GIF'
      : conversation.lastMessageMediaMimeType
        ? 'Photo'
        : null);
  if (!message) return 'No messages yet.';
  if (conversation.kind === 'direct') return message;

  const senderId = conversation.lastSenderId;
  if (!senderId) return message;

  const name =
    senderId === myId
      ? 'You'
      : (participantById(senderId)?.fullName.split(' ')[0] ?? 'Someone');
  return `${name}: ${message}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 40,
    color: '#ffffff',
  },
  newButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1d211f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newButtonText: {
    fontFamily: fonts.regular,
    fontSize: 22,
    color: '#ffffff',
    marginTop: -2,
  },
  newButtonDisabled: {
    opacity: 0.38,
  },
  offlineNotice: {
    marginHorizontal: 12,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 12,
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#333634',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#131715',
  },
  rowInfo: {
    flex: 1,
    gap: 5,
  },
  rowName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  rowNameRead: {
    color: 'rgba(255,255,255,0.45)',
  },
  rowPreview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: 18,
    alignSelf: 'flex-start',
    paddingTop: 4,
  },
  rowTime: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.highlight,
  },
  notice: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingTop: 28,
    lineHeight: 19,
  },
});
