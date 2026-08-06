import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FLOATING_SCRIM_RISE,
  FloatingBackdrop,
} from '@/components/floating-backdrop';
import { FloatingGradientStroke } from '@/components/floating-gradient-stroke';
import {
  FLOATING_GLASS_BLUR_INTENSITY,
  FLOATING_GLASS_TINT,
  LiquidGlassSurface,
} from '@/components/liquid-glass';
import { fonts } from '@/constants/theme';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { ChatMessageMediaDraft } from '@/state/types';

const composerPlus = require('@/assets/figma/composer-plus.svg');
const sendActive = require('@/assets/figma/send-active.svg');

const BAR_HORIZONTAL_INSET = 13;
const BAR_TOP_INSET = 3;
const BAR_PADDING = 12;
const ACTION_HEIGHT = 40;
const INPUT_TOP_INSET = 8;
const INPUT_ACTION_GAP = 20;
const MIN_INPUT_HEIGHT = 16;
const MAX_INPUT_HEIGHT = 64;
const CONTEXT_HEIGHT = 48;
const ATTACHMENT_SECTION_HEIGHT = 100;
const OFFLINE_FEEDBACK_HEIGHT = 58;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const BAR_FIXED_HEIGHT =
  BAR_PADDING * 2 + INPUT_TOP_INSET + INPUT_ACTION_GAP + ACTION_HEIGHT;

/** Single-line wrapper before a device safe-area adjustment. */
export const DEFAULT_MESSAGE_COMPOSER_HEIGHT =
  BAR_TOP_INSET + BAR_FIXED_HEIGHT + MIN_INPUT_HEIGHT + 16;

export type MessageComposerContext = {
  kind: 'reply' | 'edit';
  messageId: string;
  body: string;
};

/**
 * Navigation / Floating — Figma's multi-line message-input variant. The whole
 * composer is a glass panel with a text row above its two 40px actions, and it
 * floats over the thread with the same progressive backdrop as the main nav.
 */
