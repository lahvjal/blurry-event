import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fonts } from '@/constants/theme';
import {
  playScoreDialClick,
  prepareScoreDialAudio,
} from '@/lib/score-dial-audio';

/** On-screen size of one number. Purely visual — see STEP for the gesture. */
const ITEM_HEIGHT = 150;
const VISIBLE_ITEMS = 3;
const WHEEL_WIDTH = 120;
/** How long a number takes to click into the center once it wins the detent. */
const SNAP_DURATION = 110;
const isWeb = Platform.OS === 'web';

/**
 * Finger travel per number, deliberately much smaller than ITEM_HEIGHT.
 *
 * Tying the two together meant a whole number cost 150px of drag — about a
 * fifth of the screen — so entering a 7 on a par 4 was a long haul. The wheel
 * still *renders* a number every 150px; only the gesture is scaled.
 */
const STEP = 46;

/**
 * A flick past this speed (px/ms) is read as a throw rather than a drag.
 * Below it, the dial lands exactly where the finger left it.
 */
const FLING_MIN_VELOCITY = 0.4;
/** How much of that speed becomes extra travel. */
const FLING_SCALE = 1.7;
/**
 * Ceiling on a throw. Native momentum had no cap, which is why a small flick
 * could skip several numbers; a score dial wants precision far more than it
 * wants reach, and the whole range is only a dozen values.
 */
const FLING_MAX_STEPS = 3;

/**
 * Vertical dial for score entry, opening on the hole's par.
 *
 * The wheel is pinned to whole numbers: it holds still until the drag crosses
 * a detent, then clicks the next number into the center with a haptic, so the
 * dial can never drift or rest between two scores.
 *
 * The gesture is read directly rather than through a scroll view. A scroll view
 * hands its feel to the browser — and react-native-web ignores `snapToInterval`
 * and `decelerationRate`, so there was no way to stop a light flick from
 * carrying several numbers past the one the golfer wanted.
 */
export function ScoreDial({
  min = 1,
  max = 12,
  initial,
  onChange,
}: {
  min?: number;
  max?: number;
  initial: number;
  onChange: (value: number) => void;
}) {
  const values = useMemo(() => {
    const list: number[] = [];
    for (let v = min; v <= max; v++) list.push(v);
    return list;
  }, [min, max]);

  const lastIndex = values.length - 1;
  const clamp = useCallback(
    (i: number) => Math.min(Math.max(i, 0), lastIndex),
    [lastIndex],
  );
  const startIndex = clamp(initial - min);

  const detent = useRef(new Animated.Value(startIndex * ITEM_HEIGHT)).current;
  const wheelY = useMemo(() => Animated.multiply(detent, -1), [detent]);

  const index = useRef(startIndex);
  /** Where the dial sat when the finger went down; all travel is measured off it. */
  const dragFrom = useRef(startIndex);

  const snapTo = useCallback(
    (next: number) => {
      Animated.timing(detent, {
        toValue: next * ITEM_HEIGHT,
        duration: SNAP_DURATION,
        easing: Easing.out(Easing.cubic),
        // Transform and opacity only, so this rides the UI thread on device.
        // The web has no native driver to fall back from, only a warning.
        useNativeDriver: !isWeb,
      }).start();
    },
    [detent],
  );

  // Keeps the latest callback without rebuilding the responder mid-gesture,
  // which would drop the drag the moment the parent re-rendered.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const select = useCallback(
    (next: number) => {
      if (next === index.current) return;
      index.current = next;
      snapTo(next);
      Haptics.selectionAsync();
      playScoreDialClick();
      onChangeRef.current(values[next]);
    },
    [snapTo, values],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // A couple of pixels of slop, so a tap doesn't register as a drag.
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 2,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: () => {
          prepareScoreDialAudio();
          dragFrom.current = index.current;
        },

        // Dragging up brings higher numbers in from below, so travel is
        // subtracted: dy is positive downward.
        onPanResponderMove: (_event, gesture) => {
          select(clamp(dragFrom.current - Math.round(gesture.dy / STEP)));
        },

        onPanResponderRelease: (_event, gesture) => {
          const landed = clamp(dragFrom.current - Math.round(gesture.dy / STEP));
          if (Math.abs(gesture.vy) < FLING_MIN_VELOCITY) {
            select(landed);
            return;
          }
          const thrown = Math.round(-gesture.vy * FLING_SCALE);
          const capped = Math.max(
            -FLING_MAX_STEPS,
            Math.min(FLING_MAX_STEPS, thrown),
          );
          select(clamp(landed + capped));
        },
      }),
    [clamp, select],
  );

  // A different hole brings a different par with it; move the dial there
  // instead of leaving it on the last hole's number.
  useEffect(() => {
    if (index.current === startIndex) return;
    index.current = startIndex;
    snapTo(startIndex);
  }, [snapTo, startIndex]);

  return (
    <View
      style={styles.window}
      // Stops the browser claiming the vertical drag for page scrolling; the
      // app-wide `touch-action: pan-x pan-y` would otherwise win here.
      dataSet={{ dial: 'true' }}
      {...responder.panHandlers}>
      <Animated.View
        pointerEvents="none"
        style={[styles.wheel, { transform: [{ translateY: wheelY }] }]}>
        {values.map((value, i) => {
          // The half-step stops ease the fade and shrink instead of ramping
          // them straight, so a number blooms as it takes the center.
          const inputRange = [
            (i - 2) * ITEM_HEIGHT,
            (i - 1) * ITEM_HEIGHT,
            (i - 0.5) * ITEM_HEIGHT,
            i * ITEM_HEIGHT,
            (i + 0.5) * ITEM_HEIGHT,
            (i + 1) * ITEM_HEIGHT,
            (i + 2) * ITEM_HEIGHT,
          ];
          const opacity = detent.interpolate({
            inputRange,
            outputRange: [0.03, 0.14, 0.38, 1, 0.38, 0.14, 0.03],
            extrapolate: 'clamp',
          });
          const scale = detent.interpolate({
            inputRange,
            outputRange: [0.68, 0.8, 0.87, 1, 0.87, 0.8, 0.68],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={value}
              style={[styles.item, { opacity, transform: [{ scale }] }]}>
              <Text style={styles.number}>{value}</Text>
            </Animated.View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: {
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    // Full width so the swipe can be started anywhere across the screen —
    // a thumb shouldn't have to find a 120px column mid-round. The numerals
    // stay centered inside it; only the catchment area grows.
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  wheel: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Centers the first number in the window; the rest stack below it.
    top: (ITEM_HEIGHT * VISIBLE_ITEMS - ITEM_HEIGHT) / 2,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: WHEEL_WIDTH,
  },
  number: {
    fontFamily: fonts.serif,
    fontSize: 130,
    lineHeight: 148,
    color: '#ffffff',
    textAlign: 'center',
  },
});
