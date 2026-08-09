import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { PAGE_HEADER_HEIGHT, PageHeader } from '@/components/page-header';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import {
  conversationSummaryPreview,
  conversationSummaryTitle,
} from '@/lib/conversation-summary';
import { eventPath } from '@/lib/routes';
import {
  formatInboxTime,
  useConversations,
} from '@/state/chat';
import { useEvent } from '@/state/event';
import { markAnnouncementsSeen } from '@/state/notification-center';
import { ConversationSummary } from '@/state/types';

const bell = require('@/assets/figma/notification-bell.svg');
const messageIcon = require('@/assets/figma/nav-messages.svg');

type NotificationRow = {
  id: string;
  kind: 'announcement' | 'message';
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
  conversation?: ConversationSummary;
};

export default function Notifications() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me, announcements } = useEvent();
  const { conversations, loading, error } = useConversations();

  const announcementIds = React.useMemo(
    () => announcements.map((announcement) => announcement.id),
    [announcements],
  );
  const scope = `${event.id}.${me.id}`;

  useFocusEffect(
    React.useCallback(() => {
      void markAnnouncementsSeen(scope, announcementIds);
    }, [scope, announcementIds]),
  );

  const rows = React.useMemo<NotificationRow[]>(() => {
    const announcementRows: NotificationRow[] = announcements.map((note) => ({
      id: `announcement-${note.id}`,
      kind: 'announcement',
      title: `Announcement from ${note.authorName}`,
      body: note.body,
      createdAt: note.createdAt,
      unread: false,
    }));

    const messageRows: NotificationRow[] = conversations
      .filter((conversation) => Boolean(conversation.lastActivityAt))
      .map((conversation) => ({
        id: `message-${conversation.id}`,
        kind: 'message',
        title: conversationSummaryTitle(conversation),
        body: conversationSummaryPreview(conversation),
        createdAt: conversation.lastActivityAt ?? '',
        unread: conversation.unreadCount > 0,
        conversation,
      }));

    return [...announcementRows, ...messageRows].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [
    announcements,
    conversations,
    me.id,
  ]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#203329', '#1b2a22']}
        style={StyleSheet.absoluteFill}
      />
      <Noise />
      <PageHeader title="notifications" showMore={false} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + PAGE_HEADER_HEIGHT + 22 },
        ]}
        showsVerticalScrollIndicator={false}>
        {error ? <Text style={styles.notice}>{error}</Text> : null}

        {rows.map((row) => (
          <Pressable
            key={row.id}
            style={[styles.row, row.unread && styles.rowUnread]}
            onPress={() => {
              if (row.kind === 'announcement') {
                router.push('/announcements');
                return;
              }
              const conversation = row.conversation;
              if (!conversation) return;
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
              });
            }}>
            <View style={[styles.icon, row.unread && styles.iconUnread]}>
              <Image
                source={row.kind === 'announcement' ? bell : messageIcon}
                style={styles.iconImage}
                contentFit="contain"
              />
            </View>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text
                  numberOfLines={1}
                  style={[styles.rowTitle, !row.unread && styles.rowTitleRead]}>
                  {row.title}
                </Text>
                <Text style={styles.when}>
                  {formatInboxTime(row.createdAt)}
                </Text>
              </View>
              <Text style={styles.preview} numberOfLines={2}>
                {row.body}
              </Text>
            </View>
            {row.unread ? <View style={styles.unreadDot} /> : null}
          </Pressable>
        ))}

        {!loading && rows.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Image source={bell} style={styles.emptyBell} contentFit="contain" />
            </View>
            <Text style={styles.emptyTitle}>YOU'RE ALL CAUGHT UP</Text>
            <Text style={styles.emptyBody}>
              Announcements and recent chat activity will appear here.
            </Text>
          </View>
        ) : null}
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
  content: {
    paddingHorizontal: 20,
    paddingBottom: 130,
    gap: 10,
  },
  row: {
    minHeight: 82,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(15,17,16,0.35)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowUnread: {
    backgroundColor: 'rgba(32,51,41,0.8)',
    borderColor: 'rgba(123,255,178,0.12)',
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconUnread: {
    backgroundColor: 'rgba(123,255,178,0.12)',
  },
  iconImage: {
    width: 21,
    height: 21,
  },
  rowBody: {
    flex: 1,
    gap: 6,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  rowTitleRead: {
    color: 'rgba(255,255,255,0.7)',
  },
  when: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
  },
  preview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.55)',
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.highlight,
  },
  notice: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.55)',
  },
  empty: {
    paddingVertical: 70,
    paddingHorizontal: 30,
    alignItems: 'center',
    gap: 12,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyBell: {
    width: 24,
    height: 24,
    opacity: 0.6,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: '#ffffff',
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },
});
