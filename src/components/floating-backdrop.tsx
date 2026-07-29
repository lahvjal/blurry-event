import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

/** How far above a floating control the progressive blur begins fading in. */
export const FLOATING_SCRIM_RISE = 10;

/**
 * Shared bottom-edge treatment for controls that float over scrolling content.
 * The web shell turns the three marked layers into progressively stronger,
 * masked backdrop blurs; the gradient supplies the matching dark fade on every
 * platform.
 */
export function FloatingBackdrop({ height }: { height: number }) {
  return (
    <View
      style={[styles.scrim, { height }]}
      pointerEvents="none"
      accessibilityElementsHidden>
      <View style={StyleSheet.absoluteFill} dataSet={{ navScrim: '1' }} />
      <View style={StyleSheet.absoluteFill} dataSet={{ navScrim: '2' }} />
      <View style={StyleSheet.absoluteFill} dataSet={{ navScrim: '3' }} />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.88)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
