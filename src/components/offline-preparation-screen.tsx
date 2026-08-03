import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts } from '@/constants/theme';
import type { OfflinePreparationManifest } from '@/lib/offline/event-snapshot';
import type { OfflinePreparationProgress } from '@/lib/offline/preparation';

export type OfflinePreparationScreenPhase =
  | 'checking'
  | 'preparing'
  | 'incomplete'
  | 'error';

export function OfflinePreparationScreen({
  phase,
  progress,
  manifest,
  error,
}: {
  phase: OfflinePreparationScreenPhase;
  progress: OfflinePreparationProgress | null;
  manifest: OfflinePreparationManifest | null;
  error: string | null;
}) {
  const percent = progress?.percent ?? 0;
  const hasCount = Boolean(progress && progress.totalItems > 0);
  const interrupted = phase === 'incomplete' || phase === 'error';
  const detail = interrupted
    ? error ?? manifest?.lastError ?? 'The download will continue automatically when the connection is available.'
    : progress?.message ?? 'Checking what is already stored on this device';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark} />
          <Text style={styles.brand}>BLURRY</Text>
        </View>

        <View style={styles.content}>
          <Text accessibilityRole="header" style={styles.eyebrow}>
            OFFLINE SETUP
          </Text>
          <Text style={styles.title}>
            {interrupted ? 'Setup is waiting' : 'Getting the course ready'}
          </Text>
          <Text style={styles.warning}>Keep this app open—do not close it.</Text>
          <Text style={styles.supporting}>{detail}</Text>

          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Offline setup progress"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>

          <View style={styles.progressMeta}>
            <Text style={styles.progressPercent}>{percent}%</Text>
            <Text style={styles.progressCount}>
              {hasCount
                ? `${progress!.completedItems} OF ${progress!.totalItems}`
                : interrupted
                  ? 'RETRYING AUTOMATICALLY'
                  : 'CHECKING'}
            </Text>
          </View>

          <View style={styles.statusCard}>
            <ActivityIndicator
              color={colors.highlight}
              size="small"
              accessibilityLabel={interrupted ? 'Waiting to retry' : 'Download in progress'}
            />
            <View style={styles.statusCopy}>
              <Text style={styles.statusTitle}>
                {interrupted ? 'WE’LL KEEP TRYING' : 'DOWNLOADING AUTOMATICALLY'}
              </Text>
              <Text style={styles.statusBody}>
                {interrupted
                  ? 'Leave the app open. Setup resumes on its own when the connection is usable.'
                  : 'Events, course details, player information, recent messages, and required app files are being saved to this device.'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 18,
    backgroundColor: colors.bg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  brandMark: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.highlight,
  },
  brand: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 2.2,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  eyebrow: {
    color: colors.highlight,
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 1.6,
    marginBottom: 14,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: fonts.serif,
    fontSize: 45,
    lineHeight: 48,
    marginBottom: 14,
  },
  warning: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 23,
  },
  supporting: {
    color: colors.textSupporting,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    minHeight: 42,
  },
  progressTrack: {
    height: 8,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
    marginTop: 28,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.highlight,
  },
  progressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  progressPercent: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  progressCount: {
    color: colors.textMuted,
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.7,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 18,
    marginTop: 30,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  statusCopy: {
    flex: 1,
  },
  statusTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.7,
  },
  statusBody: {
    color: colors.textSupporting,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
});
