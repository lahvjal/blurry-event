import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { SyncStatusLine } from '@/components/sync-status';
import {
  AvatarStack,
  Badge,
  Chevron,
  GradientPanel,
  LinkAction,
  Noise,
  SectionLabel,
} from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { localAvatar, useEvent } from '@/state/event';
import {
  GAME_STYLE_LABELS,
  formatToPar,
  fullAddress,
  isTeamFormat,
  mapsUrl,
  shortLocation,
  sumScores,
} from '@/state/types';

const clubBg = require('@/assets/figma/club-card-bg.png');
const logoSmall = require('@/assets/figma/logo-small.svg');
const plusCircle = require('@/assets/figma/plus-circle.svg');

function daysUntil(iso: string): number {
  const target = new Date(`${iso}T07:00:00`);
  const now = new Date();
  const ms = target.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function QuickLink({
  label,
  value,
  onPress,
  disabled,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.quickLink, disabled && styles.quickLinkDisabled]}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.quickLinkLabel}>{label}</Text>
        {/* Addresses can run long — keep the row a single line. */}
        <Text style={styles.quickLinkValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {disabled ? (
        <Text style={styles.soon}>SOON</Text>
      ) : (
        <Chevron color="rgba(255,255,255,0.5)" />
      )}
    </Pressable>
  );
}

