import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiquidGlassSurface } from '@/components/liquid-glass';

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
                  <Image
                    source={icons[tab.key]}
                    style={{ width: 22, height: 22 }}
                    contentFit="contain"
                    tintColor={active ? '#282f2b' : '#ffffff'}
                  />
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
});
