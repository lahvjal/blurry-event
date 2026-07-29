import React from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';

/** Figma's 0.5 px outside stroke. */
export const FLOATING_STROKE_WIDTH = 0.5;

/**
 * The SVG is expanded by the full stroke width. Its rounded-rectangle path is
 * inset by half a stroke, putting the inner edge on the surface boundary and
 * the complete 0.5 px stroke outside it.
 */
export function FloatingGradientStroke({
  borderRadius,
}: {
  borderRadius: number;
}) {
  const gradientId = `floating-stroke-${React.useId().replace(/:/g, '')}`;
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  const measure = React.useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  const halfStroke = FLOATING_STROKE_WIDTH / 2;
  const surfaceWidth = size.width - FLOATING_STROKE_WIDTH * 2;
  const surfaceHeight = size.height - FLOATING_STROKE_WIDTH * 2;
  // React Native clamps a very large borderRadius to half the shortest side,
  // producing a capsule. SVG otherwise interprets rx=999 as a wide ellipse,
  // which makes a long chat header's top and bottom edges bow toward the ends.
  const centerlineRadius =
    Math.max(
      0,
      Math.min(borderRadius, surfaceWidth / 2, surfaceHeight / 2),
    ) + halfStroke;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      onLayout={measure}
      style={styles.outside}>
      {size.width > FLOATING_STROKE_WIDTH &&
      size.height > FLOATING_STROKE_WIDTH ? (
        <Svg width={size.width} height={size.height}>
          <Defs>
            <LinearGradient
              id={gradientId}
              x1="0%"
              y1="41.18%"
              x2="100%"
              y2="58.82%">
              <Stop offset="0%" stopColor="#666666" stopOpacity={1} />
              <Stop offset="50%" stopColor="#000000" stopOpacity={0} />
              <Stop offset="100%" stopColor="#666666" stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect
            x={halfStroke}
            y={halfStroke}
            width={size.width - FLOATING_STROKE_WIDTH}
            height={size.height - FLOATING_STROKE_WIDTH}
            rx={centerlineRadius}
            ry={centerlineRadius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={FLOATING_STROKE_WIDTH}
          />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outside: {
    position: 'absolute',
    zIndex: 1,
    top: -FLOATING_STROKE_WIDTH,
    right: -FLOATING_STROKE_WIDTH,
    bottom: -FLOATING_STROKE_WIDTH,
    left: -FLOATING_STROKE_WIDTH,
  },
});
