import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { Badge, Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';
import { GAME_STYLE_LABELS, formatToPar, isTeamFormat } from '@/state/types';

export default function Leaderboard() {
  const insets = useSafeAreaInsets();
  const { activeEventId, event, leaderboard, myEntrantId } = useEvent();

  if (!activeEventId) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <View style={[styles.empty, { paddingTop: insets.top + 20 }]}>
          <Text style={styles.eventLabel}>NO EVENT SELECTED</Text>
          <Text style={styles.title}>Leaderboard</Text>
          <Text style={styles.emptyCopy}>
            Results will appear here once you join or create an event.
          </Text>
        </View>
        <FloatingNav />
      </View>
    );
  }

  const anyScored = leaderboard.some((row) => row.thru > 0);
  const teamFormat = isTeamFormat(event.gameStyle);
  const myPosition = leaderboard.findIndex((row) => row.entrantId === myEntrantId) + 1;
  const myRow = leaderboard.find((row) => row.entrantId === myEntrantId);

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingHorizontal: 20,
          paddingBottom: 130,
          gap: 16,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Text style={styles.eventLabel}>{event.name.toUpperCase()}</Text>
          <Badge label={anyScored ? 'ROUND LIVE' : 'NOT STARTED'} />
        </View>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.subtitle}>
          {GAME_STYLE_LABELS[event.gameStyle]} · {leaderboard.length}{' '}
          {teamFormat ? 'teams' : 'players'}
        </Text>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, { flex: 1 }]}>
              #{teamFormat ? 'TEAM' : 'PLAYER'}
            </Text>
            <Text style={[styles.headerText, styles.thruCol]}>THRU</Text>
            <Text style={[styles.headerText, styles.scoreCol]}>SCORE</Text>
          </View>

          {leaderboard.map((row, i) => {
            const rank = i + 1;
            const leading = rank === 1 && row.thru > 0;
            return (
              <View
                key={row.entrantId}
                style={[styles.row, row.isMine && styles.rowMine]}>
                <Text style={[styles.rank, leading && { color: '#d3b64c' }]}>
                  {row.thru > 0 ? rank : '–'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.name, row.isMine && { color: colors.highlight }]}>
                  {row.name}
                </Text>
                <Text style={[styles.thru, styles.thruCol]}>
                  {row.thru === 0 ? '–' : row.thru === 18 ? 'F' : row.thru}
                </Text>
                <Text
                  style={[
                    styles.score,
                    styles.scoreCol,
                    row.isMine && { color: colors.highlight },
                  ]}>
                  {formatToPar(row.toPar)}
                </Text>
              </View>
            );
          })}
        </View>

        {myRow && myRow.thru > 0 ? (
          <Text style={styles.footer}>
            {teamFormat ? 'YOUR TEAM' : 'YOU'} · {myPosition}
            {ordinal(myPosition)} · {18 - myRow.thru} HOLES TO PLAY
          </Text>
        ) : (
          <Text style={styles.footerMuted}>
            Scores appear here as groups finish each hole.
          </Text>
        )}
      </ScrollView>
      <FloatingNav />
    </View>
  );
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'TH';
  switch (n % 10) {
    case 1:
      return 'ST';
    case 2:
      return 'ND';
    case 3:
      return 'RD';
    default:
      return 'TH';
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b2a22',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eventLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 44,
    color: '#ffffff',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: -8,
  },
  table: {
    backgroundColor: 'rgba(15,17,16,0.35)',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowMine: {
    backgroundColor: 'rgba(9,12,10,0.8)',
  },
  rank: {
    width: 22,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  name: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  thruCol: {
    width: 44,
    textAlign: 'right',
  },
  thru: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  scoreCol: {
    width: 56,
    textAlign: 'right',
  },
  score: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: '#ffffff',
  },
  footer: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
    textAlign: 'center',
  },
  footerMuted: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
  },
  empty: {
    paddingHorizontal: 20,
    gap: 16,
  },
  emptyCopy: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textMuted,
    maxWidth: 280,
  },
});
