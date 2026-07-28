import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fonts } from '@/constants/theme';

const ITEM_HEIGHT = 150;
const VISIBLE_ITEMS = 3;
const WHEEL_WIDTH = 120;
/** How long a number takes to click into the center once it wins the detent. */
const SNAP_DURATION = 110;
const isWeb = Platform.OS === 'web';
/**
 * The browser says precisely when a scroll — drag, fling or wheel — has come
 * to rest, so the track can be realigned the instant it stops.
 */
const hasScrollEnd =
  isWeb && typeof window !== 'undefined' && 'onscrollend' in window;
/**
 * Fallback for browsers without `scrollend` (iOS 17 and older). react-native-web
 * emits one last scroll event 100ms after the real final one, so wait past that
 * to work from the true resting offset rather than a stale one.
 */
const WEB_SETTLE_DELAY = 140;
/** Sub-pixel drift is already on the detent; correcting it would just loop. */
const ALIGNED = 1;

/**
 * Vertical dial for score entry, opening on the hole's par.
 *
 * The numbers are not carried by the scroll — an invisible scroll view sits on
 * top purely to catch the swipe, and the wheel underneath is pinned to whole
 * numbers. It holds still until the swipe crosses a detent, then clicks the
 * next number into the center with a haptic, so the dial can never drift or
 * rest between two scores.
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
    (index: number) => Math.min(Math.max(index, 0), lastIndex),
    [lastIndex],
  );
  const startIndex = clamp(initial - min);

  const scroller = useRef<ScrollView>(null);
  const detent = useRef(new Animated.Value(startIndex * ITEM_HEIGHT)).current;
  const wheelY = useMemo(() => Animated.multiply(detent, -1), [detent]);

  const offset = useRef(startIndex * ITEM_HEIGHT);
  const index = useRef(startIndex);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touching = useRef(false);
  const parked = useRef(false);

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

  const select = useCallback(
    (next: number) => {
      if (next === index.current) return;
      index.current = next;
      snapTo(next);
      Haptics.selectionAsync();
      onChange(values[next]);
    },
    [onChange, snapTo, values],
  );

  const scrollToIndex = useCallback((next: number) => {
    offset.current = next * ITEM_HEIGHT;
    scroller.current?.scrollTo({ y: next * ITEM_HEIGHT, animated: false });
  }, []);

  // Pull the hidden track back onto the number the wheel is showing. Nothing
  // moves on screen — it just keeps the next swipe measuring from the detent
  // rather than from the slack left over from the last one.
  const settle = useCallback(() => {
    const next = clamp(Math.round(offset.current / ITEM_HEIGHT));
    select(next);
    if (Math.abs(offset.current - next * ITEM_HEIGHT) > ALIGNED) {
      scrollToIndex(next);
    }
  }, [clamp, scrollToIndex, select]);

  const scheduleSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, WEB_SETTLE_DELAY);
  }, [settle]);

  // `contentOffset` only lands on iOS, so park the track on the starting
  // number once the content has been measured — otherwise the first swipe on
  // Android and web is measured from the lowest score instead of from par.
  const park = useCallback(() => {
    if (parked.current) return;
    parked.current = true;
    scrollToIndex(startIndex);
  }, [scrollToIndex, startIndex]);

  // react-native-web ignores `snapToInterval` and never fires the momentum
  // callbacks, so the realignment rides on the DOM's own scroll-end signal.
  useEffect(() => {
    if (!hasScrollEnd) return;
    const node = scroller.current?.getScrollableNode() as HTMLElement | null;
    if (!node) return;
    const onScrollEnd = () => {
      offset.current = node.scrollTop;
      settle();
    };
    node.addEventListener('scrollend', onScrollEnd);
    return () => node.removeEventListener('scrollend', onScrollEnd);
  }, [settle]);

  // A different hole brings a different par with it; move the dial there
  // instead of leaving it on the last hole's number.
  useEffect(() => {
    if (!parked.current || index.current === startIndex) return;
    index.current = startIndex;
    snapTo(startIndex);
    scrollToIndex(startIndex);
  }, [scrollToIndex, snapTo, startIndex]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
    // Halfway between two numbers the next one takes the detent.
    select(clamp(Math.round(offset.current / ITEM_HEIGHT)));
    // Realigning mid-drag would eat part of the swipe, so a held gesture waits
    // and realigns on release instead.
    if (isWeb && !hasScrollEnd && !touching.current) scheduleSettle();
  };

  // Native only: web gets neither of these from react-native-web.
  const handleScrollEndDrag = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    offset.current = event.nativeEvent.contentOffset.y;
    // A release with no throw left in it never produces momentum, so this is
    // the only chance to realign. Anything faster — or a platform that does not
    // report velocity — is left to the momentum handler rather than risk
    // cutting a fling short.
    const velocity = event.nativeEvent.velocity?.y;
    if (velocity != null && Math.abs(velocity) < 0.05) settle();
  };

  const handleMomentumScrollEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    offset.current = event.nativeEvent.contentOffset.y;
    settle();
  };

  const webTouchProps =
    isWeb && !hasScrollEnd
      ? {
          onTouchStart: () => {
            touching.current = true;
            if (settleTimer.current) clearTimeout(settleTimer.current);
          },
          onTouchEnd: () => {
            touching.current = false;
            scheduleSettle();
          },
          onTouchCancel: () => {
            touching.current = false;
            scheduleSettle();
          },
        }
      : null;

  return (
    <View style={styles.window}>
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

      {/* Catches the swipe and nothing else: the numbers live underneath. */}
      <ScrollView
        ref={scroller}
        style={StyleSheet.absoluteFill}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        bounces={false}
        overScrollMode="never"
        contentOffset={{ x: 0, y: startIndex * ITEM_HEIGHT }}
        onContentSizeChange={park}
        onScroll={handleScroll}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        scrollEventThrottle={16}
        {...webTouchProps}
        contentContainerStyle={styles.track}>
        <View style={{ height: values.length * ITEM_HEIGHT }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  window: {
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    width: WHEEL_WIDTH,
    overflow: 'hidden',
  },
  wheel: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Centers the first number in the window; the rest stack below it.
    top: (ITEM_HEIGHT * VISIBLE_ITEMS - ITEM_HEIGHT) / 2,
  },
  track: {
    paddingVertical: ITEM_HEIGHT,
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
