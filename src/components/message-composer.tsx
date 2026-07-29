import { Image } from 'expo-image';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
}: {
  onSend?: (text: string) => void | Promise<void>;
  onHeightChange?: (height: number) => void;
  context?: MessageComposerContext | null;
  onCancelContext?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const hasText = text.trim().length > 0;
  const inputRef = useRef<TextInput>(null);
  const bottomInset = Math.max(16, insets.bottom + 6);
  // Fixed space around the measured text: panel padding, the 8px text inset,
  // the 20px action gap, and the 40px action row.
  const barHeight =
    BAR_FIXED_HEIGHT + inputHeight + (context ? CONTEXT_HEIGHT : 0);
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
    if (!hasText) return;
    await onSend?.(text.trim());
    setText('');
  };

  const cancelContext = () => {
    if (context?.kind === 'edit') setText('');
    onCancelContext?.();
  };

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
                accessibilityLabel="Add attachment"
                hitSlop={8}
                style={({ pressed }) => pressed && styles.pressed}>
                <Image
                  source={composerPlus}
                  style={styles.actionIcon}
                  contentFit="contain"
                />
              </Pressable>

              <Pressable
                accessibilityLabel="Send message"
                disabled={!hasText}
                onPress={() => void send()}
                hitSlop={8}
                style={({ pressed }) => pressed && styles.pressed}>
                <Image
                  source={sendActive}
                  style={styles.actionIcon}
                  contentFit="contain"
                />
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
});
