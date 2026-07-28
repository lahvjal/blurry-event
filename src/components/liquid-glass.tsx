import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React from 'react';
import { Platform, StyleProp, View, ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';

const NATIVE_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable();

/**
 * Floating glass surface (nav bar, page header pill, composer). Uses the
 * real iOS 26 Liquid Glass (UIGlassEffect) where available, tinted to match
 * the design's navGlass color; falls back to a blurred tint elsewhere.
 */
export function LiquidGlassSurface({
  style,
  tintColor = colors.navGlass,
  interactive = false,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  interactive?: boolean;
  children?: React.ReactNode;
}) {
  if (NATIVE_GLASS) {
    return (
      <GlassView
        style={style}
        glassEffectStyle="clear"
        tintColor={tintColor}
        isInteractive={interactive}>
        {children}
      </GlassView>
    );
  }

  return (
    <View style={style}>
      <BlurView
        intensity={20}
        tint="dark"
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: tintColor,
        }}
      />
      {children}
    </View>
  );
}
