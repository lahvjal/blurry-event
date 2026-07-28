import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { PageHeader } from '@/components/page-header';
import { SearchField } from '@/components/search-field';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';

export default function NewMessage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { participants, me, teamOf } = useEvent();
  const [query, setQuery] = React.useState('');

  const term = query.trim().toLowerCase();
  const others = participants.filter((player) => player.id !== me.id);
  const filtered = term
    ? others.filter((player) => player.fullName.toLowerCase().includes(term))
    : others;

  return (
    <View style={styles.root}>
      <Noise />
      <PageHeader title="NEW MESSAGE" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 20,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}>
        {/* To field */}
        <SearchField
          prefix="To:"
          placeholder=""
          variant="field"
          value={query}
          onChangeText={setQuery}
        />

        {/* Create a group */}
        <Pressable
          style={styles.createGroup}
          onPress={() => router.push('/create-group')}>
          <View style={styles.plusBox}>
            <Text style={styles.plusText}>+</Text>
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={styles.createTitle}>CREATE A GROUP</Text>
            <Text style={styles.createSub}>Start a conversation with your crew</Text>
          </View>
          <Text style={styles.createArrow}>→</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>PLAYERS</Text>

        {filtered.map((player) => {
          const team = teamOf(player.id);
          return (
            <View key={player.id} style={styles.memberRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{player.initials}</Text>
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={styles.memberName}>{player.fullName}</Text>
                <Text style={styles.memberMeta}>
                  {player.handicap === null ? '—' : `${player.handicap} HCP`}
                  {team ? ` · ${team.name}` : ''}
                </Text>
              </View>
              <Pressable
                style={styles.messageButton}
                onPress={() =>
                  router.push({
                    pathname: '/direct-message',
                    params: { participant: player.id },
                  })
                }>
                <Text style={styles.messageButtonText}>MESSAGE</Text>
              </Pressable>
            </View>
          );
        })}

        {filtered.length === 0 ? (
          <Text style={styles.empty}>No players match “{query}”.</Text>
        ) : null}
      </ScrollView>
      <FloatingNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  createGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    backgroundColor: '#17261e',
    marginBottom: 16,
  },
  plusBox: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: 'rgba(52,164,104,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: {
    fontSize: 18,
    color: '#34a468',
    marginTop: -2,
  },
  createTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#ffffff',
  },
  createSub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  createArrow: {
    fontSize: 18,
    color: '#ffffff',
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#333634',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#5a5f5c',
  },
  memberName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  memberMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  messageButton: {
    backgroundColor: '#1e3629',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 4,
  },
  messageButtonText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#7bffb2',
  },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    paddingTop: 24,
  },
});
