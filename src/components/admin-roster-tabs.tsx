import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/constants/theme';
import { eventPath } from '@/lib/routes';

export type AdminRosterTab = 'players' | 'invites' | 'teams';

export function AdminRosterTabs({
  eventId,
  active,
}: {
  eventId: string;
  active: AdminRosterTab;
}) {
  const router = useRouter();
  const tabs: { key: AdminRosterTab; label: string; href: string }[] = [
    { key: 'players', label: 'PLAYERS', href: eventPath(eventId, 'admin-roster') },
    {
      key: 'invites',
      label: 'INVITES',
      href: `${eventPath(eventId, 'admin-roster')}?tab=invites`,
    },
    { key: 'teams', label: 'TEAMS', href: eventPath(eventId, 'admin-teams') },
  ];

  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => router.replace(tab.href as never)}
            style={[styles.tab, selected && styles.tabActive]}>
            <Text style={[styles.label, selected && styles.labelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    padding: 4,
    gap: 4,
    backgroundColor: 'rgba(15,17,16,0.56)',
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: 'rgba(123,255,178,0.13)',
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
  },
  labelActive: {
    color: colors.highlight,
  },
});
