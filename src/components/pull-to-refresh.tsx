import { useFocusEffect, usePathname } from 'expo-router';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';

type RefreshHandler = () => Promise<void> | void;
type RegisterRefreshHandler = (handler: RefreshHandler) => () => void;

const noopRegister: RegisterRefreshHandler = () => () => {};
const RefreshRegistrationContext =
  createContext<RegisterRefreshHandler>(noopRegister);

const DRAG_START = 6;
const TRIGGER_DISTANCE = 58;
const HOLD_DISTANCE = 58;
const MAX_DISTANCE = 84;
const MIN_REFRESH_VISIBLE_MS = 450;

/**
 * Registers extra data that belongs only to the focused route. Event data is
 * refreshed globally; chat screens use this to add their own conversation
 * reload without teaching the root layout about individual routes.
 */
export function useRefreshOnPull(handler: RefreshHandler): void {
  const register = useContext(RefreshRegistrationContext);

  useFocusEffect(
    useCallback(() => register(handler), [handler, register]),
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    'input, textarea, select, [contenteditable="true"]',
  );
  return editable !== null;
}

function isVerticalScroller(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const overflowY = window.getComputedStyle(element).overflowY;
  const scrollsVertically = overflowY === 'auto' || overflowY === 'scroll';
  return scrollsVertically && element.scrollHeight > element.clientHeight + 1;
}

/**
 * React Native Web keeps scrolling inside nested divs while the document body
 * stays fixed. Look through everything under the finger (including beneath a
 * translucent header) and make sure every relevant scroll area is at its top.
 */
function scrollAreasAtPoint(
  target: EventTarget | null,
  x: number,
  y: number,
): HTMLElement[] {
  const seeds: Element[] = [];
  if (target instanceof Element) seeds.push(target);
  seeds.push(...document.elementsFromPoint(x, y));

  const areas = new Set<HTMLElement>();
  seeds.forEach((seed) => {
    let current: Element | null = seed;
    while (current && current !== document.documentElement) {
      if (isVerticalScroller(current)) areas.add(current);
      current = current.parentElement;
    }
  });
  return [...areas];
}

function canBeginPull(
  target: EventTarget | null,
  x: number,
  y: number,
): boolean {
  return scrollAreasAtPoint(target, x, y).every((area) => area.scrollTop <= 1);
}

export function PullToRefreshProvider({
  children,
  onRefresh,
  excludedPathnames = [],
}: {
  children: React.ReactNode;
  onRefresh: RefreshHandler;
  excludedPathnames?: readonly string[];
}) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const handlersRef = useRef(new Set<RefreshHandler>());
  const gestureRef = useRef({
    eligible: false,
    active: false,
    startX: 0,
    startY: 0,
    distance: 0,
  });
  const refreshingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const excluded = useMemo(
    () => new Set(excludedPathnames),
    [excludedPathnames],
  );
  const enabled =
    Platform.OS === 'web' &&
    ![...excluded].some(
      (excludedPath) =>
        pathname === excludedPath || pathname.endsWith(excludedPath),
    );

  const register = useCallback<RegisterRefreshHandler>((handler) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);

  const runRefresh = useCallback(async () => {
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    setRefreshing(true);
    setPullDistance(HOLD_DISTANCE);

    const handlers = [onRefresh, ...handlersRef.current];
    try {
      await Promise.allSettled(
        [
          ...handlers.map((handler) => Promise.resolve().then(handler)),
          new Promise((resolve) =>
            setTimeout(resolve, MIN_REFRESH_VISIBLE_MS),
          ),
        ],
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setPullDistance(0);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) {
      gestureRef.current.eligible = false;
      gestureRef.current.active = false;
      gestureRef.current.distance = 0;
      if (!refreshingRef.current) setPullDistance(0);
      return;
    }

    const gesture = gestureRef.current;

    const onTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1) {
        gesture.eligible = false;
        return;
      }
      if (isEditable(event.target)) {
        gesture.eligible = false;
        return;
      }

      const touch = event.touches[0];
      gesture.startX = touch.clientX;
      gesture.startY = touch.clientY;
      gesture.distance = 0;
      gesture.active = false;
      gesture.eligible = canBeginPull(
        event.target,
        touch.clientX,
        touch.clientY,
      );
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!gesture.eligible || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;

      if (deltaY <= DRAG_START || Math.abs(deltaX) > deltaY) {
        if (!gesture.active) return;
        gesture.distance = 0;
        setPullDistance(0);
        return;
      }

      gesture.active = true;
      // Once the downward intent is clear, the app owns this gesture instead
      // of letting the inner ScrollView rubber-band under the indicator.
      event.preventDefault();

      const distance = Math.min(
        MAX_DISTANCE,
        (deltaY - DRAG_START) * 0.55,
      );
      gesture.distance = distance;
      setPullDistance(distance);
    };

    const finishGesture = () => {
      if (!gesture.eligible) return;
      const shouldRefresh =
        gesture.active && gesture.distance >= TRIGGER_DISTANCE;

      gesture.eligible = false;
      gesture.active = false;
      gesture.distance = 0;

      if (shouldRefresh) void runRefresh();
      else setPullDistance(0);
    };

    document.addEventListener('touchstart', onTouchStart, {
      capture: true,
      passive: true,
    });
    document.addEventListener('touchmove', onTouchMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener('touchend', finishGesture, {
      capture: true,
      passive: true,
    });
    document.addEventListener('touchcancel', finishGesture, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', finishGesture, true);
      document.removeEventListener('touchcancel', finishGesture, true);
    };
  }, [enabled, runRefresh]);

  const progress = Math.min(1, pullDistance / TRIGGER_DISTANCE);
  const contentOffset = Math.min(20, pullDistance * 0.34);
  const indicatorOffset = -38 + Math.min(48, pullDistance * 0.83);
  const armed = pullDistance >= TRIGGER_DISTANCE;

  return (
    <RefreshRegistrationContext.Provider value={register}>
      <View
        testID="pull-to-refresh-root"
        dataSet={{ enabled: enabled ? 'true' : 'false' }}
        style={styles.shell}>
        <View
          style={[
            styles.content,
            enabled && { transform: [{ translateY: contentOffset }] },
          ]}>
          {children}
        </View>

        {enabled && (pullDistance > 0 || refreshing) ? (
          <View
            testID="pull-to-refresh-indicator"
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            accessibilityLabel={refreshing ? 'Refreshing' : 'Pull to refresh'}
            style={[
              styles.indicatorWrap,
              {
                top: insets.top,
                opacity: Math.max(0.25, progress),
                transform: [{ translateY: indicatorOffset }],
              },
            ]}>
            <View style={styles.indicator}>
              {refreshing ? (
                <ActivityIndicator size="small" color={colors.highlight} />
              ) : (
                <View
                  style={[
                    styles.progressRing,
                    armed && styles.progressRingArmed,
                    {
                      transform: [
                        { rotate: `${Math.round(progress * 300)}deg` },
                      ],
                    },
                  ]}
                />
              )}
            </View>
          </View>
        ) : null}
      </View>
    </RefreshRegistrationContext.Provider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
  },
  indicatorWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: 'center',
  },
  indicator: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#202824',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  progressRing: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    borderTopColor: '#ffffff',
  },
  progressRingArmed: {
    borderColor: 'rgba(123,255,178,0.32)',
    borderTopColor: colors.highlight,
  },
});
