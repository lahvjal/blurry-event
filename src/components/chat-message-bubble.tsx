import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { fonts } from '@/constants/theme';
import { formatMessageTime } from '@/state/chat';
import { ChatMessage } from '@/state/types';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '⛳️'];
const REACTION_PICKER_WIDTH = 266;
const REACTION_PICKER_HEIGHT = 64;
const REACTION_PICKER_GAP = 10;
const SCREEN_EDGE_GAP = 12;

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
  mine,
  myParticipantId,
  onReact,
}: {
  message: ChatMessage;
  mine: boolean;
  myParticipantId: string;
  onReact: (emoji: string) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const bubbleRef = React.useRef<View>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [addingCustom, setAddingCustom] = React.useState(false);
  const [customEmoji, setCustomEmoji] = React.useState('');
  const [anchor, setAnchor] = React.useState({
    x: SCREEN_EDGE_GAP,
    y: REACTION_PICKER_HEIGHT + SCREEN_EDGE_GAP,
    width: REACTION_PICKER_WIDTH,
  });
  const summaries = summarizeReactions(message, myParticipantId);
  const canReact = !message.pending && !message.id.startsWith('local-');

  const reactedWith = React.useMemo(
    () =>
      new Set(
        message.reactions
          .filter((reaction) => reaction.participantId === myParticipantId)
          .map((reaction) => reaction.emoji),
      ),
    [message.reactions, myParticipantId],
  );

  const closePicker = () => {
    setPickerOpen(false);
    setAddingCustom(false);
    setCustomEmoji('');
  };

  const chooseReaction = (emoji: string) => {
    if (!canReact) return;
    void Haptics.selectionAsync();
    onReact(emoji);
    closePicker();
  };

  const submitCustom = () => {
    const emoji = customEmoji.trim();
    if (!emoji) return;
    chooseReaction(emoji);
  };

  const openPicker = () => {
    if (!canReact) return;
    bubbleRef.current?.measureInWindow((x, y, width) => {
      setAnchor({ x, y, width });
      setPickerOpen(true);
    });
  };

  const pickerLeft = Math.max(
    SCREEN_EDGE_GAP,
    Math.min(
      mine ? anchor.x + anchor.width - REACTION_PICKER_WIDTH : anchor.x,
      windowWidth - REACTION_PICKER_WIDTH - SCREEN_EDGE_GAP,
    ),
  );
  const pickerTop = Math.max(
    SCREEN_EDGE_GAP,
    anchor.y - REACTION_PICKER_HEIGHT - REACTION_PICKER_GAP,
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
          accessibilityLabel={`${message.body}. Sent at ${formatMessageTime(
            message.createdAt,
          )}`}
          accessibilityHint={canReact ? 'Tap to react to this message' : undefined}
          disabled={!canReact}
          onPress={openPicker}
          onLongPress={openPicker}
          style={[
            styles.bubble,
            mine ? styles.bubbleOutgoing : styles.bubbleIncoming,
            message.pending && styles.bubblePending,
          ]}>
          <Text style={[styles.bubbleText, mine && styles.textMine]}>
            {message.body}
          </Text>
          <Text style={[styles.timestamp, mine && styles.timestampMine]}>
            {message.pending ? 'SENDING · ' : ''}
            {formatMessageTime(message.createdAt)}
          </Text>
        </Pressable>

        {summaries.length > 0 ? (
          <View
            style={[
              styles.reactionSummary,
              mine && styles.reactionSummaryMine,
            ]}>
            {summaries.map((reaction) => (
              <Pressable
                key={reaction.emoji}
                accessibilityRole="button"
                accessibilityLabel={`${reaction.emoji}, ${reaction.count} ${
                  reaction.count === 1 ? 'reaction' : 'reactions'
                }`}
                onPress={() => chooseReaction(reaction.emoji)}
                style={[
                  styles.reactionChip,
                  reaction.reactedByMe && styles.reactionChipMine,
                ]}>
                <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                <Text style={styles.reactionCount}>{reaction.count}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={closePicker}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closePicker}>
            <Pressable
              accessibilityRole="none"
              onPress={(event) => event.stopPropagation()}
              style={[
                styles.reactionPicker,
                { left: pickerLeft, top: pickerTop },
              ]}>
              {!addingCustom ? (
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
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
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
  bubbleText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#ffffff',
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
  reactionEmoji: {
    fontSize: 15,
  },
  reactionCount: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.72)',
  },
  modalRoot: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  reactionPicker: {
    position: 'absolute',
    width: REACTION_PICKER_WIDTH,
    height: REACTION_PICKER_HEIGHT,
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
