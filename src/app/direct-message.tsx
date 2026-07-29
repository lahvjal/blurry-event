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
  findDirectConversation,
  openDirectConversation,
  sendMessage,
} from '@/lib/chat';
import {
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
  background = '#333634',
  color = '#131715',
}: {
  initials: string;
  size?: number;
  background?: string;
  color?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: size * 0.34, color }}>
        {initials}
      </Text>
    </View>
  );
}

export default function DirectMessage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me, participantById } = useEvent();
  // Arrives either as an existing thread, or as the person to open one with.
  const params = useLocalSearchParams<{ id?: string; participant?: string }>();

  const [conversationId, setConversationId] = React.useState<string | null>(
    params.id ?? null,
  );
  const [openError, setOpenError] = React.useState<string | null>(null);

  // Opened from the roster: look for the existing thread but don't create one,
  // so backing out without saying anything leaves no empty row behind.
  React.useEffect(() => {
    if (params.id) {
      setConversationId(params.id);
      return;
    }
    if (!params.participant) return;

    let active = true;
    findDirectConversation(params.participant)
      .then((id) => {
        if (active && id) setConversationId(id);
      })
      .catch((caught: { message?: string }) => {
        if (active) setOpenError(caught?.message ?? 'Could not open that thread.');
      });
    return () => {
      active = false;
    };
  }, [params.id, params.participant]);

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

  /** The first message to a new person is what brings the thread into being. */
  const handleSend = async (
    text: string,
    attachment: ChatMessageMediaDraft | null,
  ): Promise<boolean> => {
    if (conversationId) {
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
    }
    if (!params.participant) return false;
    try {
      const id = await openDirectConversation(params.participant);
      // Store the message before switching over, so the thread's first load
      // already includes it.
      await sendMessage({
        conversationId: id,
        senderId: me.id,
        body: text.trim(),
        attachment,
      });
      setOpenError(null);
      setConversationId(id);
      return true;
    } catch (caught) {
      setOpenError(
        (caught as { message?: string })?.message ?? 'Could not send that message.',
      );
      return false;
    }
  };

  const otherId =
    conversation?.memberIds.find((id) => id !== me.id) ?? params.participant ?? null;
  const other = otherId ? participantById(otherId) : undefined;
  const otherName = other?.fullName ?? 'Direct message';
  const otherInitials = initialsOf(otherName);

  const scroller = React.useRef<ScrollView>(null);
  const lastAutoScrolledMessage = React.useRef<string | null>(null);
  const nearBottom = React.useRef(true);
  const [composerHeight, setComposerHeight] = React.useState(
    DEFAULT_MESSAGE_COMPOSER_HEIGHT,
  );
  const runs = groupThread(messages);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const notice = openError ?? error;
  const newestMessageClientId = messages[messages.length - 1]?.clientId ?? null;

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
                {other ? (
                  <ParticipantAvatar participant={other} size={40} />
                ) : (
                  <InitialsAvatar
                    initials={otherInitials}
                    size={40}
                    color="#5a5f5c"
                  />
                )}
                <View style={{ gap: 3 }}>
                  <Text style={styles.headerName}>{otherName}</Text>
                  <Text style={styles.headerStatus}>
                    {other?.handicap === null || other?.handicap === undefined
                      ? 'PLAYER'
                      : `${other.handicap} HCP`}
                  </Text>
                </View>
              </View>
              <Pressable
                hitSlop={12}
                disabled={!conversationId}
                onPress={openSettings}
                style={
                  !conversationId ? styles.headerActionDisabled : undefined
                }>
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
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {loadingOlder ? (
            <View style={styles.olderLoader}>
              <ActivityIndicator size="small" color={colors.highlight} />
              <Text style={styles.olderLoaderLabel}>LOADING EARLIER MESSAGES</Text>
            </View>
          ) : null}

          {runs.map((run) => {
            const mine = run.senderId === me.id;
            const sender = mine ? me : other;
            const initials = mine ? initialsOf(me.fullName) : otherInitials;
            return (
              <View key={run.key} style={{ gap: 8 }}>
                {run.dayLabel ? (
                  <Text style={styles.dayLabel}>{run.dayLabel}</Text>
                ) : null}
                <Text style={[styles.senderLabel, mine && styles.senderLabelMe]}>
                  {mine ? 'Me' : otherName}
                </Text>
                {run.messages.map((message, i) => (
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
                    {i === run.messages.length - 1 ? (
                      <View
                        style={mine ? styles.bubbleAvatarRight : styles.bubbleAvatarLeft}>
                        {sender ? (
                          <ParticipantAvatar participant={sender} size={24} />
                        ) : (
                          <InitialsAvatar initials={initials} color="#5a5f5c" />
                        )}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            );
          })}

          {!loading && messages.length === 0 && !notice ? (
            <Text style={styles.notice}>
              No messages yet. Say something to {otherName.split(' ')[0]}.
            </Text>
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
  },
  headerActionDisabled: {
    opacity: 0.35,
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
  senderLabelMe: {
    textAlign: 'right',
  },
  incomingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingLeft: 32,
    marginBottom: 6,
  },
  outgoingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 6,
  },
  bubbleAvatarLeft: {
    position: 'absolute',
    left: 0,
    bottom: 6,
  },
  bubbleAvatarRight: {
    marginBottom: 2,
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
