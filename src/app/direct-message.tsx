import { BlurView } from 'expo-blur';
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

import { MessageComposer } from '@/components/message-composer';
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
  const { messages, loading, error, send } = useConversation(conversationId);

  /** The first message to a new person is what brings the thread into being. */
  const handleSend = async (text: string) => {
    if (conversationId) {
      await send(text);
      return;
    }
    if (!params.participant) return;
    try {
      const id = await openDirectConversation(params.participant);
      // Store the message before switching over, so the thread's first load
      // already includes it.
      await sendMessage({ conversationId: id, senderId: me.id, body: text.trim() });
      setOpenError(null);
      setConversationId(id);
    } catch (caught) {
      setOpenError(
        (caught as { message?: string })?.message ?? 'Could not send that message.',
      );
    }
  };

  const otherId =
    conversation?.memberIds.find((id) => id !== me.id) ?? params.participant ?? null;
  const other = otherId ? participantById(otherId) : undefined;
  const otherName = other?.fullName ?? 'Direct message';
  const otherInitials = initialsOf(otherName);

  const scroller = React.useRef<ScrollView>(null);
  const runs = groupThread(messages);
  const notice = openError ?? error;

  return (
    <View style={styles.root}>
      <Noise />
      {/* Header */}
      <View style={[styles.headerWrap, { top: insets.top }]}>
        <BlurView intensity={20} tint="dark" style={styles.headerPill}>
          <View style={styles.headerLeft}>
            <Pressable hitSlop={12} onPress={() => router.back()}>
              <Image
                source={backArrow}
                style={{ width: 28, height: 12.2 }}
                contentFit="contain"
                tintColor="#ffffff"
              />
            </Pressable>
            <InitialsAvatar initials={otherInitials} size={40} color="#5a5f5c" />
            <View style={{ gap: 3 }}>
              <Text style={styles.headerName}>{otherName}</Text>
              <Text style={styles.headerStatus}>
                {other?.handicap === null || other?.handicap === undefined
                  ? 'PLAYER'
                  : `${other.handicap} HCP`}
              </Text>
            </View>
          </View>
          <Pressable hitSlop={12}>
            <Image
              source={moreDots}
              style={{ width: 28, height: 5 }}
              contentFit="contain"
              tintColor="#ffffff"
            />
          </Pressable>
        </BlurView>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={{
            paddingTop: insets.top + 54 + 20,
            paddingHorizontal: 20,
            paddingBottom: 20,
            gap: 8,
          }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {runs.map((run) => {
            const mine = run.senderId === me.id;
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
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleOutgoing : styles.bubbleIncoming,
                        message.pending && styles.bubblePending,
                      ]}>
                      <Text
                        style={[styles.bubbleText, mine && { textAlign: 'right' }]}>
                        {message.body}
                      </Text>
                    </View>
                    {/* Avatar sits beside the last bubble of a run only. */}
                    {i === run.messages.length - 1 ? (
                      <View
                        style={mine ? styles.bubbleAvatarRight : styles.bubbleAvatarLeft}>
                        <InitialsAvatar initials={initials} color="#5a5f5c" />
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

        <View style={{ paddingBottom: insets.bottom + 6 }}>
          <MessageComposer onSend={handleSend} />
        </View>
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
    backgroundColor: 'rgba(74,88,80,0.1)',
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
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  bubbleIncoming: {
    backgroundColor: '#1c211e',
  },
  bubbleOutgoing: {
    backgroundColor: '#1e3629',
  },
  /** Queued while offline; firms up once the server has it. */
  bubblePending: {
    opacity: 0.55,
  },
  bubbleText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#ffffff',
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
