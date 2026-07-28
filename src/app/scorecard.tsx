import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { SyncStatusLine } from '@/components/sync-status';
import { PageHeader } from '@/components/page-header';
import { Chevron, GradientPanel, Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { localAvatar, useEvent } from '@/state/event';
import {
  GAME_STYLE_LABELS,
  isTeamFormat,
  sumScores,
} from '@/state/types';

import { AvatarStack } from '@/components/ui';

const TABLE_BORDER = '#191b1a';

function ScoreCell({ score, par }: { score: number | null; par: number }) {
  if (score === null) {
    return (
      <View style={styles.scoreCell}>
        <Text style={styles.scoreDash}>-</Text>
      </View>
    );
  }
  if (score < par) {
    return (
      <View style={[styles.scoreCell, styles.scoreBirdie]}>
        <Text style={styles.scoreBirdieText}>{score}</Text>
      </View>
    );
  }
  if (score > par) {
    return (
      <View style={[styles.scoreCell, styles.scoreBogey]}>
        <Text style={styles.scoreBogeyText}>{score}</Text>
      </View>
    );
  }
  return (
    <View style={styles.scoreCell}>
      <Text style={styles.scorePar}>{score}</Text>
    </View>
  );
}

function HoleRow({ hole, par, score }: { hole: number; par: number; score: number | null }) {
  return (
    <View style={styles.holeRow}>
      <View style={styles.leftRail}>
        <Text style={styles.holeNum}>{hole}</Text>
        <Text style={styles.holeNum}>{par}</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.scoreArea}>
        <ScoreCell score={score} par={par} />
      </View>
    </View>
  );
}

function CurrentHoleBanner({ hole, par }: { hole: number; par: number }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push('/score-input')}>
      <GradientPanel colors={colors.gradCta} style={styles.banner}>
        <View style={styles.bannerStats}>
          <View style={styles.bannerStat}>
            <View style={styles.bannerSideLabelBox}>
              <Text style={styles.bannerSideLabel}>hole</Text>
            </View>
            <Text style={styles.bannerValue}>{hole}</Text>
          </View>
          <View style={styles.bannerStat}>
            <View style={styles.bannerSideLabelBox}>
              <Text style={styles.bannerSideLabel}>par</Text>
            </View>
            <Text style={styles.bannerValue}>{par}</Text>
          </View>
        </View>
        <View style={styles.bannerRight}>
          <View style={styles.enterScorePill}>
            <Text style={styles.enterScoreText}>Enter score</Text>
          </View>
          <Chevron width={6} height={12} />
        </View>
      </GradientPanel>
    </Pressable>
  );
}

function TotalRow({ label, par, score }: { label: string; par: number; score: number | null }) {
  return (
    <View style={styles.totalRow}>
      <View style={styles.leftRail}>
        <Text style={styles.totalLabel}>{label}</Text>
        <Text style={styles.totalPar}>{par}</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.scoreArea}>
        <Text style={[styles.totalScore, score === null && { color: '#5a5d5b' }]}>
          {score ?? '-'}
        </Text>
      </View>
    </View>
  );
}

