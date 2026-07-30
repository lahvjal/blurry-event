import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
  MessageComposerContext,
  MessageComposer,
} from '@/components/message-composer';
import { ChatMessageBubble } from '@/components/chat-message-bubble';
import {
  FLOATING_SCRIM_RISE,
  FloatingBackdrop,
} from '@/components/floating-backdrop';
import {
  FLOATING_GLASS_BLUR_INTENSITY,
  FLOATING_GLASS_TINT,
  LiquidGlassSurface,
} from '@/components/liquid-glass';
import { FloatingGradientStroke } from '@/components/floating-gradient-stroke';
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
import { ChatMessageMediaDraft } from '@/state/types';

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
  const {
    messages,
    loading,
    loadingOlder,
    hasOlder,
    error,
    send,
    react,
    edit,
    unsend,
    loadOlder,
  } = useConversation(conversationId);
  const [composerContext, setComposerContext] =
    React.useState<MessageComposerContext | null>(null);

  const title = conversation
    ? conversationTitle(conversation, me.id, participantById, event.name)
    : 'Conversation';
  const memberCount = conversation?.memberIds.length ?? 0;

  const scroller = React.useRef<ScrollView>(null);
  const lastAutoScrolledMessage = React.useRef<string | null>(null);
  const nearBottom = React.useRef(true);
  const [composerHeight, setComposerHeight] = React.useState(
    DEFAULT_MESSAGE_COMPOSER_HEIGHT,
  );
  const runs = groupThread(messages);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const newestMessageClientId = messages[messages.length - 1]?.clientId ?? null;

  const handleSend = async (
    text: string,
    attachment: ChatMessageMediaDraft | null,
  ): Promise<boolean> => {
    if (composerContext?.kind === 'edit') {
      await edit(composerContext.messageId, text);
      setComposerContext(null);
      return true;
    } else {
      const sent = await send(
        text,
        composerContext?.kind === 'reply'
          ? composerContext.messageId
          : null,
        attachment,
      );
      if (sent) setComposerContext(null);
      return sent;
    }
  };

  const handleContentSizeChange = () => {
    if (
      !newestMessageClientId ||
      newestMessageClientId === lastAutoScrolledMessage.current
    ) {
      return;
    }
    lastAutoScrolledMessage.current = newestMessageClientId;
    if (nearBottom.current) {
      scroller.current?.scrollToEnd({ animated: false });
    }
  };

  const handleScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottom.current =
      contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
    if (contentOffset.y <= 120 && hasOlder && !loadingOlder) {
      void loadOlder();
    }
  };

  const openSettings = () => {
    if (!conversationId) return;
    router.push({
      pathname: '/conversation-settings',
      params: { id: conversationId },
    });
  };
  const openDetails = () => {
    if (conversation?.teamId) {
      router.push('/my-team');
      return;
    }
    openSettings();
  };

  return (
    <View style={styles.root}>
      <Noise />
      {/* Header */}
      <View style={styles.headerWrap}>
        <FloatingBackdrop
          edge="top"
          height={insets.top + 54 + FLOATING_SCRIM_RISE}
        />
        <View style={[styles.headerContent, { paddingTop: insets.top }]}>
          <View style={styles.headerFrame}>
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
                <Pressable style={{ gap: 3 }} onPress={openDetails}>
                  <Text style={styles.headerName}>{title}</Text>
                  <Text style={styles.headerStatus}>
                    {conversation?.teamId ? 'TEAM CHAT · ' : ''}
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
            <FloatingGradientStroke borderRadius={999} />
          </View>
        </View>
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
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScroll={handleScroll}
          scrollEventThrottle={80}
          onContentSizeChange={handleContentSizeChange}>
          {error ? <Text style={styles.notice}>{error}</Text> : null}
          {loadingOlder ? (
            <View style={styles.olderLoader}>
              <ActivityIndicator size="small" color={colors.highlight} />
              <Text style={styles.olderLoaderLabel}>LOADING EARLIER MESSAGES</Text>
            </View>
          ) : null}

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
                        replyToMessage={
                          message.replyToId
                            ? messageById.get(message.replyToId)
                            : undefined
                        }
                        mine={mine}
                        myParticipantId={me.id}
                        participantNameById={(participantId) =>
                          participantById(participantId)?.fullName ?? 'Player'
                        }
                        onReact={(emoji) => react(message.id, emoji)}
                        onReply={() =>
                          setComposerContext({
                            kind: 'reply',
                            messageId: message.id,
                            body:
                              message.body ||
                              (message.media?.mimeType === 'image/gif'
                                ? 'GIF'
                                : 'Photo'),
                          })
                        }
                        onEdit={() =>
                          setComposerContext({
                            kind: 'edit',
                            messageId: message.id,
                            body: message.body,
                          })
                        }
                        onUnsend={() => {
                          if (composerContext?.messageId === message.id) {
                            setComposerContext(null);
                          }
                          void unsend(message.id);
                        }}
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
          onSend={handleSend}
          onHeightChange={setComposerHeight}
          context={composerContext}
          onCancelContext={() => setComposerContext(null)}
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
  },
  headerContent: {
    paddingHorizontal: 20,
  },
  headerFrame: {
    height: 54,
    borderRadius: 999,
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
  olderLoader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  olderLoaderLabel: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.7,
    color: 'rgba(255,255,255,0.42)',
  },
});
