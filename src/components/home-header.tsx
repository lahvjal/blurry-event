import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FLOATING_GLASS_BLUR_INTENSITY,
  FLOATING_GLASS_TINT,
  LiquidGlassSurface,
} from '@/components/liquid-glass';
import { fonts } from '@/constants/theme';

const logo = require('@/assets/figma/logo-small.svg');
const bell = require('@/assets/figma/notification-bell.svg');

const HEADER_HEIGHT = 54;

export const HOME_HERO_TOP_OFFSET = 74;

export function HomeHeader({
  stuck,
  unread,
  onPressNotifications,
}: {
  stuck: boolean;
  unread: number;
  onPressNotifications: () => void;
}) {
  const insets = useSafeAreaInsets();
  const glassOpacity = useSharedValue(stuck ? 1 : 0);

  React.useEffect(() => {
    glassOpacity.value = withTiming(stuck ? 1 : 0, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [glassOpacity, stuck]);

  const animatedGlassStyle = useAnimatedStyle(() => ({
    opacity: glassOpacity.value,
  }));
  const animatedBarStyle = useAnimatedStyle(() => ({
    paddingHorizontal: interpolate(
      glassOpacity.value,
      [0, 1],
      [7, 20],
    ),
  }));

  const contents = (
    <>
      <Image source={logo} style={styles.logo} contentFit="contain" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          unread > 0
            ? `Notifications, ${unread} unread`
            : 'Notifications'
        }
        hitSlop={8}
        style={styles.bellButton}
        onPress={onPressNotifications}>
        <Image source={bell} style={styles.bell} contentFit="contain" />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>
    </>
  );

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + 8 }]}>
      <Animated.View style={[styles.bar, animatedBarStyle]}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, animatedGlassStyle]}>
          <LiquidGlassSurface
            style={StyleSheet.absoluteFill}
            tintColor={FLOATING_GLASS_TINT}
            blurIntensity={FLOATING_GLASS_BLUR_INTENSITY}
            interactive
          />
        </Animated.View>
        {contents}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 13,
    right: 13,
    zIndex: 30,
  },
  bar: {
    height: HEADER_HEIGHT,
    borderRadius: 70,
    overflow: 'hidden',
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    width: 38.9,
    height: 38.2,
  },
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bell: {
    width: 24,
    height: 24,
  },
  badge: {
    position: 'absolute',
    top: 1,
    right: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    lineHeight: 13,
    color: '#ffffff',
  },
});
