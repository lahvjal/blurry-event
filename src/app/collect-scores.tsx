import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { SyncStatusLine } from '@/components/sync-status';
import { ActionButton, Badge, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { decodeScorecardReceipt } from '@/lib/scorecard-receipt';
import { useEvent } from '@/state/event';
import { isTeamFormat } from '@/state/types';

type ScanNotice = {
  tone: 'success' | 'neutral' | 'warning' | 'error';
  title: string;
  detail: string;
};

export default function CollectScores() {
  const insets = useSafeAreaInsets();
  const {
    collectScorecard,
    collectedScorecards,
    event,
    leaderboard,
    me,
    participants,
    teams,
  } = useEvent();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<ScanNotice | null>(null);
  const scanLockedRef = useRef(false);

  const teamFormat = isTeamFormat(event.gameStyle);
  const entrants = useMemo(
    () =>
      teamFormat
        ? teams.map((team) => ({ id: team.id, name: team.name }))
        : participants.map((participant) => ({
            id: participant.id,
            name: participant.fullName,
          })),
    [participants, teamFormat, teams],
  );
  const rowsById = useMemo(
    () => new Map(leaderboard.map((row) => [row.entrantId, row])),
    [leaderboard],
  );
  const collectedIds = useMemo(
    () =>
      new Set(
        collectedScorecards.map((card) => card.receipt.entrantId),
      ),
    [collectedScorecards],
  );
  const completedCount = entrants.filter(
    (entrant) => rowsById.get(entrant.id)?.thru === 18,
  ).length;

  const openScanner = useCallback(async () => {
    setNotice(null);
    const response = permission?.granted
      ? permission
      : await requestPermission();
    if (!response.granted) {
      setNotice({
        tone: 'error',
        title: 'CAMERA ACCESS NEEDED',
        detail:
          'Allow camera access in your browser settings, then return here to scan scorecards.',
      });
      return;
    }
    scanLockedRef.current = false;
    setScanning(true);
  }, [permission, requestPermission]);

  const scanNext = useCallback(() => {
    setNotice(null);
    setProcessing(false);
    scanLockedRef.current = false;
    setScanning(true);
  }, []);

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanLockedRef.current) return;
      scanLockedRef.current = true;
      setProcessing(true);

      void (async () => {
        try {
          const receipt = await decodeScorecardReceipt(data);
          const result = await collectScorecard(receipt);
          if (result.status === 'accepted') {
            setNotice({
              tone: 'success',
              title: result.replaced ? 'UPDATED CARD COLLECTED' : 'SCORECARD COLLECTED',
              detail: `${result.entrantName} is now final on this device and queued to sync.`,
            });
          } else if (result.status === 'duplicate') {
            setNotice({
              tone: 'neutral',
              title: 'ALREADY RECEIVED',
              detail: `${result.entrantName} already has this complete card on the collector.`,
            });
          } else {
            setNotice({
              tone: 'warning',
              title: 'NEWER CARD ALREADY SAVED',
              detail: `${result.entrantName} has a newer revision on this collector, so this QR was not applied.`,
            });
          }
        } catch (error) {
          setNotice({
            tone: 'error',
            title: 'SCORECARD NOT ACCEPTED',
            detail:
              (error as { message?: string }).message ??
              'This QR could not be read.',
          });
        } finally {
          setProcessing(false);
          setScanning(false);
        }
      })();
    },
    [collectScorecard],
  );

  if (!me.isAdmin) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="offline collection" showMore={false} />
        <View style={[styles.deniedWrap, { paddingTop: insets.top + 120 }]}>
          <Text style={styles.denied}>Only an event admin can collect scorecards.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader title="offline collection" subtitle={event.name} showMore={false} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 54 + 24 },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <Text style={styles.summaryCount}>
            {completedCount}
            <Text style={styles.summaryTotal}> / {entrants.length}</Text>
          </Text>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryTitle}>FINAL CARDS AVAILABLE</Text>
            <Text style={styles.summaryDetail}>
              Includes scores received online and cards scanned on this device.
            </Text>
          </View>
        </View>

        <View style={styles.syncLine}>
          <SyncStatusLine compact />
        </View>

        {me.id === 'unlinked' ? (
          <View style={styles.registrationWarning}>
            <Text style={styles.registrationWarningTitle}>REGISTRATION REQUIRED</Text>
            <Text style={styles.registrationWarningText}>
              This club admin account must also be registered in the event before
              collected cards can enter the sync queue.
            </Text>
          </View>
        ) : null}

        <View style={styles.scannerSection}>
          <SectionLabel color={colors.link} size={10}>
            collection station
          </SectionLabel>
          <Text style={styles.hint}>
            Ask each missing team to open its completed round and tap Show Score QR.
          </Text>

          {scanning ? (
            <View style={styles.cameraFrame}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleBarcodeScanned}
              />
              <View pointerEvents="none" style={styles.scanGuide} />
              {processing ? (
                <View style={styles.processingOverlay}>
                  <ActivityIndicator color={colors.highlight} />
                  <Text style={styles.processingText}>VERIFYING CARD</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => setScanning(false)}
                style={styles.cancelScan}>
                <Text style={styles.cancelScanText}>CANCEL</Text>
              </Pressable>
            </View>
          ) : notice ? (
            <View style={[styles.notice, styles[`notice_${notice.tone}`]]}>
              <Text style={styles.noticeTitle}>{notice.title}</Text>
              <Text style={styles.noticeDetail}>{notice.detail}</Text>
              <Pressable onPress={scanNext} style={styles.scanNextButton}>
                <Text style={styles.scanNextText}>SCAN NEXT CARD</Text>
              </Pressable>
            </View>
          ) : (
            <ActionButton
              label={permission?.granted ? 'SCAN SCORE QR' : 'ALLOW CAMERA & SCAN'}
              height={58}
              onPress={() => void openScanner()}
            />
          )}
        </View>

        <View style={styles.rosterSection}>
          <SectionLabel color={colors.link} size={10}>
            event cards
          </SectionLabel>
          <View style={styles.roster}>
            {entrants.map((entrant) => {
              const row = rowsById.get(entrant.id);
              const collected = collectedIds.has(entrant.id);
              const complete = row?.thru === 18;
              const label = collected
                ? 'COLLECTED'
                : complete
                  ? 'RECEIVED'
                  : row?.thru
                    ? `${row.thru}/18`
                    : 'MISSING';
              return (
                <View key={entrant.id} style={styles.rosterRow}>
                  <View style={styles.rosterNameWrap}>
                    <Text style={styles.rosterName} numberOfLines={1}>
                      {entrant.name}
                    </Text>
                    {collected ? (
                      <Text style={styles.rosterSource}>scanned on this device</Text>
                    ) : null}
                  </View>
                  <Badge
                    label={label}
                    color={
                      collected || complete
                        ? colors.highlight
                        : row?.thru
                          ? '#ffcf8b'
                          : 'rgba(255,255,255,0.42)'
                    }
                    background={
                      collected || complete
                        ? 'rgba(123,255,178,0.08)'
                        : 'rgba(255,255,255,0.04)'
                    }
                  />
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b2a22',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 60,
    gap: 22,
  },
  deniedWrap: {
    paddingHorizontal: 24,
  },
  denied: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    padding: 18,
    backgroundColor: 'rgba(13,19,16,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.16)',
  },
  summaryCount: {
    fontFamily: fonts.serif,
    fontSize: 46,
    color: '#ffffff',
  },
  summaryTotal: {
    fontSize: 24,
    color: 'rgba(255,255,255,0.35)',
  },
  summaryCopy: {
    flex: 1,
    gap: 5,
  },
  summaryTitle: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
    letterSpacing: 0.4,
  },
  summaryDetail: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.46)',
  },
  syncLine: {
    marginTop: -10,
  },
  registrationWarning: {
    gap: 6,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,207,139,0.35)',
    backgroundColor: 'rgba(255,207,139,0.07)',
  },
  registrationWarningTitle: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#ffcf8b',
  },
  registrationWarningText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.55)',
  },
  scannerSection: {
    gap: 10,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.48)',
  },
  cameraFrame: {
    height: 330,
    overflow: 'hidden',
    backgroundColor: '#080c0a',
  },
  scanGuide: {
    position: 'absolute',
    width: 230,
    height: 230,
    alignSelf: 'center',
    top: 42,
    borderWidth: 2,
    borderColor: colors.highlight,
    backgroundColor: 'transparent',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(8,12,10,0.82)',
  },
  processingText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#ffffff',
  },
  cancelScan: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(8,12,10,0.8)',
  },
  cancelScanText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#ffffff',
  },
  notice: {
    gap: 8,
    padding: 18,
    borderWidth: 1,
  },
  notice_success: {
    borderColor: 'rgba(123,255,178,0.4)',
    backgroundColor: 'rgba(123,255,178,0.08)',
  },
  notice_neutral: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  notice_warning: {
    borderColor: 'rgba(255,207,139,0.42)',
    backgroundColor: 'rgba(255,207,139,0.07)',
  },
  notice_error: {
    borderColor: 'rgba(255,143,132,0.42)',
    backgroundColor: 'rgba(255,143,132,0.07)',
  },
  noticeTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#ffffff',
  },
  noticeDetail: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.62)',
  },
  scanNextButton: {
    height: 46,
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d1712',
  },
  scanNextText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  rosterSection: {
    gap: 10,
  },
  roster: {
    backgroundColor: 'rgba(13,19,16,0.42)',
  },
  rosterRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rosterNameWrap: {
    flex: 1,
    gap: 4,
  },
  rosterName: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  rosterSource: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: 'rgba(123,255,178,0.58)',
  },
});