export function MessageComposer({
  onSend,
  onHeightChange,
  context,
  onCancelContext,
  disabledReason,
}: {
  onSend?: (
    text: string,
    attachment: ChatMessageMediaDraft | null,
  ) => boolean | void | Promise<boolean | void>;
  onHeightChange?: (height: number) => void;
  context?: MessageComposerContext | null;
  onCancelContext?: () => void;
  /** Used when the thread itself cannot be created without a connection. */
  disabledReason?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const offline = useBrowserDefinitelyOffline();
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const [attachment, setAttachment] =
    useState<ChatMessageMediaDraft | null>(null);
  const [sending, setSending] = useState(false);
  const hasContent = text.trim().length > 0 || attachment !== null;
  const inputRef = useRef<TextInput>(null);
  const sendingRef = useRef(false);
  const offlineBlockReason =
    disabledReason ??
    (offline && context?.kind === 'edit'
      ? 'Editing a message requires a connection. Reconnect to continue.'
      : offline && attachment
        ? 'Photos require a connection. Remove the attachment to queue the text, or reconnect to send both.'
        : null);
  const offlineMessage = offline
    ? offlineBlockReason ??
      'Text messages are saved on this device and sent automatically when you reconnect. Photos, edits, deletes, and reactions need a connection.'
    : null;
  const sendBlocked = Boolean(offlineBlockReason);
  const bottomInset = Math.max(16, insets.bottom + 6);
  // Fixed space around the measured text: panel padding, the 8px text inset,
  // the 20px action gap, and the 40px action row.
  const barHeight =
    BAR_FIXED_HEIGHT +
    inputHeight +
    (context ? CONTEXT_HEIGHT : 0) +
    (attachment ? ATTACHMENT_SECTION_HEIGHT : 0) +
    (offlineMessage ? OFFLINE_FEEDBACK_HEIGHT : 0);
  const composerHeight = BAR_TOP_INSET + barHeight + bottomInset;
  const scrimHeight = composerHeight + FLOATING_SCRIM_RISE;

  React.useEffect(() => {
    if (!context) return;
    if (context.kind === 'edit') {
      setText(context.body);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [context?.kind, context?.messageId]);

  const send = async () => {
    if (!hasContent || sendingRef.current || sendBlocked) return;
    sendingRef.current = true;
    Keyboard.dismiss();
    setSending(true);
    try {
      const accepted = await onSend?.(text.trim(), attachment);
      if (accepted === false) {
        Alert.alert(
          attachment ? 'Photo not sent' : 'Message not sent',
          'Please try again.',
        );
        return;
      }
      setText('');
      setAttachment(null);
    } catch (caught) {
      const message =
        caught && typeof caught === 'object' && 'message' in caught
          ? String((caught as { message: unknown }).message)
          : attachment
            ? 'The photo could not be prepared or uploaded.'
            : 'The message could not be sent.';
      Alert.alert(attachment ? 'Photo not sent' : 'Message not sent', message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const cancelContext = () => {
    if (context?.kind === 'edit') setText('');
    onCancelContext?.();
  };

  const pickMedia = async () => {
    if (context?.kind === 'edit' || sending || offline) return;
    try {
      if (Platform.OS !== 'web') {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Photo access needed',
            'Allow photo access in Settings to share photos and GIFs.',
          );
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const gif =
        asset.mimeType?.toLowerCase() === 'image/gif' ||
        asset.fileName?.toLowerCase().endsWith('.gif');
      const selectionLimit = gif
        ? MAX_ATTACHMENT_BYTES
        : 40 * 1024 * 1024;
      if (asset.fileSize !== undefined && asset.fileSize > selectionLimit) {
        Alert.alert(
          'Image too large',
          gif
            ? 'Choose a GIF smaller than 15 MB.'
            : 'Choose a photo smaller than 40 MB.',
        );
        return;
      }

      setAttachment({
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName ?? null,
        fileSize: asset.fileSize ?? null,
        webFile: asset.file ?? null,
      });
    } catch (caught) {
      Alert.alert(
        'Could not add image',
        (caught as { message?: string })?.message ??
          'Try choosing that photo or GIF again.',
      );
    }
  };

  const attachmentIsGif =
    attachment?.mimeType?.toLowerCase() === 'image/gif' ||
    attachment?.fileName?.toLowerCase().endsWith('.gif');

  return (
    <View
      style={styles.host}
      pointerEvents="box-none"
      onLayout={() => onHeightChange?.(composerHeight)}>
      <FloatingBackdrop height={scrimHeight} />

      <View
        style={[
          styles.wrapper,
          {
            paddingBottom: bottomInset,
            paddingHorizontal: BAR_HORIZONTAL_INSET,
            paddingTop: BAR_TOP_INSET,
          },
        ]}
        pointerEvents="box-none">
        {/* The full glass panel focuses the input, matching the single large
            hit target in the Figma component. */}
        <Pressable
          style={styles.barHit}
          onPress={() => inputRef.current?.focus()}>
          <View style={[styles.barFrame, { height: barHeight }]}>
            <LiquidGlassSurface
              style={[styles.bar, { height: barHeight }]}
              tintColor={FLOATING_GLASS_TINT}
              blurIntensity={FLOATING_GLASS_BLUR_INTENSITY}
              interactive
              dataSet={{ focusRing: 'true' }}>
            {context ? (
              <View style={styles.contextRow}>
                <View style={styles.contextCopy}>
                  <Text style={styles.contextLabel}>
                    {context.kind === 'edit'
                      ? 'EDITING MESSAGE'
                      : 'REPLYING TO MESSAGE'}
                  </Text>
                  <Text numberOfLines={1} style={styles.contextBody}>
                    {context.body}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    context.kind === 'edit' ? 'Cancel edit' : 'Cancel reply'
                  }
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    cancelContext();
                  }}
                  style={styles.contextClose}>
                  <Text style={styles.contextCloseLabel}>×</Text>
                </Pressable>
              </View>
            ) : null}

            {offlineMessage ? (
              <View
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                accessibilityLabel={`You're offline. ${offlineMessage}`}
                style={styles.offlineFeedback}>
                <View style={styles.offlineDot} />
                <View style={styles.offlineCopy}>
                  <Text style={styles.offlineLabel}>YOU’RE OFFLINE</Text>
                  <Text numberOfLines={2} style={styles.offlineText}>
                    {offlineMessage}
                  </Text>
                </View>
              </View>
            ) : null}

            {attachment ? (
              <View style={styles.attachmentRow}>
                <Image
                  source={{ uri: attachment.uri }}
                  style={styles.attachmentPreview}
                  contentFit="cover"
                />
                <View style={styles.attachmentCopy}>
                  <Text style={styles.attachmentLabel}>
                    {attachmentIsGif ? 'GIF' : 'PHOTO'}
                  </Text>
                  <Text style={styles.attachmentReady}>READY TO SEND</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove attachment"
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    setAttachment(null);
                  }}
                  style={styles.attachmentRemove}>
                  <Text style={styles.attachmentRemoveLabel}>×</Text>
                </Pressable>
              </View>
            ) : null}

            <View
              style={[
                styles.inputRow,
                { height: inputHeight + INPUT_TOP_INSET },
              ]}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder={
                  context?.kind === 'edit' ? 'Edit message...' : 'Add text...'
                }
                placeholderTextColor="#5b645b"
                style={[styles.input, { height: inputHeight }]}
                dataSet={{ skipRing: 'true' }}
                multiline
                scrollEnabled={inputHeight >= MAX_INPUT_HEIGHT}
                textAlignVertical="top"
                onContentSizeChange={(event) => {
                  const nextHeight = Math.max(
                    MIN_INPUT_HEIGHT,
                    Math.min(
                      MAX_INPUT_HEIGHT,
                      event.nativeEvent.contentSize.height,
                    ),
                  );
                  setInputHeight(nextHeight);
                }}
              />
            </View>

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add photo or GIF"
                accessibilityHint={
                  offline
                    ? 'Photo sharing requires an internet connection.'
                    : undefined
                }
                accessibilityState={{
                  disabled: context?.kind === 'edit' || sending || offline,
                }}
                disabled={context?.kind === 'edit' || sending || offline}
                onPress={(event) => {
                  event.stopPropagation();
                  void pickMedia();
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  pressed && styles.pressed,
                  (context?.kind === 'edit' || sending || offline) &&
                    styles.actionDisabled,
                ]}>
                <Image
                  source={composerPlus}
                  style={styles.actionIcon}
                  contentFit="contain"
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityHint={offlineBlockReason ?? undefined}
                accessibilityState={{
                  disabled: !hasContent || sending || sendBlocked,
                  busy: sending,
                }}
                disabled={!hasContent || sending || sendBlocked}
                onPressIn={(event) => {
                  if (Platform.OS !== 'web') return;
                  // Mobile browsers can resize the viewport as the text input
                  // blurs, moving the button before the click finishes. Start
                  // the send on pointer-down; sendingRef prevents the later
                  // onPress callback from submitting it twice.
                  event.stopPropagation();
                  void send();
                }}
                onPress={(event) => {
                  event.stopPropagation();
                  void send();
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  pressed && styles.pressed,
                  (!hasContent || sending || sendBlocked) &&
                    styles.actionDisabled,
                ]}>
                {sending ? (
                  <View style={styles.actionIcon}>
                    <ActivityIndicator color="#7bffb2" />
                  </View>
                ) : (
                  <Image
                    source={sendActive}
                    style={styles.actionIcon}
                    contentFit="contain"
                  />
                )}
              </Pressable>
            </View>
            </LiquidGlassSurface>
            <FloatingGradientStroke borderRadius={20} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  wrapper: {
    position: 'relative',
  },
  barHit: {
    width: '100%',
  },
  barFrame: {
    width: '100%',
    borderRadius: 20,
  },
  bar: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    padding: BAR_PADDING,
  },
  inputRow: {
    paddingTop: INPUT_TOP_INSET,
  },
  contextRow: {
    height: CONTEXT_HEIGHT,
    marginHorizontal: -BAR_PADDING,
    marginTop: -BAR_PADDING,
    marginBottom: BAR_PADDING,
    paddingHorizontal: BAR_PADDING,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  offlineFeedback: {
    height: OFFLINE_FEEDBACK_HEIGHT,
    marginHorizontal: -BAR_PADDING,
    marginTop: -BAR_PADDING,
    marginBottom: BAR_PADDING,
    paddingHorizontal: BAR_PADDING,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,207,139,0.18)',
    backgroundColor: 'rgba(255,207,139,0.055)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffcf8b',
  },
  offlineCopy: {
    flex: 1,
    gap: 2,
  },
  offlineLabel: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.7,
    color: '#ffcf8b',
  },
  offlineText: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.58)',
  },
  contextCopy: {
    flex: 1,
    gap: 3,
  },
  contextLabel: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.7,
    color: '#7bffb2',
  },
  contextBody: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.58)',
  },
  contextClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  contextCloseLabel: {
    fontFamily: fonts.regular,
    fontSize: 20,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.72)',
  },
  attachmentRow: {
    height: ATTACHMENT_SECTION_HEIGHT - 12,
    marginBottom: 12,
    padding: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(19,23,21,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attachmentPreview: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  attachmentCopy: {
    flex: 1,
    gap: 4,
  },
  attachmentLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#ffffff',
  },
  attachmentReady: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.5,
    color: '#7bffb2',
  },
  attachmentRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentRemoveLabel: {
    fontFamily: fonts.regular,
    fontSize: 20,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.72)',
  },
  input: {
    width: '100%',
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: '#ffffff',
    padding: 0,
    margin: 0,
  },
  actions: {
    height: ACTION_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: INPUT_ACTION_GAP,
  },
  actionIcon: {
    width: ACTION_HEIGHT,
    height: ACTION_HEIGHT,
  },
  pressed: {
    opacity: 0.72,
  },
  actionDisabled: {
    opacity: 0.4,
  },
});
