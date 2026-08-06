import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';

export function OfflineNotice({
  message,
  compact = false,
  style,
}: {
  message: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const label = `You're offline. ${message}`;

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={[styles.notice, compact && styles.noticeCompact, style]}>
      <View style={styles.dot} />
      <View style={styles.noticeCopy}>
        <Text style={styles.eyebrow}>YOU’RE OFFLINE</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
  );
}

/** A focused stop-state for routes whose only purpose is a server mutation. */
export function OfflineMutationScreen({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={['#203329', '#1b2a22']}
        style={StyleSheet.absoluteFill}
      />
      <Noise />
      <PageHeader title={title} showMore={false} />
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`Connection required. ${description} This screen will be available again automatically when your connection returns.`}
        style={[styles.screenContent, { paddingTop: insets.top + 54 + 56 }]}
        accessibilityLiveRegion="polite">
        <Text style={styles.screenEyebrow}>CONNECTION REQUIRED</Text>
        <Text style={styles.screenTitle}>Reconnect to continue</Text>
        <Text style={styles.screenBody}>{description}</Text>
        <Text style={styles.screenFootnote}>
          This screen will be available again automatically when your connection
          returns.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,207,139,0.25)',
    backgroundColor: 'rgba(255,207,139,0.07)',
  },
  noticeCompact: {
    minHeight: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dot: {
    width: 7,
    height: 7,
    marginTop: 3,
    borderRadius: 4,
    backgroundColor: '#ffcf8b',
  },
  noticeCopy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    color: '#ffcf8b',
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  message: {
    color: 'rgba(255,255,255,0.68)',
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screenContent: {
    flex: 1,
    paddingHorizontal: 24,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  screenEyebrow: {
    color: '#ffcf8b',
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  screenTitle: {
    marginTop: 14,
    color: '#ffffff',
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 44,
  },
  screenBody: {
    marginTop: 14,
    color: 'rgba(255,255,255,0.68)',
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  screenFootnote: {
    marginTop: 22,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
});
