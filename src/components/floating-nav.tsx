import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FLOATING_SCRIM_RISE,
  FloatingBackdrop,
} from '@/components/floating-backdrop';
import { FloatingGradientStroke } from '@/components/floating-gradient-stroke';
import {
  FLOATING_GLASS_BLUR_INTENSITY,
  FLOATING_GLASS_TINT,
  LiquidGlassSurface,
} from '@/components/liquid-glass';
import { fonts } from '@/constants/theme';
import { EventScreenName, eventPath } from '@/lib/routes';
import { useEvent } from '@/state/event';
import { useUnreadTotal } from '@/state/unread';

/** Matches styles.bar. */
const BAR_HEIGHT = 72;

const icons = {
  event: require('@/assets/figma/nav-home.svg'),
  leaderboard: require('@/assets/figma/nav-feed.svg'),
  messages: require('@/assets/figma/nav-messages.svg'),
  profile: require('@/assets/figma/nav-profile.svg'),
} as const;

const tabs = [
  { key: 'event', screen: 'event' },
  { key: 'leaderboard', screen: 'leaderboard' },
  { key: 'messages', screen: 'messages' },
  { key: 'profile', screen: 'profile' },
] as const satisfies readonly { key: keyof typeof icons; screen: EventScreenName }[];

export function FloatingNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { event, activeEventId, accountAccess } = useEvent();
  const messageEventIds =
    accountAccess?.events
      .filter((item) => item.registration)
      .map((item) => item.id) ?? [];
  const unread = useUnreadTotal(accountAccess?.accountId ?? null, messageEventIds);

  const bottomInset = Math.max(20, insets.bottom + 12);
  // Measured from the bottom edge up to the fade above the bar's top edge.
  const scrimHeight = bottomInset + BAR_HEIGHT + FLOATING_SCRIM_RISE;

  return (
    <View style={styles.host} pointerEvents="box-none">
      {/*
        Everything scrolling toward the bottom edge fades out under the nav
        rather than running into it. Three stacked backdrop blurs, each masked
        to start lower and blur harder than the last, give a blur that deepens
        toward the edge — a single layer can only fade one radius in and out,
        which reads as a band rather than a gradient. The tint on top does the
        darkening. Web-only: `backdrop-filter` and `mask-image` come from the
        injected stylesheet, keyed on these data attributes.
      */}
      <FloatingBackdrop height={scrimHeight} />

      <View
        style={[styles.wrapper, { paddingBottom: bottomInset }]}
        pointerEvents="auto">
        <View style={styles.barFrame} pointerEvents="auto">
          <LiquidGlassSurface
            style={styles.bar}
            tintColor={FLOATING_GLASS_TINT}
            blurIntensity={FLOATING_GLASS_BLUR_INTENSITY}
            interactive>
            <View style={styles.items}>
              {tabs.map((tab) => {
                const active =
                  (tab.key === 'messages' && pathname === '/inbox') ||
                  pathname === `/${tab.screen}` ||
                  pathname.endsWith(`/${tab.screen}`);
                return (
                  <Pressable
                    key={tab.key}
                    accessibilityRole="button"
                    accessibilityLabel={
                      tab.key === 'event'
                        ? 'Home'
                        : tab.key === 'messages'
                          ? 'Messages'
                          : tab.key === 'leaderboard'
                            ? 'Leaderboard'
                            : 'Profile'
                    }
                    accessibilityState={{ selected: active }}
                    style={styles.tab}
                    onPress={() => {
                      if (tab.key === 'messages') {
                        router.push('/inbox');
                        return;
                      }
                      if (!activeEventId) {
                        router.push(
                          tab.key === 'leaderboard'
                            ? '/leaderboard'
                            : tab.key === 'profile'
                              ? '/profile'
                              : '/event',
                        );
                        return;
                      }
                      router.push(eventPath(event.id, tab.screen) as never);
                    }}>
                    <View style={[styles.tabPill, active && styles.tabPillActive]}>
                      <View style={styles.iconWrap}>
                        <Image
                          source={icons[tab.key]}
                          style={{ width: 22, height: 22 }}
                          contentFit="contain"
                          tintColor={active ? '#282f2b' : '#ffffff'}
                        />
                        {tab.key === 'messages' && unread > 0 ? (
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>
                              {unread > 99 ? '99+' : unread}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </LiquidGlassSurface>
          <FloatingGradientStroke borderRadius={70} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Unpadded, so the scrim can reach the screen edges the bar insets from. */
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // On iOS WebKit, a scrolling Home layer can otherwise win hit-testing over
    // an absolutely positioned nav even when the bar is painted on top.
    zIndex: 100,
    elevation: 100,
  },
  wrapper: {
    position: 'relative',
    paddingHorizontal: 13,
    paddingTop: 5,
    paddingBottom: 20,
    zIndex: 101,
  },
  barFrame: {
    height: BAR_HEIGHT,
    borderRadius: 70,
  },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: 70,
    overflow: 'hidden',
  },
  items: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPill: {
    width: '100%',
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 50,
  },
  tabPillActive: {
    backgroundColor: '#ffffff',
  },
  /** Sized to the icon so the badge has something to hang off the corner of. */
  iconWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -11,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    // The one place the app breaks from its green palette. A count here means
    // someone is waiting on you, and system red is what that reads as
    // everywhere else on the phone.
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    lineHeight: 13,
    color: '#ffffff',
  },
});
