import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { fonts } from '@/constants/theme';
import { syncNow } from '@/lib/sync';
import { formatMessageTime } from '@/state/chat';
import { ChatMessage } from '@/state/types';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '⛳️'];
const REACTION_MENU_WIDTH = 266;
const REACTION_MENU_HEIGHT = 64;
const ACTION_MENU_WIDTH = 202;
const ACTION_ROW_HEIGHT = 48;
const REACTION_DETAILS_WIDTH = 260;
const REACTION_DETAILS_HEADER_HEIGHT = 44;
const REACTION_DETAILS_ROW_HEIGHT = 44;
const REACTION_DETAILS_MAX_ROWS = 5;
const MENU_GAP = 10;
const SCREEN_EDGE_GAP = 12;
const DOUBLE_TAP_DELAY = 280;
const LONG_PRESS_DELAY = 400;
const webBubbleInteractionStyle: ViewStyle | undefined =
  Platform.OS === 'web'
    ? ({ touchAction: 'manipulation' } as unknown as ViewStyle)
    : undefined;

type OverlayMode = 'reactions' | 'actions' | 'reactionDetails' | null;

type ReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

function summarizeReactions(
  message: ChatMessage,
  myParticipantId: string,
): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();
  for (const reaction of message.reactions) {
    const existing = byEmoji.get(reaction.emoji);
    if (existing) {
      existing.count += 1;
      existing.reactedByMe ||= reaction.participantId === myParticipantId;
      continue;
    }
    byEmoji.set(reaction.emoji, {
      emoji: reaction.emoji,
      count: 1,
      reactedByMe: reaction.participantId === myParticipantId,
    });
  }
  return [...byEmoji.values()].sort((a, b) => {
    const aQuick = QUICK_REACTIONS.indexOf(a.emoji);
    const bQuick = QUICK_REACTIONS.indexOf(b.emoji);
    if (aQuick !== -1 || bQuick !== -1) {
      if (aQuick === -1) return 1;
      if (bQuick === -1) return -1;
      return aQuick - bQuick;
    }
    return a.emoji.localeCompare(b.emoji);
  });
}

