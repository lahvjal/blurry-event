import { Image } from 'expo-image';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { LiquidGlassSurface } from '@/components/liquid-glass';
import { colors, fonts } from '@/constants/theme';

const composerPlus = require('@/assets/figma/composer-plus.svg');
const sendIdle = require('@/assets/figma/send-idle.svg');
const sendActive = require('@/assets/figma/send-active.svg');

/**
 * Navigation / Floating — "message input" variant: 32px plus button beside a
 * glass pill input. The send icon activates (green) once text is entered.
 */
export function MessageComposer({
  onSend,
}: {
  onSend?: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [multiline, setMultiline] = useState(false);
  const hasText = text.trim().length > 0;
  const inputRef = useRef<TextInput>(null);

  const send = () => {
    if (!hasText) return;
    onSend?.(text.trim());
    setText('');
  };

  return (
    <View style={styles.row}>
      <Pressable>
        <Image source={composerPlus} style={styles.plus} contentFit="contain" />
      </Pressable>
      {/* Tapping anywhere in the pill (not just the text itself) focuses the
          input — its own box is narrower than the visual field. */}
      <Pressable style={styles.pillHit} onPress={() => inputRef.current?.focus()}>
        {/* Pill is fully rounded while single-line, relaxes to 20 when text wraps */}
        <LiquidGlassSurface
          style={[styles.pill, { borderRadius: multiline ? 20 : 999 }]}
          interactive
          dataSet={{ focusRing: 'true' }}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            dataSet={{ skipRing: 'true' }}
            multiline
            onContentSizeChange={(event) =>
              setMultiline(event.nativeEvent.contentSize.height > 24)
            }
            onSubmitEditing={send}
          />
          <Pressable onPress={send} hitSlop={8}>
            <Image
              source={hasText ? sendActive : sendIdle}
              style={styles.send}
              contentFit="contain"
            />
          </Pressable>
        </LiquidGlassSurface>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 13,
    paddingTop: 3,
  },
  plus: {
    width: 32,
    height: 32,
  },
  pillHit: {
    flex: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
    padding: 8,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: '#ffffff',
    paddingLeft: 10,
    paddingVertical: 8,
    maxHeight: 96,
  },
  send: {
    width: 32,
    height: 32,
  },
});
