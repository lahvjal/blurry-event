import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { PageHeader } from '@/components/page-header';
import { SearchField } from '@/components/search-field';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { localAvatar, useEvent } from '@/state/event';

type Tab = 'players' | 'teams';

function Avatar({ id, initials }: { id: string; initials: string }) {
  const src = localAvatar(id);
  if (src) return <Image source={src} style={styles.avatar} />;
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitials}>{initials}</Text>
    </View>
  );
}

export default function Directory() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { participants, teams, me, participantById, teamOf } = useEvent();

  const [tab, setTab] = useState<Tab>('players');
  const [query, setQuery] = useState('');

  const filteredPlayers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? participants.filter((p) => p.fullName.toLowerCase().includes(q))
      : participants;
    return [...list].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [participants, query]);

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.memberIds.some((id) =>
          participantById(id)?.fullName.toLowerCase().includes(q),
        ),
    );
  }, [teams, query, participantById]);

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader
        title="directory"
        subtitle={`${participants.length} PLAYERS · ${teams.length} TEAMS`}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingBottom: 130,
        }}
        showsVerticalScrollIndicator={false}>
        {/* Players / Teams toggle */}
        <View style={styles.tabs}>
          {(['players', 'teams'] as Tab[]).map((key) => (
            <Pressable
              key={key}
              style={[styles.tab, tab === key && styles.tabActive]}
              onPress={() => setTab(key)}>
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
                {key.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <SearchField value={query} onChangeText={setQuery} />

        {tab === 'players' ? (
          <View style={{ paddingTop: 8 }}>
            {filteredPlayers.map((player) => {
              const team = teamOf(player.id);
              const isMe = player.id === me.id;
              return (
                <View key={player.id} style={styles.playerRow}>
                  <Avatar id={player.id} initials={player.initials} />
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={styles.playerName}>
                      {player.fullName}
                      {isMe ? '  ·  YOU' : ''}
                    </Text>
                    <Text style={styles.playerMeta}>
                      {player.handicap === null ? '—' : `${player.handicap} HCP`}
                      {team ? ` · ${team.name}` : ' · Unassigned'}
                    </Text>
                  </View>
                  {!isMe ? (
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
                  ) : null}
                </View>
              );
            })}
            {filteredPlayers.length === 0 ? (
              <Text style={styles.empty}>No players match “{query}”.</Text>
            ) : null}
          </View>
        ) : (
          <View style={{ paddingTop: 8, gap: 12, paddingHorizontal: 12 }}>
            {filteredTeams.map((team) => {
              const members = team.memberIds
                .map((id) => participantById(id))
                .filter((p): p is NonNullable<typeof p> => Boolean(p));
              const mine = team.memberIds.includes(me.id);
              return (
                <Pressable
                  key={team.id}
                  onPress={mine ? () => router.push('/my-team') : undefined}
                  style={[styles.teamCard, mine && styles.teamCardMine]}>
                  <View style={styles.teamHeader}>
                    <Text style={[styles.teamName, mine && { color: colors.highlight }]}>
                      {team.name}
                      {mine ? '  ·  YOUR TEAM' : ''}
                    </Text>
                    <Text style={styles.teamTee}>{team.teeTime ?? 'TBD'}</Text>
                  </View>
                  {members.map((member) => (
                    <View key={member.id} style={styles.teamMemberRow}>
                      <Avatar id={member.id} initials={member.initials} />
                      <Text style={styles.teamMemberName}>{member.fullName}</Text>
                      <Text style={styles.teamMemberHcp}>
                        {member.handicap === null ? '—' : member.handicap}
                      </Text>
                    </View>
                  ))}
                  {team.startingHole ? (
                    <Text style={styles.teamFooter}>
                      STARTS HOLE {team.startingHole}
                      {team.cart ? ` · ${team.cart.toUpperCase()}` : ''}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            {filteredTeams.length === 0 ? (
              <Text style={styles.empty}>No teams match “{query}”.</Text>
            ) : null}
          </View>
        )}
      </ScrollView>
      <FloatingNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b2a22',
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 14,
    backgroundColor: 'rgba(15,17,16,0.45)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 999,
  },
  tabActive: {
    backgroundColor: '#34a468',
  },
  tabText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  tabTextActive: {
    color: '#0d1a12',
  },
  playerRow: {
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
  },
  avatarFallback: {
    backgroundColor: '#333634',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#5a5f5c',
  },
  playerName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  playerMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  messageButton: {
    backgroundColor: 'rgba(233,255,242,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 4,
  },
  messageButtonText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#142a1f',
  },
  teamCard: {
    backgroundColor: 'rgba(15,17,16,0.45)',
    padding: 14,
    gap: 10,
  },
  teamCardMine: {
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.25)',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  teamTee: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.link,
  },
  teamMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  teamMemberName: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#ffffff',
  },
  teamMemberHcp: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
  teamFooter: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
  },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    paddingHorizontal: 20,
    paddingTop: 20,
  },
});