export function ChatMessageBubble({
  message,
  replyToMessage,
  mine,
  myParticipantId,
  participantNameById,
  onReact,
  onReply,
  onEdit,
  onUnsend,
  offline = false,
}: {
  message: ChatMessage;
  replyToMessage?: ChatMessage;
  mine: boolean;
  myParticipantId: string;
  participantNameById: (participantId: string) => string;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onUnsend: () => void;
  offline?: boolean;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const bubbleRef = React.useRef<View>(null);
  const lastTapAt = React.useRef(0);
  const longPressTriggered = React.useRef(false);
  const copyCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlayMode, setOverlayMode] = React.useState<OverlayMode>(null);
  const [addingCustom, setAddingCustom] = React.useState(false);
  const [customEmoji, setCustomEmoji] = React.useState('');
  const [copyState, setCopyState] = React.useState<
    'idle' | 'copied' | 'failed'
  >('idle');
  const [anchor, setAnchor] = React.useState({
    x: SCREEN_EDGE_GAP,
    y: REACTION_MENU_HEIGHT + SCREEN_EDGE_GAP,
    width: REACTION_MENU_WIDTH,
  });

  const summaries = summarizeReactions(message, myParticipantId);
  const reactionUsers = React.useMemo(() => {
    const byParticipant = new Map<string, string[]>();
    for (const reaction of message.reactions) {
      const emojis = byParticipant.get(reaction.participantId) ?? [];
      if (!emojis.includes(reaction.emoji)) emojis.push(reaction.emoji);
      byParticipant.set(reaction.participantId, emojis);
    }
    return [...byParticipant.entries()]
      .map(([participantId, emojis]) => ({
        participantId,
        name:
          participantId === myParticipantId
            ? 'You'
            : participantNameById(participantId),
        emojis,
      }))
      .sort((a, b) => {
        if (a.participantId === myParticipantId) return -1;
        if (b.participantId === myParticipantId) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [message.reactions, myParticipantId, participantNameById]);
  const canChangeMessage =
    !message.pending && !message.id.startsWith('local-');
  const canEditMessage =
    canChangeMessage && mine && message.body.trim().length > 0;
  const actionCount = canChangeMessage
    ? 2 + (mine ? 1 : 0) + (canEditMessage ? 1 : 0)
    : 1;
  const actionMenuHeight = actionCount * ACTION_ROW_HEIGHT;
  const reactionDetailsHeight =
    REACTION_DETAILS_HEADER_HEIGHT +
    Math.min(reactionUsers.length, REACTION_DETAILS_MAX_ROWS) *
      REACTION_DETAILS_ROW_HEIGHT;
  const menuWidth =
    overlayMode === 'actions'
      ? ACTION_MENU_WIDTH
      : overlayMode === 'reactionDetails'
        ? REACTION_DETAILS_WIDTH
        : REACTION_MENU_WIDTH;
  const menuHeight =
    overlayMode === 'actions'
      ? actionMenuHeight
      : overlayMode === 'reactionDetails'
        ? reactionDetailsHeight
        : REACTION_MENU_HEIGHT;
  const mediaLabel =
    message.media?.mimeType === 'image/gif' ? 'GIF' : 'Photo';
  const accessibleBody = message.body.trim() || mediaLabel;
  const mediaWidth = Math.min(246, Math.max(180, windowWidth * 0.58));
  const mediaAspect =
    message.media?.width && message.media.height
      ? message.media.width / message.media.height
      : 1;
  const mediaHeight = Math.min(310, Math.max(140, mediaWidth / mediaAspect));
  const queued = message.deliveryState === 'queued' || Boolean(message.pending);
  const failed = message.deliveryState === 'failed';
  const deliveryTimeLabel = failed
    ? 'Created at'
    : queued
      ? 'Queued at'
      : 'Sent at';
  const deliveryDescription = failed
    ? offline
      ? 'Not sent. Reconnect, then tap to retry.'
      : 'Not sent. Tap to retry.'
    : queued
      ? offline
        ? 'Offline and queued. Sends automatically when you reconnect.'
        : 'Queued. Sends automatically.'
      : message.deliveryState === 'sent'
        ? 'Sent.'
        : '';

  const reactedWith = React.useMemo(
    () =>
      new Set(
        message.reactions
          .filter((reaction) => reaction.participantId === myParticipantId)
          .map((reaction) => reaction.emoji),
      ),
    [message.reactions, myParticipantId],
  );

  const closeOverlay = () => {
    if (copyCloseTimer.current) {
      clearTimeout(copyCloseTimer.current);
      copyCloseTimer.current = null;
    }
    setOverlayMode(null);
    setAddingCustom(false);
    setCustomEmoji('');
    setCopyState('idle');
  };

  React.useEffect(
    () => () => {
      if (copyCloseTimer.current) clearTimeout(copyCloseTimer.current);
    },
    [],
  );

  const openOverlay = (mode: Exclude<OverlayMode, null>) => {
    if (mode === 'reactions' && !canChangeMessage) return;
    bubbleRef.current?.measureInWindow((x, y, width) => {
      void Haptics.selectionAsync();
      setAnchor({ x, y, width });
      setOverlayMode(mode);
    });
  };

  const openReactionDetails = (nextAnchor: {
    x: number;
    y: number;
    width: number;
  }) => {
    void Haptics.selectionAsync();
    setAnchor(nextAnchor);
    setOverlayMode('reactionDetails');
  };

  const handlePress = () => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    const now = Date.now();
    if (now - lastTapAt.current <= DOUBLE_TAP_DELAY) {
      lastTapAt.current = 0;
      openOverlay('reactions');
      return;
    }
    lastTapAt.current = now;
  };

  const handleLongPress = () => {
    longPressTriggered.current = true;
    lastTapAt.current = 0;
    openOverlay('actions');
  };

  const chooseReaction = (emoji: string) => {
    if (!canChangeMessage || offline) return;
    void Haptics.selectionAsync();
    onReact(emoji);
    closeOverlay();
  };

  const submitCustom = () => {
    const emoji = customEmoji.trim();
    if (!emoji) return;
    chooseReaction(emoji);
  };

  const copyMessage = async () => {
    try {
      const copied = await Clipboard.setStringAsync(message.body);
      if (!copied) {
        setCopyState('failed');
        return;
      }
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      setCopyState('copied');
      copyCloseTimer.current = setTimeout(closeOverlay, 650);
    } catch {
      setCopyState('failed');
    }
  };

  const chooseReply = () => {
    closeOverlay();
    onReply();
  };

  const chooseEdit = () => {
    closeOverlay();
    onEdit();
  };

  const confirmUnsend = () => {
    closeOverlay();
    Alert.alert(
      'Unsend message?',
      'This message will be removed for everyone in the conversation.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsend',
          style: 'destructive',
          onPress: onUnsend,
        },
      ],
    );
  };

  const webContextMenuProps =
    Platform.OS === 'web'
      ? {
          onContextMenu: (event: { preventDefault: () => void }) => {
            event.preventDefault();
            openOverlay('actions');
          },
        }
      : {};

  const menuLeft = Math.max(
    SCREEN_EDGE_GAP,
    Math.min(
      mine ? anchor.x + anchor.width - menuWidth : anchor.x,
      windowWidth - menuWidth - SCREEN_EDGE_GAP,
    ),
  );
  const menuTop = Math.max(
    SCREEN_EDGE_GAP,
    anchor.y - menuHeight - MENU_GAP,
  );

  return (
    <>
      <View
        style={[
          styles.messageColumn,
          mine ? styles.messageColumnMine : styles.messageColumnTheirs,
        ]}>
        <Pressable
          ref={bubbleRef}
          accessibilityRole="button"
          accessibilityLabel={`${accessibleBody}. ${deliveryTimeLabel} ${formatMessageTime(
            message.createdAt,
          )}${deliveryDescription ? `. ${deliveryDescription}` : ''}`}
          accessibilityHint={
            offline
              ? 'Press and hold for available message actions. Reactions, edits, and unsend require a connection.'
              : 'Double tap to react. Press and hold for message actions.'
          }
          accessibilityActions={[
            { name: 'activate', label: 'Open reactions' },
            { name: 'longpress', label: 'Open message actions' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate') {
              openOverlay('reactions');
            } else if (event.nativeEvent.actionName === 'longpress') {
              openOverlay('actions');
            }
          }}
          delayLongPress={LONG_PRESS_DELAY}
          onPressIn={() => {
            longPressTriggered.current = false;
          }}
          onPress={handlePress}
          onLongPress={handleLongPress}
          {...webContextMenuProps}
          style={[
            styles.bubble,
            webBubbleInteractionStyle,
            mine ? styles.bubbleOutgoing : styles.bubbleIncoming,
            queued && styles.bubblePending,
            failed && styles.bubbleFailed,
          ]}>
          {message.replyToId ? (
            <View style={styles.replyPreview}>
              <Text selectable={false} style={styles.replyPreviewLabel}>
                REPLY
              </Text>
              <Text
                selectable={false}
                numberOfLines={2}
                style={styles.replyPreviewBody}>
                {replyToMessage?.body.trim() ||
                  (replyToMessage?.media
                    ? replyToMessage.media.mimeType === 'image/gif'
                      ? 'GIF'
                      : 'Photo'
                    : 'Message no longer available')}
              </Text>
            </View>
          ) : null}
          {message.media ? (
            <Image
              accessibilityLabel={mediaLabel}
              source={{ uri: message.media.url }}
              style={[
                styles.messageMedia,
                { width: mediaWidth, height: mediaHeight },
              ]}
              contentFit="cover"
              transition={120}
            />
          ) : null}
          {message.body ? (
            <Text
              selectable={false}
              style={[
                styles.bubbleText,
                mine && styles.textMine,
                message.media && styles.mediaCaption,
              ]}>
              {message.body}
            </Text>
          ) : null}
          <Text
            selectable={false}
            style={[styles.timestamp, mine && styles.timestampMine]}>
            {message.deliveryState === 'sent' ? 'SENT · ' : ''}
            {message.editedAt ? 'EDITED · ' : ''}
            {formatMessageTime(message.createdAt)}
          </Text>
        </Pressable>

        {failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              offline
                ? 'Message not sent. Reconnect, then retry.'
                : 'Message not sent. Retry now.'
            }
            accessibilityHint={
              offline
                ? 'Reconnect before retrying this message.'
                : 'Attempts to send this message again.'
            }
            accessibilityState={{ disabled: offline }}
            disabled={offline}
            onPress={() => void syncNow()}
            hitSlop={8}>
            <Text style={[styles.deliveryStatus, styles.deliveryFailed]}>
              {offline
                ? 'NOT SENT · RECONNECT, THEN TAP TO RETRY'
                : 'NOT SENT · TAP TO RETRY'}
            </Text>
          </Pressable>
        ) : queued ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.deliveryStatus}>
            {offline
              ? 'OFFLINE · QUEUED · SENDS AUTOMATICALLY'
              : 'QUEUED · SENDS AUTOMATICALLY'}
          </Text>
        ) : null}

        {summaries.length > 0 ? (
          <View
            style={[
              styles.reactionSummary,
              mine && styles.reactionSummaryMine,
            ]}>
            {summaries.map((reaction) => (
              <ReactionChip
                key={reaction.emoji}
                reaction={reaction}
                disabled={offline}
                onPress={() => chooseReaction(reaction.emoji)}
                onShowDetails={openReactionDetails}
              />
            ))}
          </View>
        ) : null}
      </View>

      <Modal
        visible={overlayMode !== null}
        transparent
        animationType="fade"
        onRequestClose={closeOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeOverlay}>
            {overlayMode === 'reactions' ? (
              <Pressable
                accessibilityRole="none"
                onPress={(event) => event.stopPropagation()}
                style={[
                  styles.reactionMenu,
                  { left: menuLeft, top: menuTop },
                ]}>
                {offline ? (
                  <Text style={styles.offlineReactionNotice}>
                    OFFLINE · REACTIONS REQUIRE A CONNECTION
                  </Text>
                ) : !addingCustom ? (
                  <>
                    {QUICK_REACTIONS.map((emoji) => (
                      <Pressable
                        key={emoji}
                        accessibilityRole="button"
                        accessibilityLabel={`React with ${emoji}`}
                        onPress={() => chooseReaction(emoji)}
                        style={[
                          styles.quickReaction,
                          reactedWith.has(emoji) && styles.quickReactionSelected,
                        ]}>
                        <Text style={styles.quickReactionEmoji}>{emoji}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add a different emoji"
                      onPress={() => setAddingCustom(true)}
                      style={styles.quickReaction}>
                      <Text style={styles.addReaction}>＋</Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.customReactionRow}>
                    <TextInput
                      autoFocus
                      value={customEmoji}
                      onChangeText={setCustomEmoji}
                      onSubmitEditing={submitCustom}
                      maxLength={16}
                      returnKeyType="done"
                      keyboardAppearance="dark"
                      placeholder="Emoji"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                      style={styles.emojiInput}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add emoji reaction"
                      disabled={!customEmoji.trim()}
                      onPress={submitCustom}
                      style={[
                        styles.addCustomButton,
                        !customEmoji.trim() && styles.addCustomButtonDisabled,
                      ]}>
                      <Text style={styles.addCustomLabel}>ADD</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            ) : null}

            {overlayMode === 'actions' ? (
              <Pressable
                accessibilityRole="none"
                onPress={(event) => event.stopPropagation()}
                style={[
                  styles.actionMenu,
                  {
                    height: actionMenuHeight,
                    left: menuLeft,
                    top: menuTop,
                  },
                ]}>
                {canChangeMessage ? (
                  <MessageAction label="REPLY" onPress={chooseReply} />
                ) : null}
                <MessageAction
                  label={
                    copyState === 'copied'
                      ? 'COPIED'
                      : copyState === 'failed'
                        ? 'COPY FAILED'
                        : 'COPY'
                  }
                  error={copyState === 'failed'}
                  last={!canChangeMessage || !mine}
                  onPress={() => void copyMessage()}
                />
                {mine && canChangeMessage ? (
                  <>
                    <MessageAction
                      label={offline ? 'UNSEND · OFFLINE' : 'UNSEND'}
                      destructive
                      disabled={offline}
                      last={!canEditMessage}
                      onPress={confirmUnsend}
                    />
                    {canEditMessage ? (
                      <MessageAction
                        label={offline ? 'EDIT · OFFLINE' : 'EDIT'}
                        disabled={offline}
                        onPress={chooseEdit}
                        last
                      />
                    ) : null}
                  </>
                ) : null}
              </Pressable>
            ) : null}

            {overlayMode === 'reactionDetails' ? (
              <Pressable
                accessibilityRole="none"
                onPress={(event) => event.stopPropagation()}
                style={[
                  styles.reactionDetails,
                  {
                    height: reactionDetailsHeight,
                    left: menuLeft,
                    top: menuTop,
                  },
                ]}>
                <View style={styles.reactionDetailsHeader}>
                  <Text style={styles.reactionDetailsTitle}>REACTIONS</Text>
                  <Text style={styles.reactionDetailsCount}>
                    {message.reactions.length}
                  </Text>
                </View>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={styles.reactionDetailsScroll}>
                  {reactionUsers.map((user) => (
                    <View
                      key={user.participantId}
                      style={styles.reactionUserRow}>
                      <Text numberOfLines={1} style={styles.reactionUserName}>
                        {user.name}
                      </Text>
                      <Text style={styles.reactionUserEmojis}>
                        {user.emojis.join('  ')}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </Pressable>
            ) : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function ReactionChip({
  reaction,
  disabled = false,
  onPress,
  onShowDetails,
}: {
  reaction: ReactionSummary;
  disabled?: boolean;
  onPress: () => void;
  onShowDetails: (anchor: {
    x: number;
    y: number;
    width: number;
  }) => void;
}) {
  const chipRef = React.useRef<View>(null);
  const held = React.useRef(false);

  const showDetails = () => {
    held.current = true;
    chipRef.current?.measureInWindow((x, y, width) => {
      onShowDetails({ x, y, width });
    });
  };

  const webContextMenuProps =
    Platform.OS === 'web'
      ? {
          onContextMenu: (event: { preventDefault: () => void }) => {
            event.preventDefault();
            showDetails();
          },
        }
      : {};

  return (
    <Pressable
      ref={chipRef}
      accessibilityRole="button"
      accessibilityLabel={`${reaction.emoji}, ${reaction.count} ${
        reaction.count === 1 ? 'reaction' : 'reactions'
      }`}
      accessibilityHint={
        disabled
          ? 'Reaction changes require a connection. Press and hold to see who reacted.'
          : 'Tap to toggle. Press and hold to see who reacted.'
      }
      accessibilityActions={[
        { name: 'activate', label: 'Toggle reaction' },
        { name: 'longpress', label: 'Show reaction details' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') {
          if (!disabled) onPress();
        } else if (event.nativeEvent.actionName === 'longpress') {
          showDetails();
        }
      }}
      delayLongPress={LONG_PRESS_DELAY}
      onPressIn={() => {
        held.current = false;
      }}
      onLongPress={showDetails}
      onPress={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        if (!disabled) onPress();
      }}
      {...webContextMenuProps}
      style={[
        styles.reactionChip,
        reaction.reactedByMe && styles.reactionChipMine,
        disabled && styles.reactionChipDisabled,
      ]}>
      <Text selectable={false} style={styles.reactionEmoji}>
        {reaction.emoji}
      </Text>
      <Text selectable={false} style={styles.reactionCount}>
        {reaction.count}
      </Text>
    </Pressable>
  );
}

function MessageAction({
  label,
  destructive = false,
  error = false,
  disabled = false,
  last = false,
  onPress,
}: {
  label: string;
  destructive?: boolean;
  error?: boolean;
  disabled?: boolean;
  last?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      accessibilityState={{ disabled }}
      accessibilityHint={
        disabled ? 'Reconnect to use this message action.' : undefined
      }
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.messageAction,
        !last && styles.messageActionDivider,
      ]}>
      <Text
        style={[
          styles.messageActionLabel,
          destructive && styles.messageActionDestructive,
          error && styles.messageActionError,
          disabled && styles.messageActionDisabled,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  messageColumn: {
    maxWidth: '82%',
    flexShrink: 1,
    gap: 5,
  },
  messageColumnMine: {
    alignItems: 'flex-end',
  },
  messageColumnTheirs: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '100%',
    minWidth: 76,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    userSelect: 'none',
  },
  bubbleIncoming: {
    backgroundColor: '#1c211e',
  },
  bubbleOutgoing: {
    backgroundColor: '#1e3629',
  },
  bubblePending: {
    opacity: 0.55,
  },
  bubbleFailed: {
    opacity: 0.78,
    borderWidth: 1,
    borderColor: 'rgba(255,157,157,0.35)',
  },
  deliveryStatus: {
    paddingHorizontal: 3,
    fontFamily: fonts.bold,
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.4,
    color: '#ffcf8b',
  },
  deliveryFailed: {
    color: '#ff9d9d',
  },
  replyPreview: {
    marginBottom: 10,
    paddingLeft: 9,
    borderLeftWidth: 2,
    borderLeftColor: '#7bffb2',
    gap: 3,
  },
  replyPreviewLabel: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.7,
    color: '#7bffb2',
  },
  replyPreviewBody: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.48)',
  },
  bubbleText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#ffffff',
  },
  messageMedia: {
    maxWidth: '100%',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  mediaCaption: {
    marginTop: 9,
  },
  textMine: {
    textAlign: 'right',
  },
  timestamp: {
    marginTop: 7,
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.4,
    color: 'rgba(255,255,255,0.32)',
  },
  timestampMine: {
    textAlign: 'right',
  },
  reactionSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  reactionSummaryMine: {
    justifyContent: 'flex-end',
  },
  reactionChip: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(40,49,43,0.72)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionChipMine: {
    borderColor: 'rgba(123,255,178,0.48)',
    backgroundColor: 'rgba(30,54,41,0.92)',
  },
  reactionChipDisabled: {
    opacity: 0.55,
  },
  offlineReactionNotice: {
    flex: 1,
    paddingHorizontal: 18,
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 9,
    lineHeight: 14,
    color: '#ffcf8b',
  },
  reactionEmoji: {
    fontSize: 15,
  },
  reactionCount: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.72)',
  },
  reactionDetails: {
    position: 'absolute',
    width: REACTION_DETAILS_WIDTH,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(40,49,43,0.97)',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  reactionDetailsHeader: {
    height: REACTION_DETAILS_HEADER_HEIGHT,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reactionDetailsTitle: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.9,
    color: 'rgba(255,255,255,0.82)',
  },
  reactionDetailsCount: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#7bffb2',
  },
  reactionDetailsScroll: {
    flex: 1,
  },
  reactionUserRow: {
    height: REACTION_DETAILS_ROW_HEIGHT,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reactionUserName: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.74)',
  },
  reactionUserEmojis: {
    fontSize: 18,
  },
  modalRoot: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  reactionMenu: {
    position: 'absolute',
    width: REACTION_MENU_WIDTH,
    height: REACTION_MENU_HEIGHT,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(40,49,43,0.96)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  actionMenu: {
    position: 'absolute',
    width: ACTION_MENU_WIDTH,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(40,49,43,0.97)',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  messageAction: {
    height: ACTION_ROW_HEIGHT,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  messageActionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  messageActionLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.9,
    color: 'rgba(255,255,255,0.82)',
  },
  messageActionDestructive: {
    color: '#ff9d9d',
  },
  messageActionError: {
    color: '#ff9d9d',
  },
  messageActionDisabled: {
    color: 'rgba(255,255,255,0.34)',
  },
  quickReaction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickReactionSelected: {
    backgroundColor: 'rgba(123,255,178,0.18)',
  },
  quickReactionEmoji: {
    fontSize: 24,
  },
  addReaction: {
    fontFamily: fonts.regular,
    fontSize: 28,
    lineHeight: 31,
    color: '#ffffff',
  },
  customReactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emojiInput: {
    width: 112,
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(19,23,21,0.72)',
    color: '#ffffff',
    fontSize: 20,
  },
  addCustomButton: {
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7bffb2',
  },
  addCustomButtonDisabled: {
    opacity: 0.35,
  },
  addCustomLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.7,
    color: '#131715',
  },
});
