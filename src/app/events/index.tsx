import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import EventHome from '@/app/event';
import { eventPath } from '@/lib/routes';
import { useEvent } from '@/state/event';
import { EVENT_LIFECYCLE_LABELS } from '@/state/types';

export default function MyEvents() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    accountAccess,
    accessLoading,
    activeEventId,
    eventLoading,
  } = useEvent();
  const events = accountAccess?.events ?? [];
  const soleEventId = events.length === 1 ? events[0].id : null;
  const redirectTarget = accountAccess?.accountId === 'demo' ? '/' : null;
  const redirectingTo = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (
      accessLoading ||
      !redirectTarget ||
      redirectingTo.current === redirectTarget
    ) {
      return;
    }
    redirectingTo.current = redirectTarget;
    router.replace(redirectTarget as never);
  }, [accessLoading, redirectTarget, router]);

  if (
    accessLoading ||
    redirectTarget ||
    (soleEventId && (eventLoading || activeEventId !== soleEventId))
  ) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.highlight} />
      </View>
    );
  }

  // Preserve the original single-event experience without performing a
  // second route transition immediately after login. Event-aware navigation
  // from this screen still uses activeEventId and opens scoped routes.
  if (soleEventId) return <EventHome />;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 34, paddingBottom: insets.bottom + 36 },
        ]}>
        <Text style={styles.eyebrow}>BLURRY GOLF</Text>
        <Text style={styles.title}>My Events</Text>
        <Text style={styles.subtitle}>
          Choose the event you want to open. Scores, chats, and offline data stay
          inside that event.
        </Text>

        <View style={styles.list}>
          {events.map((event) => (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${event.name}`}
              style={styles.card}
              onPress={() => router.replace(eventPath(event.id, 'event') as never)}>
              <View style={styles.cardTop}>
                <Text style={styles.eventName}>{event.name}</Text>
                <Text style={styles.status}>
                  {EVENT_LIFECYCLE_LABELS[event.lifecycleStatus]}
                </Text>
              </View>
              <Text style={styles.course}>{event.courseName}</Text>
              <Text style={styles.date}>
                {new Date(`${event.eventDate}T12:00:00`).toLocaleDateString(undefined, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
              <Text style={styles.role}>
                {accountAccess?.profile?.isClubAdmin
                  ? 'CLUB ADMIN'
                  : event.registration?.isAdmin
                    ? 'EVENT ADMIN'
                    : 'PARTICIPANT'}
              </Text>
            </Pressable>
          ))}
        </View>

        {events.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>NO EVENTS YET</Text>
            <Text style={styles.emptyBody}>
              Redeem the invite code from an event organizer to add it here.
            </Text>
          </View>
        ) : null}

        <Pressable style={styles.inviteButton} onPress={() => router.push('/invite')}>
          <Text style={styles.inviteText}>REDEEM AN EVENT INVITE</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  content: { paddingHorizontal: 20, gap: 14 },
  eyebrow: { fontFamily: fonts.bold, fontSize: 11, color: colors.highlight },
  title: { fontFamily: fonts.serif, fontSize: 44, color: '#ffffff' },
  subtitle: {
    maxWidth: 460,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    marginBottom: 12,
  },
  list: { gap: 12 },
  card: {
    padding: 18,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.14)',
    backgroundColor: 'rgba(15,17,16,0.46)',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eventName: { flex: 1, fontFamily: fonts.serif, fontSize: 27, color: '#ffffff' },
  status: { fontFamily: fonts.bold, fontSize: 9, color: colors.highlight },
  course: { fontFamily: fonts.bold, fontSize: 12, color: colors.link },
  date: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },
  role: { marginTop: 6, fontFamily: fonts.bold, fontSize: 9, color: '#ffffff' },
  empty: { paddingVertical: 30, gap: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 13, color: '#ffffff' },
  emptyBody: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted },
  inviteButton: {
    minHeight: 54,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(123,255,178,0.12)',
  },
  inviteText: { fontFamily: fonts.bold, fontSize: 11, color: colors.highlight },
});
