import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fonts } from '@/constants/theme';
import {
  clampScoreDialIndex,
  scoreDialDisplayPosition,
  scoreDialIndexForAdjacentTap,
  scoreDialIndexForDrag,
} from '@/lib/score-dial-logic';

/** On-screen size of one number. Purely visual; gesture travel is independent. */
const ITEM_HEIGHT = 150;
const VISIBLE_ITEMS = 3;
const WHEEL_WIDTH = 120;
/** How long a number takes to settle into the center once it wins the detent. */
const SNAP_DURATION = 90;
const isWeb = Platform.OS === 'web';
/** A deliberate vertical move wins the responder over the adjacent tap zones. */
const DRAG_ACTIVATION_DISTANCE = 6;

/**
 * Vertical dial for score entry, opening on the hole's par.
 *
 * The wheel is pinned to whole numbers: it holds still until the drag crosses
 * a detent, then settles the next number into the center, so the dial can never
 * drift or rest between two scores. The visible number above adds one and the
 * visible number below subtracts one when tapped.
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
  const displayValues = useMemo(() => [...values].reverse(), [values]);

  const lastIndex = values.length - 1;
  const clamp = useCallback(
    (i: number) => clampScoreDialIndex(i, lastIndex),
    [lastIndex],
  );
  const startIndex = clamp(initial - min);
  const startPosition = scoreDialDisplayPosition(startIndex, lastIndex);

  const detent = useRef(new Animated.Value(startPosition * ITEM_HEIGHT)).current;
  const wheelY = useMemo(() => Animated.multiply(detent, -1), [detent]);

  const index = useRef(startIndex);
  const [selectedIndex, setSelectedIndex] = useState(startIndex);
  /** Where the dial sat when the finger went down; all travel is measured off it. */
  const dragFrom = useRef(startIndex);

  const snapTo = useCallback(
    (next: number) => {
      const position = scoreDialDisplayPosition(next, lastIndex);
      Animated.timing(detent, {
        toValue: position * ITEM_HEIGHT,
        duration: SNAP_DURATION,
        easing: Easing.out(Easing.cubic),
        // Transform and opacity only, so this rides the UI thread on device.
        // The web has no native driver to fall back from, only a warning.
        useNativeDriver: !isWeb,
      }).start();
    },
    [detent, lastIndex],
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
      setSelectedIndex(next);
      snapTo(next);
      onChangeRef.current(values[next]);
    },
    [snapTo, values],
  );

  const selectAdjacent = useCallback(
    (position: 'above' | 'below') => {
      select(scoreDialIndexForAdjacentTap(index.current, position, lastIndex));
    },
    [lastIndex, select],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Neighbor Pressables own taps. The dial takes over only once movement
        // is clearly a vertical drag, at which point the press is cancelled.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) >= DRAG_ACTIVATION_DISTANCE &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: () => {
          dragFrom.current = index.current;
          // A quick re-grab should start on the exact selected detent, not on
          // an in-flight frame from the previous 90ms settling animation.
          detent.stopAnimation();
          detent.setValue(
            scoreDialDisplayPosition(index.current, lastIndex) * ITEM_HEIGHT,
          );
        },

        // Dragging down pulls the higher visible number from above into the
        // center. The helper clamps every move to the available score range.
        onPanResponderMove: (_event, gesture) => {
          select(scoreDialIndexForDrag(dragFrom.current, gesture.dy, lastIndex));
        },

        onPanResponderRelease: (_event, gesture) => {
          // Velocity never adds a surprise score after the finger lifts; a
          // fast swipe still changes multiple steps through its distance.
          const landed = scoreDialIndexForDrag(
            dragFrom.current,
            gesture.dy,
            lastIndex,
          );
          if (landed === index.current) {
            snapTo(landed);
          } else {
            select(landed);
          }
        },
        onPanResponderTerminate: () => snapTo(index.current),
      }),
    [detent, lastIndex, select, snapTo],
  );

  // A different hole brings a different par with it; move the dial there
  // instead of leaving it on the last hole's number.
  useEffect(() => {
    if (index.current === startIndex) return;
    index.current = startIndex;
    setSelectedIndex(startIndex);
    snapTo(startIndex);
  }, [snapTo, startIndex]);

  const selectedValue = values[selectedIndex];
  const aboveValue = values[selectedIndex + 1];
  const belowValue = values[selectedIndex - 1];

  const onAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === 'increment') {
        selectAdjacent('above');
      } else if (event.nativeEvent.actionName === 'decrement') {
        selectAdjacent('below');
      }
    },
    [selectAdjacent],
  );

  return (
    <View
      style={styles.window}
      // Stops the browser claiming the vertical drag for page scrolling; the
      // app-wide `touch-action: pan-x pan-y` would otherwise win here.
      dataSet={{ dial: 'true' }}
      {...responder.panHandlers}>
      <View
        pointerEvents="none"
        style={styles.selectedBand}
        accessible={false}
        aria-hidden
        importantForAccessibility="no-hide-descendants"
      />
      <Animated.View
        pointerEvents="none"
        accessible={false}
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.wheel, { transform: [{ translateY: wheelY }] }]}>
        {displayValues.map((value, i) => {
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
            outputRange: [0.03, 0.22, 0.42, 1, 0.42, 0.22, 0.03],
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
      {aboveValue !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase score to ${aboveValue}`}
          accessibilityHint="Increases the score by one"
          dataSet={{ focusRing: 'true' }}
          onPress={() => selectAdjacent('above')}
          style={({ pressed }) => [
            styles.tapZone,
            styles.tapZoneAbove,
            pressed && styles.tapZonePressed,
          ]}
        />
      ) : null}
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Score"
        accessibilityHint="Swipe up or down to adjust the score"
        accessibilityValue={{ min, max, now: selectedValue }}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={selectedValue}
        aria-valuetext={`${selectedValue} strokes`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        style={styles.accessibleSelected}
      />
      {belowValue !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease score to ${belowValue}`}
          accessibilityHint="Decreases the score by one"
          dataSet={{ focusRing: 'true' }}
          onPress={() => selectAdjacent('below')}
          style={({ pressed }) => [
            styles.tapZone,
            styles.tapZoneBelow,
            pressed && styles.tapZonePressed,
          ]}
        />
      ) : null}
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
  selectedBand: {
    position: 'absolute',
    zIndex: 0,
    top: ITEM_HEIGHT,
    left: 24,
    right: 24,
    height: ITEM_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.025)',
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
  tapZone: {
    position: 'absolute',
    zIndex: 2,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
  },
  tapZoneAbove: {
    top: 0,
  },
  tapZoneBelow: {
    bottom: 0,
  },
  tapZonePressed: {
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  accessibleSelected: {
    position: 'absolute',
    zIndex: 1,
    top: ITEM_HEIGHT,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
  },
});
