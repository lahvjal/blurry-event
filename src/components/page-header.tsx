import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FLOATING_GLASS_BLUR_INTENSITY,
  FLOATING_GLASS_TINT,
  LiquidGlassSurface,
} from '@/components/liquid-glass';
import { fonts } from '@/constants/theme';

const backArrow = require('@/assets/figma/back-arrow.svg');
const moreDots = require('@/assets/figma/more-dots.svg');

/**
 * Header / Page — floating glass pill with back arrow, uppercase title, more menu.
 * Rendered absolutely under the status bar; screens should pad content below it.
 */
export function PageHeader({
  title,
  subtitle,
  onMore,
  onBack,
  floating = true,
  showMore = true,
}: {
  title: string;
  subtitle?: string;
  onMore?: () => void;
  /** Intercepts the back arrow, e.g. to warn about unsaved changes. */
  onBack?: () => void;
  floating?: boolean;
  /** Preserves header balance with an empty spacer when there is no more menu. */
  showMore?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.wrapper,
        floating && { position: 'absolute', top: insets.top, left: 0, right: 0, zIndex: 10 },
      ]}
      pointerEvents="box-none">
      <LiquidGlassSurface
        style={styles.pill}
        tintColor={FLOATING_GLASS_TINT}
        blurIntensity={FLOATING_GLASS_BLUR_INTENSITY}
        interactive>
        <Pressable hitSlop={12} onPress={onBack ?? (() => router.back())}>
          <Image
            source={backArrow}
            style={{ width: 28, height: 12.2 }}
            contentFit="contain"
            tintColor="#ffffff"
          />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {showMore ? (
          <Pressable hitSlop={12} onPress={onMore}>
            <Image
              source={moreDots}
              style={{ width: 28, height: 5 }}
              contentFit="contain"
              tintColor="#ffffff"
            />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </LiquidGlassSurface>
    </View>
  );
}

/** Height to pad below a floating PageHeader (pill + breathing room). */
export const PAGE_HEADER_HEIGHT = 54;

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 20,
  },
  pill: {
    height: 54,
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 18,
    paddingRight: 18,
  },
  titleBlock: {
    alignItems: 'center',
    gap: 5,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#5b645b',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 28,
  },
});
