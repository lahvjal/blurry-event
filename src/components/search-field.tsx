import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { StyleProp, StyleSheet, TextInput, View, ViewStyle, Text } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors, fonts } from '@/constants/theme';

const searchIcon = require('@/assets/figma/search-icon.svg');

/** Bottom-center radial green glow shown while an Input / Field is focused. */
function FocusGlow() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="focusGlow" cx="50%" cy="107%" rx="66%" ry="95%">
          <Stop offset="0" stopColor="#2d503c" stopOpacity="1" />
          <Stop offset="0.5" stopColor="#17281e" stopOpacity="0.5" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#focusGlow)" opacity="0.35" />
    </Svg>
  );
}

/**
 * Input / Field — search and text variants. Idle: dark gradient, muted
 * placeholder. Focused: radial green glow from the bottom edge, white text.
 */
export function SearchField({
  placeholder = 'Search',
  variant = 'search',
  prefix,
  value,
  onChangeText,
  style,
}: {
  placeholder?: string;
  /** 'search' shows the magnifier icon; 'field' is a plain text field. */
  variant?: 'search' | 'field';
  /** Leading label such as "To:" on the new-message screen. */
  prefix?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.root, style]} dataSet={{ focusRing: 'true' }}>
      <LinearGradient colors={['#0f1110', '#111513']} style={StyleSheet.absoluteFill} />
      {focused ? <FocusGlow /> : null}
      <View style={styles.row}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        {variant === 'search' ? (
          <Image
            source={searchIcon}
            style={{ width: 10.1, height: 10.3 }}
            contentFit="contain"
            tintColor={focused ? '#ffffff' : colors.textMuted}
          />
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
          dataSet={{ skipRing: 'true' }}
          selectionColor="#ffffff"
          clearButtonMode="while-editing"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    height: 56,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  prefix: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#ffffff',
    paddingVertical: 0,
  },
});
