import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FloatingNav } from '@/components/floating-nav';
import { SavedLocallyNote, SyncStatusLine } from '@/components/sync-status';
import { Noise } from '@/components/ui';
import { fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';
import { sumScores } from '@/state/types';

const pegasus = require('@/assets/figma/pegasus.svg');
const crest = require('@/assets/figma/crest.svg');

export default function CompleteRound() {
  const { event, myScores: scores } = useEvent();
  const totalPar = event.holes.reduce((total, h) => total + h.par, 0);
  const total = sumScores(scores) ?? totalPar;
  const complete = scores.every((s) => s !== null);
  const toPar = complete ? total - totalPar : 0;
  const toParLabel = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#867738', '#7b5e2a']} style={StyleSheet.absoluteFill} />
      <Noise />
      <Image source={pegasus} style={styles.pegasus} contentFit="contain" />
      <View style={styles.content}>
        <View style={styles.badge}>
          <Image source={crest} style={{ width: 24, height: 31.6 }} contentFit="contain" />
          <Text style={styles.badgeLabel}>PERSONAL</Text>
          <Text style={styles.badgeTitle}>BEST</Text>
        </View>
        <View style={styles.finalBlock}>
          <View style={styles.finalRow}>
            <View style={styles.finalLabelBox}>
              <Text style={styles.finalLabel}>final</Text>
            </View>
            <View style={styles.scoreGroup}>
              <View style={styles.sideLabelBox}>
                <Text style={styles.sideLabel}>score</Text>
              </View>
              <Text style={styles.scoreValue}>{complete ? total : 72}</Text>
              <Text style={styles.toPar}>{toParLabel}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>18 holes</Text>
            <View style={styles.dot} />
            <Text style={styles.metaText}>{event.courseName}</Text>
          </View>
          <View style={styles.syncStatus}>
            <SyncStatusLine compact />
            <SavedLocallyNote />
          </View>
        </View>
      </View>
      <FloatingNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#7b5e2a',
  },
  pegasus: {
    position: 'absolute',
    left: 0,
    top: -68,
    width: 792,
    height: 840,
    opacity: 0.9,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  badge: {
    alignItems: 'center',
    gap: 10,
  },
  badgeLabel: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: '#ffffff',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  badgeTitle: {
    fontFamily: fonts.serif,
    fontSize: 30,
    color: '#ffffff',
    marginTop: -6,
  },
  finalBlock: {
    alignItems: 'center',
    gap: 40,
    paddingTop: 40,
  },
  finalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 30,
  },
  finalLabelBox: {
    width: 19,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finalLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    transform: [{ rotate: '-90deg' }],
    width: 60,
    textAlign: 'center',
  },
  scoreGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  sideLabelBox: {
    width: 13,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideLabel: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 6.6,
    transform: [{ rotate: '-90deg' }],
    width: 90,
    textAlign: 'center',
  },
  scoreValue: {
    fontFamily: fonts.serif,
    fontSize: 130,
    lineHeight: 140,
    color: '#ffffff',
  },
  toPar: {
    fontFamily: fonts.serif,
    fontSize: 30,
    color: '#ffffff',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metaText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
  },
  dot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  syncStatus: {
    minWidth: 280,
  },
});
