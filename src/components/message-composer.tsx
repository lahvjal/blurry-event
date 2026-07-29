import { Image } from 'expo-image';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FLOATING_SCRIM_RISE,
  FloatingBackdrop,
} from '@/components/floating-backdrop';
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
const BAR_FIXED_HEIGHT =
  BAR_PADDING * 2 + INPUT_TOP_INSET + INPUT_ACTION_GAP + ACTION_HEIGHT;

/** Single-line wrapper before a device safe-area adjustment. */
export const DEFAULT_MESSAGE_COMPOSER_HEIGHT =
  BAR_TOP_INSET + BAR_FIXED_HEIGHT + MIN_INPUT_HEIGHT + 16;

/**
 * Navigation / Floating — Figma's multi-line message-input variant. The whole
 * composer is a glass panel with a text row above its two 40px actions, and it
 * floats over the thread with the same progressive backdrop as the main nav.
 */
export function MessageComposer({
  onSend,
  onHeightChange,
}: {
  onSend?: (text: string) => void;
  onHeightChange?: (height: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const hasText = text.trim().length > 0;
  const inputRef = useRef<TextInput>(null);
  const bottomInset = Math.max(16, insets.bottom + 6);
  // Fixed space around the measured text: panel padding, the 8px text inset,
  // the 20px action gap, and the 40px action row.
  const barHeight = BAR_FIXED_HEIGHT + inputHeight;
  const composerHeight = BAR_TOP_INSET + barHeight + bottomInset;
  const scrimHeight = composerHeight + FLOATING_SCRIM_RISE;

  const send = () => {
    if (!hasText) return;
    onSend?.(text.trim());
    setText('');
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
          <LiquidGlassSurface
            style={[styles.bar, { height: barHeight }]}
            tintColor={FLOATING_GLASS_TINT}
            blurIntensity={FLOATING_GLASS_BLUR_INTENSITY}
            interactive
            dataSet={{ focusRing: 'true' }}>
            <View
              style={[
                styles.inputRow,
                { height: inputHeight + INPUT_TOP_INSET },
              ]}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder="Add text..."
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
                onPress={send}
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
  bar: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    padding: BAR_PADDING,
  },
  inputRow: {
    paddingTop: INPUT_TOP_INSET,
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
