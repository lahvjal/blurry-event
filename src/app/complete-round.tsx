import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FloatingNav } from '@/components/floating-nav';
import { ScorecardQr } from '@/components/scorecard-qr';
import { SavedLocallyNote, SyncStatusLine } from '@/components/sync-status';
import { Noise } from '@/components/ui';
import { fonts } from '@/constants/theme';
import {
  createScorecardReceipt,
  scorecardSourceRevision,
} from '@/lib/scorecard-receipt';
import { useEvent } from '@/state/event';
import { isTeamFormat, sumScores } from '@/state/types';

const pegasus = require('@/assets/figma/pegasus.svg');
const crest = require('@/assets/figma/crest.svg');

export default function CompleteRound() {
  const {
    event,
    me,
    myEntrantId,
    myScores: scores,
    myTeam,
    scoreUpdates,
  } = useEvent();
  const [receiptVisible, setReceiptVisible] = useState(false);
  const [encodedReceipt, setEncodedReceipt] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const totalPar = event.holes.reduce((total, h) => total + h.par, 0);
  const total = sumScores(scores) ?? totalPar;
  const complete = scores.every((s) => s !== null);
  const toPar = complete ? total - totalPar : 0;
  const toParLabel = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;
  const teamFormat = isTeamFormat(event.gameStyle);
  const entrantName = teamFormat ? (myTeam?.name ?? me.fullName) : me.fullName;
  const scoreKey = scores.join(',');
  const source = useMemo(
    () => scorecardSourceRevision(myEntrantId, scoreUpdates),
    [myEntrantId, scoreUpdates],
  );

  useEffect(() => {
    if (!complete) {
      setEncodedReceipt(null);
      setReceiptError(null);
      return;
    }
    let cancelled = false;
    setReceiptError(null);
    void createScorecardReceipt({
      eventId: event.id,
      entrantId: myEntrantId,
      entrantName,
      entrantKind: teamFormat ? 'team' : 'player',
      scores,
      sourceUpdatedAt: source.sourceUpdatedAt,
      sourceRevision: source.sourceRevision,
    })
      .then(({ encoded }) => {
        if (!cancelled) setEncodedReceipt(encoded);
      })
      .catch((error) => {
        if (!cancelled) {
          setEncodedReceipt(null);
          setReceiptError(
            (error as { message?: string }).message ??
              'The score receipt could not be created.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // scoreKey is the compact dependency that changes only when a hole changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    complete,
    entrantName,
    event.id,
    myEntrantId,
    scoreKey,
    source.sourceRevision,
    source.sourceUpdatedAt,
    teamFormat,
  ]);

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
          {complete ? (
            <Pressable
              disabled={!encodedReceipt}
              onPress={() => setReceiptVisible(true)}
              style={[
                styles.receiptButton,
                !encodedReceipt && styles.receiptButtonDisabled,
              ]}>
              <Text style={styles.receiptButtonText}>
                {encodedReceipt ? 'SHOW SCORE QR' : 'PREPARING SCORE QR…'}
              </Text>
            </Pressable>
          ) : null}
          {receiptError ? <Text style={styles.receiptError}>{receiptError}</Text> : null}
        </View>
      </View>
      <FloatingNav />

      <Modal
        animationType="fade"
        transparent={false}
        visible={receiptVisible}
        onRequestClose={() => setReceiptVisible(false)}>
        <View style={styles.receiptModal}>
          <Noise />
          <ScrollView
            contentContainerStyle={styles.receiptModalContent}
            showsVerticalScrollIndicator={false}>
            <Text style={styles.receiptEyebrow}>OFFLINE SCORE RECEIPT</Text>
            <Text style={styles.receiptTitle}>{entrantName}</Text>
            <Text style={styles.receiptSummary}>
              {total} strokes · {toParLabel} · 18 holes
            </Text>
            {encodedReceipt ? (
              <View style={styles.qrFrame}>
                <ScorecardQr value={encodedReceipt} />
              </View>
            ) : null}
            <Text style={styles.receiptInstructions}>
              Have the event admin open Offline Score Collection and scan this code.
              The full 18-hole card transfers without internet.
            </Text>
            <Pressable
              onPress={() => setReceiptVisible(false)}
              style={styles.closeReceiptButton}>
              <Text style={styles.closeReceiptText}>DONE</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
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
  receiptButton: {
    minWidth: 220,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(21,25,22,0.35)',
  },
  receiptButtonDisabled: {
    opacity: 0.45,
  },
  receiptButtonText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  receiptError: {
    maxWidth: 280,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: '#ffe0ad',
    textAlign: 'center',
  },
  receiptModal: {
    flex: 1,
    backgroundColor: '#16231c',
  },
  receiptModalContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 28,
    paddingVertical: 48,
  },
  receiptEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#7bffb2',
    letterSpacing: 0.8,
  },
  receiptTitle: {
    fontFamily: fonts.serif,
    fontSize: 38,
    lineHeight: 42,
    color: '#ffffff',
    textAlign: 'center',
  },
  receiptSummary: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },
  qrFrame: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#ffffff',
  },
  receiptInstructions: {
    maxWidth: 310,
    marginTop: 8,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.62)',
    textAlign: 'center',
  },
  closeReceiptButton: {
    minWidth: 244,
    height: 50,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d1712',
  },
  closeReceiptText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#ffffff',
  },
});
