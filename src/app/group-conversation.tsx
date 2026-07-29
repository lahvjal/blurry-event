import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DEFAULT_MESSAGE_COMPOSER_HEIGHT,
  MessageComposer,
} from '@/components/message-composer';
import { ChatMessageBubble } from '@/components/chat-message-bubble';
import {
  FLOATING_GLASS_BLUR_INTENSITY,
  FLOATING_GLASS_TINT,
  LiquidGlassSurface,
} from '@/components/liquid-glass';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import {
  conversationTitle,
  groupThread,
  initialsOf,
  useConversation,
  useConversationDetail,
} from '@/state/chat';
import { useEvent } from '@/state/event';

const backArrow = require('@/assets/figma/back-arrow.svg');
const moreDots = require('@/assets/figma/more-dots.svg');

function InitialsAvatar({
  initials,
  size = 24,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#333634',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text
        style={{ fontFamily: fonts.bold, fontSize: size * 0.34, color: '#5a5f5c' }}>
        {initials}
      </Text>
    </View>
  );
}

export default function GroupConversation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me, participantById } = useEvent();
  const params = useLocalSearchParams<{ id?: string }>();
  const conversationId = params.id ?? null;

  const { conversation } = useConversationDetail(conversationId);
  const { messages, loading, error, send, react } =
    useConversation(conversationId);

  const title = conversation
    ? conversationTitle(conversation, me.id, participantById, event.name)
    : 'Conversation';
  const memberCount = conversation?.memberIds.length ?? 0;

  const scroller = React.useRef<ScrollView>(null);
  const lastAutoScrolledMessage = React.useRef<string | null>(null);
  const [composerHeight, setComposerHeight] = React.useState(
    DEFAULT_MESSAGE_COMPOSER_HEIGHT,
  );
  const runs = groupThread(messages);
  const newestMessageClientId = messages[messages.length - 1]?.clientId ?? null;

  const handleContentSizeChange = () => {
    if (
      !newestMessageClientId ||
      newestMessageClientId === lastAutoScrolledMessage.current
    ) {
      return;
    }
    lastAutoScrolledMessage.current = newestMessageClientId;
    scroller.current?.scrollToEnd({ animated: false });
  };

  const openSettings = () => {
    if (!conversationId) return;
    router.push({
      pathname: '/conversation-settings',
      params: { id: conversationId },
    });
  };

  return (
    <View style={styles.root}>
      <Noise />
      {/* Header */}
      <View style={[styles.headerWrap, { top: insets.top }]}>
        <LiquidGlassSurface
          style={styles.headerPill}
          tintColor={FLOATING_GLASS_TINT}
          blurIntensity={FLOATING_GLASS_BLUR_INTENSITY}
          interactive>
          <View style={styles.headerLeft}>
            <Pressable hitSlop={12} onPress={() => router.back()}>
              <Image
                source={backArrow}
                style={{ width: 28, height: 12.2 }}
                contentFit="contain"
                tintColor="#ffffff"
              />
            </Pressable>
            <InitialsAvatar initials={initialsOf(title)} size={40} />
            <Pressable style={{ gap: 3 }} onPress={openSettings}>
              <Text style={styles.headerName}>{title}</Text>
              <Text style={styles.headerStatus}>
                {memberCount} {memberCount === 1 ? 'MEMBER' : 'MEMBERS'}
              </Text>
            </Pressable>
          </View>
          <Pressable hitSlop={12} onPress={openSettings}>
            <Image
              source={moreDots}
              style={{ width: 28, height: 5 }}
              contentFit="contain"
              tintColor="#ffffff"
            />
          </Pressable>
        </LiquidGlassSurface>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={{
            paddingTop: insets.top + 54 + 20,
            paddingHorizontal: 20,
            // The composer floats over the thread, so the final message needs
            // enough real scroll range to clear it completely.
            paddingBottom: composerHeight + 20,
            gap: 8,
          }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={handleContentSizeChange}>
          {error ? <Text style={styles.notice}>{error}</Text> : null}

          {runs.map((run) => {
            const mine = run.senderId === me.id;
            const sender = mine ? me : participantById(run.senderId);
            const senderName = mine ? 'Me' : (sender?.fullName ?? 'Someone');
            return (
              <View key={run.key} style={{ gap: 6 }}>
                {run.dayLabel ? (
                  <Text style={styles.dayLabel}>{run.dayLabel}</Text>
                ) : null}
                <Text style={[styles.senderLabel, mine && { textAlign: 'right' }]}>
                  {senderName}
                </Text>
                {run.messages.map((message, i) => {
                  const last = i === run.messages.length - 1;
                  return (
                    <View
                      key={message.clientId}
                      style={mine ? styles.outgoingRow : styles.incomingRow}>
                      <ChatMessageBubble
                        message={message}
                        mine={mine}
                        myParticipantId={me.id}
                        onReact={(emoji) => react(message.id, emoji)}
                      />
                      {/* Avatar sits beside the last bubble of a run only. */}
                      {last && mine ? (
                        <ParticipantAvatar participant={me} size={24} />
                      ) : null}
                      {last && !mine ? (
                        <View style={styles.bubbleAvatarLeft}>
                          {sender ? (
                            <ParticipantAvatar participant={sender} size={24} />
                          ) : (
                            <InitialsAvatar initials={initialsOf(senderName)} />
                          )}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            );
          })}

          {!loading && messages.length === 0 && !error ? (
            <Text style={styles.notice}>No messages yet. Kick it off.</Text>
          ) : null}
        </ScrollView>

        <MessageComposer
          onSend={send}
          onHeightChange={setComposerHeight}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  headerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 20,
  },
  headerPill: {
    height: 54,
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 18,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 12,
  },
  headerName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  headerStatus: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.highlight,
  },
  dayLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginBottom: 8,
  },
  senderLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  incomingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingLeft: 32,
  },
  outgoingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 8,
  },
  bubbleAvatarLeft: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
  notice: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    lineHeight: 19,
  },
});
