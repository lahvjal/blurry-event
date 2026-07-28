import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <LiquidGlassSurface style={styles.bar}>
        <View style={styles.items}>
          {tabs.map((tab) => {
            const active = pathname === tab.route;
            return (
              <Pressable
                key={tab.key}
                hitSlop={14}
                onPress={() => router.navigate(tab.route)}>
                {/* Active icon carries the design system's green glow (#547F66, r4) */}
                <View style={active ? styles.activeGlow : undefined}>
                  <Image
                    source={icons[tab.key]}
                    style={{ width: 22, height: 22 }}
                    contentFit="contain"
                    tintColor={active ? '#ffffff' : '#606361'}
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
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 42,
  },
  activeGlow: {
    shadowColor: '#547F66',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 4,
    shadowOpacity: 1,
  },
});
