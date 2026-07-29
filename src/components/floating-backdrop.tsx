import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

/** How far above a floating control the progressive blur begins fading in. */
export const FLOATING_SCRIM_RISE = 10;

/**
 * Shared edge treatment for controls that float over scrolling content.
 * The web shell turns the three marked layers into progressively stronger,
 * masked backdrop blurs; the gradient supplies the matching dark fade on every
 * platform. Top mode mirrors the nav/composer treatment for floating headers.
 */
export function FloatingBackdrop({
  height,
  edge = 'bottom',
}: {
  height: number;
  edge?: 'top' | 'bottom';
}) {
  const top = edge === 'top';

  return (
    <View
      style={[
        styles.scrim,
        top ? styles.scrimTop : styles.scrimBottom,
        { height },
      ]}
      pointerEvents="none"
      accessibilityElementsHidden>
      <View
        style={StyleSheet.absoluteFill}
        dataSet={{ navScrim: '1', scrimEdge: edge }}
      />
      <View
        style={StyleSheet.absoluteFill}
        dataSet={{ navScrim: '2', scrimEdge: edge }}
      />
      <View
        style={StyleSheet.absoluteFill}
        dataSet={{ navScrim: '3', scrimEdge: edge }}
      />
      <LinearGradient
        colors={
          top
            ? ['rgba(0,0,0,0.88)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']
            : ['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.88)']
        }
        locations={top ? [0, 0.45, 1] : [0, 0.55, 1]}
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
  },
  scrimTop: {
    top: 0,
  },
  scrimBottom: {
    bottom: 0,
  },
});
