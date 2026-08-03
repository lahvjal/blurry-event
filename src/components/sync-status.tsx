import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/constants/theme';
import { SyncStatus, getSyncStatus, subscribeToSync, syncNow } from '@/lib/sync';

/** Live view of the sync engine, for any screen that wants to show state. */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);
  useEffect(() => subscribeToSync(setStatus), []);
  return status;
}

function describe(status: SyncStatus): string {
  const { connection, failed, pending } = status;
  const waiting = `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to sync`;

  if (failed > 0) {
    return pending > 0
      ? `${failed} ${failed === 1 ? 'change needs' : 'changes need'} attention · ${waiting}`
      : `${failed} saved ${failed === 1 ? 'change needs' : 'changes need'} attention`;
  }

  switch (connection) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return pending > 0 ? `Offline · ${waiting}` : 'Offline · scores save on this device';
    case 'error':
      return pending > 0 ? `Sync problem · ${waiting}` : 'Sync problem';
    case 'online':
      return pending > 0 ? waiting : 'All scores synced';
  }
}

/**
 * A quiet one-line status.
 *
 * Losing signal on a golf course is expected, not an error, so this stays a
 * subdued line rather than a banner or a modal. It only turns amber when
 * something actually needs a human — and even then, scores keep saving.
 */
export function SyncStatusLine({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();
  const { connection, pending } = status;

  // Nothing outstanding and nothing wrong: don't take up space saying so.
  if (connection === 'online' && pending === 0) return null;

  const attention = connection === 'error';
  const canRetry =
    (pending > 0 || status.failed > 0) && connection !== 'syncing';

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <View
        style={[
          styles.dot,
          connection === 'offline' && styles.dotOffline,
          connection === 'syncing' && styles.dotSyncing,
          attention && styles.dotError,
        ]}
      />
      {connection === 'syncing' ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : null}
      <Text style={[styles.text, attention && styles.textError]} numberOfLines={1}>
        {describe(status)}
      </Text>
      {canRetry ? (
        <Pressable onPress={() => void syncNow()} hitSlop={10}>
          <Text style={styles.retry}>SYNC NOW</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Confirmation that a score is safe on the device, shown next to the scorecard.
 * Deliberately says "saved on this device" rather than "saved", because that's
 * the honest guarantee while there's no signal.
 */
export function SavedLocallyNote() {
  const { connection, focusedFailed, focusedPending } = useSyncStatus();
  if (focusedPending === 0) return null;
  if (focusedFailed > 0) {
    return (
      <Text style={styles.note}>
        Saved on this device — tap Sync Now when your connection is usable.
      </Text>
    );
  }
  const offline = connection === 'offline' || connection === 'error';
  return (
    <Text style={styles.note}>
      {offline
        ? 'Saved on this device — will sync when you’re back in range.'
        : 'Saving to the club…'}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  rowCompact: {
    paddingHorizontal: 0,
    paddingVertical: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.highlight,
  },
  dotOffline: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotSyncing: {
    backgroundColor: colors.link,
  },
  dotError: {
    backgroundColor: '#ffcf8b',
  },
  text: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  textError: {
    color: '#ffcf8b',
  },
  retry: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
  },
  note: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    paddingVertical: 6,
  },
});
