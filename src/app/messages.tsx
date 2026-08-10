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
import {
  conversationSummaryPreview,
  conversationSummaryTitle,
} from '@/lib/conversation-summary';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { eventPath } from '@/lib/routes';
import {
  formatInboxTime,
  initialsOf,
  useConversations,
} from '@/state/chat';
import { useEvent } from '@/state/event';

export default function Messages() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me, activeEventId, accountAccess } = useEvent();
  const offline = useBrowserDefinitelyOffline();
  const { conversations, loading, error } = useConversations();
  const [query, setQuery] = React.useState('');
  const canStartConversation = Boolean(
    activeEventId &&
      accountAccess?.events.find((event) => event.id === activeEventId)?.registration,
  );

  const rows = React.useMemo(
    () =>
      conversations.map((conversation) => ({
        conversation,
        title: conversationSummaryTitle(conversation),
        preview: conversationSummaryPreview(conversation),
        directParticipant:
          conversation.kind === 'direct' &&
          conversation.directParticipantId &&
          conversation.directParticipantName
            ? {
                id: conversation.directParticipantId,
                fullName: conversation.directParticipantName,
                initials: initialsOf(conversation.directParticipantName),
                avatarUrl: conversation.directParticipantAvatarUrl,
              }
            : null,
      })),
    [conversations],
  );

  const term = query.trim().toLowerCase();
  const filtered = term
    ? rows.filter(
        (row) =>
          row.title.toLowerCase().includes(term) ||
          row.preview.toLowerCase().includes(term) ||
          row.conversation.eventName.toLowerCase().includes(term),
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
              offline
                ? 'Starting a conversation requires a connection.'
                : !canStartConversation
                  ? 'Join an active event to start a new conversation.'
                  : undefined
            }
            accessibilityState={{ disabled: offline || !canStartConversation }}
            disabled={offline || !canStartConversation}
            style={[
              styles.newButton,
              (offline || !canStartConversation) && styles.newButtonDisabled,
            ]}
            onPress={() =>
              activeEventId
                ? router.push(eventPath(activeEventId, 'new-message') as never)
                : undefined
            }>
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

        {(accountAccess?.accountId || me.claimed) && !offline ? (
          <PushPrompt accountId={accountAccess?.accountId ?? null} />
        ) : null}

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
                  pathname: conversation.eventOwned
                    ? (eventPath(
                        conversation.eventId,
                        conversation.kind === 'direct'
                          ? 'direct-message'
                          : 'group-conversation',
                      ) as never)
                    : '/chat',
                  params: {
                    id: conversation.id,
                    kind: conversation.kind,
                    account: conversation.eventOwned ? undefined : '1',
                    originEventId: conversation.eventId,
                  },
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
                <Text style={styles.rowOrigin} numberOfLines={1}>
                  {conversation.eventName}
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
              : accountAccess?.accountId || me.claimed
                ? 'No conversations yet. Tap + to start one.'
                : 'Sign in with your invite code to message the field.'}
          </Text>
        ) : null}
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
  rowOrigin: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.32)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