export default function EventHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    event,
    me,
    myTeam,
    myScores,
    participants,
    announcements,
    leaderboard,
    participantById,
  } = useEvent();

  const days = daysUntil(event.eventDate);
  const holesPlayed = myScores.filter((s) => s !== null).length;
  const inProgress = holesPlayed > 0;
  const complete = holesPlayed === 18;
  const total = sumScores(myScores);

  const myRank = leaderboard.findIndex((row) => row.isMine) + 1;
  const myRow = leaderboard.find((row) => row.isMine);

  const teammates = myTeam
    ? myTeam.memberIds
        .map((id) => participantById(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
    : [];

  const teamAvatars = teammates
    .map((p) => localAvatar(p.id))
    .filter((src): src is number => src !== null);

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={[styles.hero, { paddingTop: insets.top + 16 }]}>
          <ImageBackground
            source={clubBg}
            style={[StyleSheet.absoluteFill, { opacity: 0.45 }]}
            resizeMode="cover"
          />
          <View style={styles.heroTop}>
            <Image source={logoSmall} style={styles.heroLogo} contentFit="contain" />
            <Badge label={complete ? 'ROUND COMPLETE' : inProgress ? 'ROUND LIVE' : 'REGISTERED'} />
          </View>
          <Text style={styles.eventName}>{event.name}</Text>
          <Text style={styles.eventMeta}>
            {event.courseName} · {shortLocation(event)}
          </Text>
          <Text style={styles.countdown}>
            {days > 0 ? `${days} DAYS OUT` : days === 0 ? 'TODAY' : 'COMPLETED'}
          </Text>
        </View>

        <View style={styles.body}>
          {/* My round at a glance */}
          <GradientPanel colors={colors.gradPanel} style={styles.statRow}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>TEE TIME</Text>
              <Text style={styles.statValue}>
                {myTeam?.teeTime?.replace(' AM', '') ?? '—'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>START HOLE</Text>
              <Text style={styles.statValue}>{myTeam?.startingHole ?? '—'}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>{inProgress ? 'THRU' : 'CHECK-IN'}</Text>
              <Text style={styles.statValue}>
                {inProgress ? holesPlayed : event.checkInTime.replace(' AM', '')}
              </Text>
            </View>
          </GradientPanel>

          <Text style={styles.formatNote}>
            {GAME_STYLE_LABELS[event.gameStyle]}
            {isTeamFormat(event.gameStyle) && myTeam ? ` · ${myTeam.name}` : ''}
          </Text>

          <SyncStatusLine compact />

          {/* Scoring CTA */}
          <Pressable onPress={() => router.push(complete ? '/complete-round' : '/scorecard')}>
            <View style={styles.cta}>
              <View style={styles.ctaLeft}>
                <Image source={plusCircle} style={{ width: 33, height: 33 }} />
                <Text style={styles.ctaText}>
                  {complete ? 'VIEW FINAL CARD' : inProgress ? 'CONTINUE ROUND' : 'START SCORING'}
                </Text>
              </View>
              <Chevron color="#131715" />
            </View>
          </Pressable>

          {inProgress ? (
            <View style={styles.progressRow}>
              <Text style={styles.progressText}>
                {total} strokes · {formatToPar(myRow?.toPar ?? null)}
              </Text>
              {myRank > 0 ? (
                <Text style={styles.progressRank}>
                  {myRank === 1 ? 'LEADING' : `${myRank}${ordinal(myRank)} PLACE`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* My team */}
          {myTeam ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <SectionLabel color={colors.link} size={10}>
                  my team
                </SectionLabel>
                <LinkAction label="view team" onPress={() => router.push('/my-team')} />
              </View>
              <Pressable onPress={() => router.push('/my-team')}>
                <View style={styles.teamCard}>
                  <View style={{ flex: 1, gap: 8 }}>
                    <Text style={styles.teamName}>{myTeam.name}</Text>
                    <Text style={styles.teamMeta}>
                      {teammates.map((p) => p.fullName.split(' ')[0]).join(' · ')}
                    </Text>
                  </View>
                  {teamAvatars.length > 0 ? <AvatarStack sources={teamAvatars} /> : null}
                  <Chevron />
                </View>
              </Pressable>
            </View>
          ) : null}

          {/* Quick links */}
          <View style={styles.section}>
            <SectionLabel color={colors.link} size={10}>
              event
            </SectionLabel>
            <View style={{ gap: 10 }}>
              <QuickLink
                label="LEADERBOARD"
                value={
                  myRank > 0
                    ? `You're ${myRank}${ordinal(myRank)} of ${leaderboard.length}`
                    : `${leaderboard.length} entrants`
                }
                onPress={() => router.push('/leaderboard')}
              />
              <QuickLink
                label="PLAYERS & TEAMS"
                value={`${participants.length} players · ${leaderboard.length} teams`}
                onPress={() => router.push('/directory')}
              />
              <QuickLink
                label="DIRECTIONS"
                value={fullAddress(event) || event.courseName}
                onPress={() => Linking.openURL(mapsUrl(event))}
              />
              <QuickLink
                label="COURSE MAP"
                value={
                  event.courseMapUrl
                    ? `${event.courseName} layout`
                    : 'Not posted yet'
                }
                onPress={() => router.push('/course-map')}
                disabled={!event.courseMapUrl && !me.isAdmin}
              />
            </View>
          </View>

          {/* Announcements */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <SectionLabel color={colors.link} size={10}>
                announcements
              </SectionLabel>
              {announcements.length > 1 ? (
                <LinkAction label="see all" onPress={() => router.push('/announcements')} />
              ) : null}
            </View>
            {announcements.slice(0, 2).map((note) => (
              <View key={note.id} style={styles.noteCard}>
                <Text style={styles.noteAuthor}>FROM {note.authorName.toUpperCase()}</Text>
                <Text style={styles.noteBody}>{note.body}</Text>
              </View>
            ))}
          </View>

          {/* Admin */}
          {me.isAdmin ? (
            <Pressable style={styles.adminButton} onPress={() => router.push('/admin')}>
              <Text style={styles.adminText}>EVENT ADMIN</Text>
              <Chevron color={colors.highlight} />
            </Pressable>
          ) : null}
        </View>
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
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 10,
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  heroLogo: {
    width: 38.9,
    height: 38.2,
  },
  eventName: {
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 44,
    color: '#ffffff',
  },
  eventMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSupporting,
  },
  countdown: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
    letterSpacing: 1,
    marginTop: 4,
  },
  body: {
    padding: 20,
    gap: 20,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  statLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: fonts.serif,
    fontSize: 30,
    color: '#ffffff',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 14,
  },
  formatNote: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
    textAlign: 'center',
    marginTop: -10,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 28,
    backgroundColor: '#ffffff',
  },
  ctaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  ctaText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#131715',
    textTransform: 'uppercase',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -12,
  },
  progressText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  progressRank: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.45)',
  },
  teamName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  teamMeta: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
  },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.45)',
  },
  quickLinkDisabled: {
    opacity: 0.55,
  },
  quickLinkLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
  },
  quickLinkValue: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  soon: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
  },
  noteCard: {
    backgroundColor: 'rgba(15,17,16,0.35)',
    padding: 14,
    gap: 6,
  },
  noteAuthor: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.link,
  },
  noteBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#ffffff',
  },
  adminButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.25)',
  },
  adminText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.highlight,
    textTransform: 'uppercase',
  },
});
