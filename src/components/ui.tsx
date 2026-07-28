import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ImageBackground,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { colors, fonts } from '@/constants/theme';

const noise = require('@/assets/figma/noise.png');
const chevron = require('@/assets/figma/chevron-right.svg');

/** Grain texture overlay used on gradient panels and screen backgrounds. */
export function Noise({ opacity = 0.04 }: { opacity?: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ImageBackground
        source={noise}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, { opacity }]}
        // Without this the tile layer takes the file's own dimensions, so the
        // grain repeated across a small box and left the rest of a wide screen
        // flat. Filling the layer lets it tile the whole surface.
        imageStyle={styles.tile}
      />
    </View>
  );
}

export function Chevron({
  width = 5,
  height = 10,
  color = '#ffffff',
}: {
  width?: number;
  height?: number;
  color?: string;
}) {
  return (
    <Image
      source={chevron}
      style={{ width, height }}
      contentFit="contain"
      tintColor={color}
    />
  );
}

/** Uppercase muted section label, e.g. "UPCOMING TEE TIMES". */
export function SectionLabel({
  children,
  color = colors.textMuted,
  size = 12,
}: {
  children: React.ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <Text
      style={{
        fontFamily: fonts.bold,
        fontSize: size,
        color,
        textTransform: 'uppercase',
        letterSpacing: 0.2,
      }}>
      {children}
    </Text>
  );
}

/** "SEE ALL >" style inline link. */
export function LinkAction({
  label,
  onPress,
}: {
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={styles.linkAction}>
      <Text style={styles.linkActionText}>{label}</Text>
      <Chevron width={3} height={6} color={colors.link} />
    </Pressable>
  );
}

/** Compact pill status badge, e.g. "CLUB MEMBER". */
export function Badge({
  label,
  color = colors.highlight,
  background = colors.bgElevated,
  style,
  textStyle,
}: {
  label: string;
  color?: string;
  background?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: background }, style]}>
      <Text style={[styles.badgeText, { color }, textStyle]}>{label}</Text>
    </View>
  );
}

/** Gradient panel with grain, square corners (Blurry card base). */
export function GradientPanel({
  colors: gradColors,
  style,
  children,
  noiseOpacity = 0.04,
}: {
  colors: readonly [string, string];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  noiseOpacity?: number;
}) {
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <LinearGradient
        colors={gradColors as [string, string]}
        style={StyleSheet.absoluteFill}
      />
      <Noise opacity={noiseOpacity} />
      {children}
    </View>
  );
}

/** Overlapping avatar stack. */
export function AvatarStack({
  sources,
  size = 26,
  overlap = 10,
}: {
  sources: (number | { uri: string })[];
  size?: number;
  overlap?: number;
}) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {sources.map((src, i) => (
        <Image
          key={i}
          source={src}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            marginLeft: i === 0 ? 0 : -overlap,
            zIndex: sources.length - i,
          }}
        />
      ))}
    </View>
  );
}

/** Row / Info — label-value row for schedules, fees, registration metadata. */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

/** Button / Action — square-corner full-width action. */
export function ActionButton({
  label,
  onPress,
  height = 74,
}: {
  label: string;
  onPress?: () => void;
  height?: number;
}) {
  return (
    <Pressable onPress={onPress}>
      <LinearGradient
        colors={['#151e19', '#0c1611']}
        style={[styles.actionButton, { height }]}>
        <Text style={styles.actionButtonText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '100%',
    height: '100%',
  },
  infoRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  infoValue: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  linkAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkActionText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
    textTransform: 'uppercase',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    textTransform: 'uppercase',
  },
});