export default function Scorecard() {
  const insets = useSafeAreaInsets();
  const { event, me, myTeam, myScores, currentHoleIndex, participantById } = useEvent();

  const scores = myScores;
  const currentHole = currentHoleIndex;
  const pars = event.holes.map((h) => h.par);
  const teamFormat = isTeamFormat(event.gameStyle);

  const frontPar = pars.slice(0, 9).reduce((a, b) => a + b, 0);
  const backPar = pars.slice(9).reduce((a, b) => a + b, 0);
  const totalPar = frontPar + backPar;
  const frontScore = sumScores(scores.slice(0, 9));
  const backScore = sumScores(scores.slice(9));
  const totalScore = sumScores(scores);

  /** Whose card this is: the team's avatars for a scramble, yours for solo. */
  const cardAvatars = (
    teamFormat && myTeam ? myTeam.memberIds : [me.id]
  )
    .map((id) => localAvatar(id))
    .filter((src): src is number => src !== null);

  const renderRows = (start: number, end: number) => {
    const rows: React.ReactNode[] = [];
    for (let i = start; i < end; i++) {
      if (i === currentHole && scores[i] === null) {
        rows.push(<CurrentHoleBanner key={i} hole={i + 1} par={pars[i]} />);
      } else {
        rows.push(
          <HoleRow key={i} hole={i + 1} par={pars[i]} score={scores[i]} />,
        );
      }
    }
    return rows;
  };

  return (
    <View style={styles.root}>
      <Noise />
      <PageHeader
        title={teamFormat && myTeam ? myTeam.name : 'score card'}
        subtitle={event.courseName}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 12,
          paddingBottom: 110,
        }}
        showsVerticalScrollIndicator={false}>
        {/* Column headers */}
        <View style={styles.headerRow}>
          <View style={styles.leftRail}>
            <Text style={styles.colLabel}>Hole</Text>
            <Text style={styles.colLabel}>Par</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={styles.scoreArea}>
            {cardAvatars.length > 1 ? (
              <AvatarStack sources={cardAvatars} size={26} overlap={12} />
            ) : cardAvatars.length === 1 ? (
              <Image source={cardAvatars[0]} style={styles.playerAvatar} />
            ) : null}
          </View>
        </View>

        {/* One card for the whole team under a scramble */}
        <View style={styles.formatBar}>
          <Text style={styles.formatText}>{GAME_STYLE_LABELS[event.gameStyle]}</Text>
          {teamFormat ? (
            <Text style={styles.formatNote}>ANY TEAMMATE CAN ENTER</Text>
          ) : null}
        </View>

        <SyncStatusLine />

        {renderRows(0, 9)}
        <TotalRow label="OUT" par={frontPar} score={frontScore} />
        {renderRows(9, 18)}
        <TotalRow label="IN" par={backPar} score={backScore} />

        {/* Total footer */}
        <GradientPanel colors={['#0f1110', '#141b17']} style={styles.totalFooter}>
          <View style={styles.totalSideLabelBox}>
            <Text style={styles.totalSideLabel}>Total</Text>
          </View>
          <View style={styles.totalStat}>
            <View style={styles.bannerSideLabelBox}>
              <Text style={styles.bannerSideLabel}>par</Text>
            </View>
            <Text style={styles.totalStatValue}>{totalPar}</Text>
          </View>
          <View style={styles.totalStat}>
            <View style={styles.bannerSideLabelBox}>
              <Text style={styles.bannerSideLabel}>score</Text>
            </View>
            <Text style={styles.totalStatValue}>{totalScore ?? '-'}</Text>
          </View>
        </GradientPanel>
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
  headerRow: {
    flexDirection: 'row',
    height: 44,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: TABLE_BORDER,
    borderTopWidth: 1,
    borderTopColor: TABLE_BORDER,
  },
  leftRail: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 40,
    borderRightWidth: 1,
    borderRightColor: TABLE_BORDER,
    alignSelf: 'stretch',
  },
  colLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    width: 40,
    textAlign: 'center',
    alignSelf: 'center',
  },
  playerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  formatBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: TABLE_BORDER,
  },
  formatText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.link,
  },
  formatNote: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.3)',
  },
  holeRow: {
    flexDirection: 'row',
    height: 42,
    alignItems: 'center',
  },
  holeNum: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.3)',
    width: 40,
    textAlign: 'center',
    alignSelf: 'center',
  },
  scoreArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  scoreCell: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreDash: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#5a5d5b',
  },
  scorePar: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  scoreBirdie: {
    backgroundColor: '#34a468',
  },
  scoreBirdieText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#131715',
  },
  scoreBogey: {
    backgroundColor: '#521a2b',
    borderRadius: 0,
  },
  scoreBogeyText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  banner: {
    height: 110,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 50,
    paddingRight: 20,
    borderBottomWidth: 1,
    borderBottomColor: TABLE_BORDER,
  },
  bannerStats: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 20,
  },
  bannerStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerSideLabelBox: {
    width: 13,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerSideLabel: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 6.6,
    transform: [{ rotate: '-90deg' }],
    width: 70,
    textAlign: 'center',
  },
  bannerValue: {
    fontFamily: fonts.serif,
    fontSize: 60,
    color: '#ffffff',
  },
  bannerRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 14,
  },
  enterScorePill: {
    backgroundColor: colors.scorePill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  enterScoreText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderTopWidth: 1,
    borderTopColor: TABLE_BORDER,
    borderBottomWidth: 1,
    borderBottomColor: TABLE_BORDER,
  },
  totalLabel: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#ffffff',
    width: 40,
    textAlign: 'center',
  },
  totalPar: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#ffffff',
    width: 40,
    textAlign: 'center',
  },
  totalScore: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#ffffff',
  },
  totalFooter: {
    height: 110,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
  },
  totalSideLabelBox: {
    width: 19,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalSideLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    transform: [{ rotate: '-90deg' }],
    width: 60,
    textAlign: 'center',
  },
  totalStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  totalStatValue: {
    fontFamily: fonts.serif,
    fontSize: 40,
    color: '#ffffff',
  },
});
