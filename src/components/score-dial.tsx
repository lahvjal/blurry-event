import * as Haptics from 'expo-haptics';
import React, { useMemo, useRef } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fonts } from '@/constants/theme';

const ITEM_HEIGHT = 150;
const VISIBLE_ITEMS = 3;

/**
 * Vertical dial for score entry. Scroll-driven wheel that snaps to each
 * number; neighbors fade and shrink as they leave the center detent, with a
 * selection haptic on every detent crossed.
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

  const startIndex = Math.min(
    Math.max(initial - min, 0),
    values.length - 1,
  );
  const scrollY = useRef(new Animated.Value(startIndex * ITEM_HEIGHT)).current;
  const lastIndex = useRef(startIndex);

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: true,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offset = event.nativeEvent.contentOffset.y;
        const index = Math.min(
          Math.max(Math.round(offset / ITEM_HEIGHT), 0),
          values.length - 1,
        );
        if (index !== lastIndex.current) {
          lastIndex.current = index;
          Haptics.selectionAsync();
          onChange(values[index]);
        }
      },
    },
  );

  return (
    <View style={styles.window}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        bounces={false}
        contentOffset={{ x: 0, y: startIndex * ITEM_HEIGHT }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}>
        {values.map((value, i) => {
          const inputRange = [
            (i - 2) * ITEM_HEIGHT,
            (i - 1) * ITEM_HEIGHT,
            i * ITEM_HEIGHT,
            (i + 1) * ITEM_HEIGHT,
            (i + 2) * ITEM_HEIGHT,
          ];
          const opacity = scrollY.interpolate({
            inputRange,
            outputRange: [0.03, 0.14, 1, 0.14, 0.03],
            extrapolate: 'clamp',
          });
          const scale = scrollY.interpolate({
            inputRange,
            outputRange: [0.68, 0.8, 1, 0.8, 0.68],
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
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  window: {
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    overflow: 'hidden',
  },
  content: {
    paddingVertical: ITEM_HEIGHT,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  number: {
    fontFamily: fonts.serif,
    fontSize: 130,
    lineHeight: 148,
    color: '#ffffff',
    textAlign: 'center',
  },
});
