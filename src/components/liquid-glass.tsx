import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React from 'react';
import { Platform, StyleProp, View, ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';

const NATIVE_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable();

/** Shared treatment for the composer, floating nav, and sticky home header. */
export const FLOATING_GLASS_TINT = 'rgba(40,49,43,0.5)';
export const FLOATING_GLASS_BLUR_INTENSITY = 100;

/**
 * Floating glass surface (nav bar, page header pill, composer). Uses the
 * real iOS 26 Liquid Glass (UIGlassEffect) where available, tinted to match
 * the design's navGlass color; falls back to a blurred tint elsewhere.
 */
export function LiquidGlassSurface({
  style,
  tintColor = colors.navGlass,
  interactive = false,
  blurIntensity = 20,
  dataSet,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  interactive?: boolean;
  blurIntensity?: number;
  /** Web-only passthrough (e.g. a focus-ring marker for `:focus-within`). */
  dataSet?: Record<string, string>;
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
    <View style={style} dataSet={dataSet}>
      <BlurView
        intensity={blurIntensity}
        tint="dark"
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: tintColor,
          zIndex: -1,
        }}
      />
      {/*
        Children stay direct flex children of the surface. Wrapping them to
        lift them above the blur collapsed every row layout built on one —
        the header pill's back / title / menu, and the composer's input and
        send button — into a single flex item. The blur's negative z-index
        already puts it behind in-flow content, so no wrapper is needed.
      */}
      {children}
    </View>
  );
}
