import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/constants/theme';
import {
  PushState,
  disablePush,
  enablePush,
  isPushEnabled,
  pushState,
} from '@/lib/push';

const promptSeenKey = (accountId: string) => `blurry.push.promptSeen.v2:${accountId}`;

/**
 * Shared push state for the Profile toggle and the Messages prompt. Both read
 * the same live values, so turning notifications on in one place settles the
 * other immediately.
 */
export function usePush() {
  const [state, setState] = useState<PushState>('unsupported');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setState(pushState());
    setEnabled(await isPushEnabled());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      setState(await enablePush());
    } finally {
      setEnabled(await isPushEnabled());
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush();
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [refresh]);

  return { state, enabled, busy, enable, disable, refresh };
}

/** What the current state means, in the words a golfer would use. */
function explain(state: PushState, enabled: boolean): string {
  if (enabled) return 'On for this device.';
  switch (state) {
    case 'needs-install':
      return 'Add Blurry to your home screen first — iPhone only sends notifications to installed apps.';
    case 'denied':
      return 'Blocked. Turn notifications back on for this site in your browser settings.';
    case 'unsupported':
      return 'This browser can’t receive notifications.';
    default:
      return 'Messages, announcements and tee time changes.';
  }
}

/** Profile row. Hidden entirely where push could never work. */
export function PushToggleRow({ disabled = false }: { disabled?: boolean }) {
  const { state, enabled, busy, enable, disable } = usePush();

  if (state === 'unsupported') return null;

  const actionable = state === 'default' || state === 'granted';

  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>NOTIFICATIONS</Text>
        <Text style={styles.rowHint}>
          {disabled
            ? 'Reconnect to change notification settings for this device.'
            : explain(state, enabled)}
        </Text>
      </View>
      {actionable ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Notifications"
          accessibilityState={{ checked: enabled, disabled: busy || disabled }}
          accessibilityHint={
            disabled ? 'Changing notifications requires a connection.' : undefined
          }
          disabled={busy || disabled}
          onPress={enabled ? disable : enable}
          style={[
            styles.switch,
            enabled && styles.switchOn,
            (busy || disabled) && styles.switchBusy,
          ]}>
          <View style={[styles.knob, enabled && styles.knobOn]} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One-time nudge on the Messages screen. Dismissal is remembered so this is
 * genuinely once — a banner that keeps coming back reads as a nag, and the
 * Profile toggle is always there for anyone who changes their mind.
 */
export function PushPrompt({ accountId }: { accountId: string | null }) {
  const { state, enabled, busy, enable } = usePush();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    AsyncStorage.getItem(promptSeenKey(accountId))
      .then((seen) => setDismissed(seen === 'true'))
      .catch(() => setDismissed(true));
  }, [accountId]);

  const close = () => {
    setDismissed(true);
    if (accountId) {
      void AsyncStorage.setItem(promptSeenKey(accountId), 'true').catch(() => {});
    }
  };

  // Only worth showing where tapping it would actually achieve something.
  if (dismissed || enabled || (state !== 'default' && state !== 'needs-install')) {
    return null;
  }

  const installOnly = state === 'needs-install';

  return (
    <View style={styles.prompt}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.promptTitle}>
          {installOnly ? 'ADD TO HOME SCREEN' : 'TURN ON NOTIFICATIONS'}
        </Text>
        <Text style={styles.promptBody}>
          {installOnly
            ? 'Share → Add to Home Screen, then open Blurry from your home screen to get message alerts.'
            : 'Get a heads up when someone messages you or the tee times move.'}
        </Text>
      </View>
      <View style={styles.promptActions}>
        {!installOnly ? (
          <Pressable
            disabled={busy}
            onPress={async () => {
              await enable();
              close();
            }}>
            <Text style={styles.promptEnable}>ALLOW</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={close} hitSlop={10}>
          <Text style={styles.promptDismiss}>{installOnly ? 'GOT IT' : 'NOT NOW'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * First-run notification request on the installed app's Home screen. The
 * browser prompt itself is deliberately behind the explicit ALLOW tap: Safari
 * rejects permission requests that are not initiated by a user gesture.
 */
export function HomeScreenPushPrompt({ accountId }: { accountId: string | null }) {
  const { state, enabled, busy, enable } = usePush();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    AsyncStorage.getItem(promptSeenKey(accountId))
      .then((seen) => setDismissed(seen === 'true'))
      .catch(() => setDismissed(true));
  }, [accountId]);

  const close = () => {
    setDismissed(true);
    if (accountId) {
      void AsyncStorage.setItem(promptSeenKey(accountId), 'true').catch(() => {});
    }
  };

  // OperationalApp only mounts inside a standalone PWA. Avoid a fallback
  // prompt when the platform cannot ever show the system permission panel.
  if (!accountId || dismissed || enabled || state !== 'default') return null;

  return (
    <View accessibilityRole="alert" style={styles.homePrompt}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.promptTitle}>TURN ON NOTIFICATIONS</Text>
        <Text style={styles.promptBody}>
          Get event updates, messages, and tee-time changes on this device.
        </Text>
      </View>
      <View style={styles.promptActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enable notifications"
          disabled={busy}
          onPress={async () => {
            await enable();
            close();
          }}>
          <Text style={styles.promptEnable}>{busy ? 'OPENING…' : 'ALLOW'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={close} hitSlop={10}>
          <Text style={styles.promptDismiss}>NOT NOW</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  rowText: {
    flex: 1,
    gap: 6,
  },
  rowLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  rowHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 17,
  },
  switch: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.14)',
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: {
    backgroundColor: colors.highlight,
  },
  switchBusy: {
    opacity: 0.5,
  },
  knob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  knobOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#131715',
  },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 16,
    backgroundColor: 'rgba(123,255,178,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.2)',
  },
  homePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: 'rgba(123,255,178,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.25)',
  },
  promptTitle: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
    letterSpacing: 0.4,
  },
  promptBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 17,
  },
  promptActions: {
    alignItems: 'flex-end',
    gap: 14,
  },
  promptEnable: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  promptDismiss: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
});
