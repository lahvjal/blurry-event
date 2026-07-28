import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiquidGlassSurface } from '@/components/liquid-glass';
import { fonts } from '@/constants/theme';
import { useUnreadTotal } from '@/state/unread';

const icons = {
  event: require('@/assets/figma/nav-home.svg'),
  leaderboard: require('@/assets/figma/nav-feed.svg'),
  messages: require('@/assets/figma/nav-messages.svg'),
  profile: require('@/assets/figma/nav-profile.svg'),
} as const;

const tabs = [
  { key: 'event', route: '/event' },
  { key: 'leaderboard', route: '/leaderboard' },
  { key: 'messages', route: '/messages' },
  { key: 'profile', route: '/profile' },
] as const;

export function FloatingNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const unread = useUnreadTotal();

  return (
    <View
      style={[styles.wrapper, { paddingBottom: Math.max(20, insets.bottom + 12) }]}
      pointerEvents="box-none">
      <LiquidGlassSurface style={styles.bar} tintColor="rgba(40,49,43,0.5)">
        <View style={styles.items}>
          {tabs.map((tab) => {
            const active = pathname === tab.route;
            return (
              <Pressable
                key={tab.key}
                style={styles.tab}
                onPress={() => router.navigate(tab.route)}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 13,
    paddingTop: 5,
    paddingBottom: 20,
  },
  bar: {
    height: 72,
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
