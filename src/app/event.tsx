import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import {
  HOME_HERO_TOP_OFFSET,
  HomeHeader,
} from '@/components/home-header';
import { HomeEventSelector } from '@/components/home-event-selector';
import { ParticipantAvatar } from '@/components/participant-avatar';
import {
  Badge,
  Chevron,
  GradientPanel,
  LinkAction,
  Noise,
  SectionLabel,
} from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { openTeamConversation } from '@/lib/chat';
import { useEvent } from '@/state/event';
import { useNotificationUnread } from '@/state/notification-center';
import {
  EventConfig,
  LeaderboardRow,
  ScoreUpdate,
  formatToPar,
  isTeamFormat,
} from '@/state/types';

const roundFlag = require('@/assets/figma/round-flag-circle.svg');
const holeFlag = require('@/assets/figma/hole-flag.svg');
const announcementPin = require('@/assets/figma/announcement-pin.svg');

type Achievement = {
  id: string;
  text: string;
};

function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysUntil(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function splitTime(value: string | null): {
  clock: string;
  meridiem: string;
} {
  const match = value?.trim().toUpperCase().match(/^(.+?)\s+(AM|PM)$/);
  return match
    ? { clock: match[1], meridiem: match[2] }
    : { clock: value?.trim() || 'TBD', meridiem: '' };
}

function relativeTime(iso: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 60) return 'JUST NOW';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} HR AGO`;
  const days = Math.floor(hours / 24);
  return `${days} DAY${days === 1 ? '' : 'S'} AGO`;
}

function displayToPar(value: number | null): string {
  return formatToPar(value).replace(/^-/, '−');
}

function competitionPosition(
  row: LeaderboardRow | undefined,
  leaderboard: LeaderboardRow[],
): { rank: number; tied: boolean } | null {
  if (!row || row.toPar === null) return null;
  const rank =
    leaderboard.filter(
      (candidate) =>
        candidate.toPar !== null && candidate.toPar < row.toPar!,
    ).length + 1;
  const tied =
    leaderboard.filter((candidate) => candidate.toPar === row.toPar).length > 1;
  return { rank, tied };
}

function buildAchievements(
  updates: ScoreUpdate[],
  event: EventConfig,
  leaderboard: LeaderboardRow[],
): Achievement[] {
  const scoreByHole = new Map(
    updates.map((update) => [
      `${update.entrantId}:${update.hole}`,
      update.strokes,
    ]),
  );
  const leader = leaderboard.find((row) => row.toPar !== null);
  const items: Achievement[] = [];

  for (const update of updates) {
    const hole = event.holes[update.hole - 1];
    const entrant = leaderboard.find(
      (row) => row.entrantId === update.entrantId,
    );
    if (!hole || !entrant) continue;

    const relative = update.strokes - hole.par;
    const previousHole = update.hole === 1 ? 18 : update.hole - 1;
    const previousStrokes = scoreByHole.get(
      `${update.entrantId}:${previousHole}`,
    );
    const previousPar = event.holes[previousHole - 1]?.par;
    const consecutiveBirdies =
      relative === -1 &&
      previousStrokes !== undefined &&
      previousPar !== undefined &&
      previousStrokes - previousPar === -1;

    let achievement: string | null = null;
    if (update.strokes === 1) {
      achievement = `${entrant.name} aced hole ${update.hole}`;
    } else if (relative <= -3) {
      achievement = `${entrant.name} made an albatross on hole ${update.hole}`;
    } else if (relative === -2) {
      achievement = `${entrant.name} eagled hole ${update.hole}`;
    } else if (consecutiveBirdies) {
      achievement = `${entrant.name} carded back-to-back birdies`;
    } else if (relative === -1) {
      achievement = `${entrant.name} birdied hole ${update.hole}`;
    }
    if (!achievement) continue;

    if (leader?.toPar !== null && entrant.toPar === leader?.toPar) {
      const leaders = leaderboard.filter(
        (row) => row.toPar !== null && row.toPar === leader.toPar,
      ).length;
      achievement += leaders > 1 ? ' and shares the lead' : ' and now leads';
    }

    items.push({
      id: `${update.entrantId}:${update.hole}:${update.updatedAt}`,
      text: achievement,
    });
    if (items.length === 5) break;
  }

  return items;
}

function AchievementTicker({
  achievements,
  storageKey,
}: {
  achievements: Achievement[];
  storageKey: string;
}) {
  const [quiet, setQuiet] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const opacity = React.useRef(new Animated.Value(1)).current;
  const items =
    achievements.length > 0
      ? achievements
      : [
          {
            id: 'waiting',
            text: 'Achievements from across the event will appear here',
          },
        ];

  React.useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey)
      .then((value) => {
        if (active) setQuiet(value === 'true');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [storageKey]);

  React.useEffect(() => {
    setIndex((current) => Math.min(current, items.length - 1));
  }, [items.length]);

  React.useEffect(() => {
    if (quiet || items.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        setIndex((current) => (current + 1) % items.length);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }).start();
      });
    }, 6000);
    return () => clearInterval(timer);
  }, [items.length, opacity, quiet]);

  const setQuietPersisted = (next: boolean) => {
    setQuiet(next);
    void AsyncStorage.setItem(storageKey, String(next)).catch(() => {});
  };

  if (quiet) {
    return (
      <Pressable
        style={styles.quietTicker}
        onPress={() => setQuietPersisted(false)}>
        <Text style={styles.quietText}>ACHIEVEMENT ALERTS QUIET</Text>
        <Text style={styles.quietAction}>SHOW</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.achievementTicker}>
      <View style={styles.activityDot} />
      <Animated.Text
        numberOfLines={1}
        style={[styles.achievementText, { opacity }]}>
        {items[index]?.text}
      </Animated.Text>
      <Pressable hitSlop={10} onPress={() => setQuietPersisted(true)}>
        <Text style={styles.quietAction}>QUIET</Text>
      </Pressable>
    </View>
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
    currentHoleIndex,
    announcements,
    leaderboard,
    scoreUpdates,
    participantById,
    isLive,
  } = useEvent();
  const [headerStuck, setHeaderStuck] = React.useState(false);
  const [openingTeamChat, setOpeningTeamChat] = React.useState(false);

  const holesPlayed = myScores.filter((score) => score !== null).length;
  const roundStarted = holesPlayed > 0;
  const complete = holesPlayed === 18;
  const dayCount = daysUntil(event.eventDate);
  const isEventDay = localIsoDate() === event.eventDate;
  const eventEnded =
    event.lifecycleStatus === 'completed' ||
    event.lifecycleStatus === 'archived' ||
    (event.lifecycleStatus === 'published' && dayCount < 0);
  const canStart =
    !eventEnded &&
    isEventDay &&
    (!isTeamFormat(event.gameStyle) || Boolean(myTeam));
  const myRow = leaderboard.find((row) => row.isMine);
  const position = competitionPosition(myRow, leaderboard);
  const leader = leaderboard.find((row) => row.toPar !== null);
  const gapToLead =
    myRow?.toPar !== null &&
    myRow?.toPar !== undefined &&
    leader?.toPar !== null &&
    leader?.toPar !== undefined
      ? Math.max(0, myRow.toPar - leader.toPar)
      : null;
  const nextHole = currentHoleIndex + 1;
  const teeTime = splitTime(myTeam?.teeTime ?? event.startTime);

  const announcementIds = React.useMemo(
    () => announcements.map((announcement) => announcement.id),
    [announcements],
  );
  const notificationUnread = useNotificationUnread(
    `${event.id}.${me.id}`,
    announcementIds,
    event.id,
  );
  const latestAnnouncement = announcements[0];

  const teammates = React.useMemo(
    () =>
      (myTeam?.memberIds ?? [])
        .map((id) => participantById(id))
        .filter((player): player is NonNullable<typeof player> => Boolean(player)),
    [myTeam?.memberIds, participantById],
  );
  const achievements = React.useMemo(
    () => buildAchievements(scoreUpdates, event, leaderboard),
    [event, leaderboard, scoreUpdates],
  );
  const playedLeaderboard = leaderboard.filter((row) => row.toPar !== null);
  const topThree = playedLeaderboard.slice(0, 3);
  const mineOutsideTopThree =
    myRow?.toPar !== null &&
    myRow?.toPar !== undefined &&
    !topThree.some((row) => row.entrantId === myRow.entrantId)
      ? myRow
      : null;

  const handleScroll = React.useCallback(
    (scrollEvent: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = scrollEvent.nativeEvent.contentOffset.y > 12;
      setHeaderStuck((current) => (current === next ? current : next));
    },
    [],
  );

  const openTeamChat = async () => {
    if (!myTeam || openingTeamChat) return;
    if (!isLive) {
      router.push('/my-team');
      return;
    }
    setOpeningTeamChat(true);
    try {
      const id = await openTeamConversation(myTeam.id);
      router.push({ pathname: '/group-conversation', params: { id } });
    } catch (caught) {
      Alert.alert(
        'Team chat unavailable',
        (caught as { message?: string })?.message ??
          'Could not open the team chat.',
      );
    } finally {
      setOpeningTeamChat(false);
    }
  };

  const openRound = () => {
    if (complete) {
      router.push('/complete-round');
      return;
    }
    if (roundStarted || canStart) router.push('/scorecard');
  };

  const statusLabel = eventEnded
    ? 'EVENT ENDED'
    : event.lifecycleStatus === 'draft'
      ? 'EVENT DRAFT'
      : complete
    ? 'ROUND COMPLETE'
    : roundStarted
      ? 'ROUND IN PROGRESS'
      : dayCount > 1
        ? `STARTS IN ${dayCount} DAYS`
        : dayCount === 1
          ? 'STARTS TOMORROW'
          : dayCount === 0
            ? 'STARTS TODAY'
            : 'EVENT ENDED';
  const roundAction = complete
    ? 'VIEW FINAL CARD'
    : roundStarted
      ? 'CONTINUE ROUND'
      : 'START ROUND';
  const metricCaption = roundStarted
    ? complete
      ? '18 HOLES COMPLETE'
      : gapToLead === 0
        ? `THRU ${holesPlayed} · ${position?.tied ? 'TIED FOR THE LEAD' : 'LEADING'}`
        : gapToLead === null
          ? `THRU ${holesPlayed}`
          : `THRU ${holesPlayed} · ${gapToLead} STROKE${gapToLead === 1 ? '' : 'S'} OFF THE LEAD`
    : `START HOLE ${myTeam?.startingHole ?? 'TBD'}`;

  return (
    <View style={styles.root}>
      <Noise />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + HOME_HERO_TOP_OFFSET,
          paddingHorizontal: 10,
          paddingBottom: 130,
          gap: 40,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}>
        <View style={styles.primary}>
          <View style={styles.greetingBlock}>
            <Text style={styles.greeting}>
              {greeting()}, {me.fullName.split(' ')[0]}.
            </Text>
            <Text style={styles.subGreeting}>LET’S PLAY SOME GOLF.</Text>
          </View>

          {me.isAdmin ? (
            <Pressable
              style={styles.adminButton}
              onPress={() => router.push('/admin')}>
              <Text style={styles.adminButtonText}>EVENT ADMIN</Text>
              <Chevron color={colors.highlight} />
            </Pressable>
          ) : null}

          <HomeEventSelector />

          <GradientPanel
            colors={eventEnded ? ['#202421', '#151816'] : ['#1d2922', '#161e1a']}
            style={[styles.eventCard, eventEnded && styles.eventCardEnded]}>
            <View style={styles.eventTop}>
              <View style={styles.eventTitleBlock}>
                <Text numberOfLines={1} style={styles.eventTitle}>
                  {event.name}
                </Text>
                <Text numberOfLines={1} style={styles.eventCourse}>
                  {event.courseName}
                </Text>
              </View>
              <Text style={styles.teamTag}>
                {isTeamFormat(event.gameStyle)
                  ? (myTeam?.name ?? 'UNASSIGNED')
                  : 'SOLO'}
              </Text>
            </View>

            <View style={styles.statusWrap}>
              <Badge
                label={statusLabel}
                color={eventEnded ? colors.textMuted : roundStarted ? colors.highlight : colors.link}
                background={eventEnded ? '#282d2a' : colors.bgElevated}
                style={styles.statusBadge}
              />
            </View>

            {roundStarted ? (
              <View style={styles.liveMetrics}>
                <Text style={styles.liveMetric}>
                  {position
                    ? `${position.tied ? 'T' : ''}${position.rank}`
                    : '—'}
                </Text>
                <View style={styles.metricDivider} />
                <Text style={styles.liveMetric}>
                  {displayToPar(myRow?.toPar ?? null)}
                </Text>
              </View>
            ) : (
              <View style={styles.timeMetric}>
                <Text style={styles.timeClock}>{teeTime.clock}</Text>
                {teeTime.meridiem ? (
                  <Text style={styles.timeMeridiem}>{teeTime.meridiem}</Text>
                ) : null}
              </View>
            )}

            <Text style={styles.metricCaption}>{metricCaption}</Text>

            <Pressable
              accessibilityRole="button"
              disabled={!roundStarted && !canStart}
              onPress={openRound}>
              <LinearGradient
                colors={['#203329', '#1b2a22']}
                style={styles.roundAction}>
                <View
                  style={[
                    styles.roundActionLeft,
                    !roundStarted && !canStart && styles.disabledAction,
                  ]}>
                  <Image
                    source={roundFlag}
                    style={styles.roundFlag}
                    contentFit="contain"
                  />
                  <Text style={styles.roundActionText}>{roundAction}</Text>
                </View>
                <View
                  style={!roundStarted && !canStart && styles.disabledAction}>
                  <Chevron color="#ffffff" />
                </View>
              </LinearGradient>
            </Pressable>

            {roundStarted && !complete ? (
              <View style={styles.nextHoleRow}>
                <View style={styles.nextHoleText}>
                  <Text style={styles.nextHoleLabel}>NEXT HOLE:</Text>
                  <Text style={styles.nextHoleValue}>HOLE {nextHole}</Text>
                </View>
                <View style={styles.nextHoleFlagWrap}>
                  <Image
                    source={holeFlag}
                    style={styles.nextHoleFlag}
                    contentFit="contain"
                  />
                </View>
              </View>
            ) : null}
          </GradientPanel>

          {roundStarted ? (
            <AchievementTicker
              achievements={achievements}
              storageKey={`blurry.achievement-alerts.quiet.${event.id}.${me.id}`}
            />
          ) : null}

          {latestAnnouncement ? (
            <Pressable
              style={styles.announcementCard}
              onPress={() => router.push('/announcements')}>
              <View style={styles.announcementTop}>
                <View style={styles.announcementLabel}>
                  <Image
                    source={announcementPin}
                    style={styles.announcementPin}
                    contentFit="contain"
                  />
                  <Text style={styles.announcementKicker}>EVENT UPDATE</Text>
                </View>
                <View style={styles.announcementMeta}>
                  <Text style={styles.announcementWhen}>
                    {relativeTime(latestAnnouncement.createdAt)}
                  </Text>
                  <Text style={styles.pinned}>PINNED</Text>
                </View>
              </View>
              <Text style={styles.announcementBody}>
                {latestAnnouncement.body}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionLabel>course</SectionLabel>
            <LinkAction
              label="view map"
              onPress={() => router.push('/course-map')}
            />
          </View>
          <Pressable onPress={() => router.push('/course-map')}>
            <GradientPanel
              colors={['#203329', '#151e19']}
              style={styles.coursePreview}>
              <View style={styles.courseCaption}>
                <Text style={styles.courseCaptionText}>
                  {roundStarted ? 'NEXT TEE' : 'YOU START'}
                </Text>
                <View style={styles.microDot} />
                <Text style={styles.courseCaptionText}>
                  HOLE {roundStarted ? nextHole : (myTeam?.startingHole ?? 'TBD')}
                </Text>
              </View>
            </GradientPanel>
          </Pressable>
        </View>

        {roundStarted ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <SectionLabel>event standings</SectionLabel>
              <LinkAction
                label="view all"
                onPress={() => router.push('/leaderboard')}
              />
            </View>
            <Pressable onPress={() => router.push('/leaderboard')}>
              <View style={styles.standings}>
                {topThree.map((row, index) => (
                  <StandingRow
                    key={row.entrantId}
                    row={row}
                    leaderboard={leaderboard}
                    first={index === 0}
                  />
                ))}
                {mineOutsideTopThree ? (
                  <>
                    <View style={styles.standingsDivider}>
                      <Text style={styles.standingsDividerText}>YOUR TEAM</Text>
                    </View>
                    <StandingRow
                      row={mineOutsideTopThree}
                      leaderboard={leaderboard}
                    />
                  </>
                ) : null}
              </View>
            </Pressable>
          </View>
        ) : myTeam ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <SectionLabel>{myTeam.name}</SectionLabel>
              <LinkAction
                label={openingTeamChat ? 'opening…' : 'view team'}
                onPress={() => void openTeamChat()}
              />
            </View>
            <View style={styles.playerList}>
              {teammates.map((player) => (
                <Pressable
                  key={player.id}
                  style={styles.playerRow}
                  onPress={() =>
                    router.push({
                      pathname: '/participant-profile',
                      params: { id: player.id },
                    })
                  }>
                  <View style={styles.playerIdentity}>
                    <ParticipantAvatar participant={player} size={37} />
                    <View style={styles.playerNameLine}>
                      <Text style={styles.playerName}>
                        {player.fullName.split(' ')[0]}
                        {player.fullName.split(' ')[1]
                          ? ` ${player.fullName.split(' ')[1][0]}.`
                          : ''}
                      </Text>
                      <View style={styles.microDot} />
                      <Text
                        style={
                          player.id === me.id
                            ? styles.youLabel
                            : styles.handicap
                        }>
                        {player.id === me.id
                          ? 'YOU'
                          : player.handicap === null
                            ? '— HCP'
                            : `${player.handicap} HCP`}
                      </Text>
                    </View>
                  </View>
                  <Chevron color="rgba(255,255,255,0.34)" />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <HomeHeader
        stuck={headerStuck}
        unread={notificationUnread}
        onPressNotifications={() => router.push('/notifications')}
      />
      <FloatingNav />
    </View>
  );
}

function StandingRow({
  row,
  leaderboard,
  first = false,
}: {
  row: LeaderboardRow;
  leaderboard: LeaderboardRow[];
  first?: boolean;
}) {
  const position = competitionPosition(row, leaderboard);
  return (
    <View style={[styles.standingRow, row.isMine && styles.myStandingRow]}>
      <Text
        style={[
          styles.standingRank,
          first && styles.firstStandingRank,
        ]}>
        {position
          ? `${position.tied ? 'T' : ''}${position.rank}`
          : '—'}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.standingName, row.isMine && styles.myStandingText]}>
        {row.name}
      </Text>
      <Text style={styles.standingThru}>THRU {row.thru}</Text>
      <Text
        style={[styles.standingScore, row.isMine && styles.myStandingText]}>
        {displayToPar(row.toPar)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  primary: {
    gap: 10,
  },
  greetingBlock: {
    gap: 16,
    marginBottom: 10,
  },
  greeting: {
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 44,
    color: '#ffffff',
  },
  subGreeting: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.textMuted,
  },
  adminButton: {
    height: 48,
    marginBottom: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2d3832',
    backgroundColor: 'rgba(255,255,255,0.025)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adminButtonText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  eventCard: {
    width: '100%',
  },
  eventCardEnded: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  eventTop: {
    minHeight: 58,
    paddingTop: 20,
    paddingBottom: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  eventTitleBlock: {
    flex: 1,
    gap: 8,
  },
  eventTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  eventCourse: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  teamTag: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
    textTransform: 'uppercase',
  },
  statusWrap: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  statusBadge: {
    alignSelf: 'center',
  },
  timeMetric: {
    minHeight: 112,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },
  timeClock: {
    fontFamily: fonts.serif,
    fontSize: 82,
    lineHeight: 92,
    color: '#ffffff',
  },
  timeMeridiem: {
    fontFamily: fonts.serif,
    fontSize: 36,
    lineHeight: 56,
    color: '#ffffff',
  },
  liveMetrics: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveMetric: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 82,
    lineHeight: 92,
    color: '#ffffff',
    textAlign: 'center',
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 70,
    backgroundColor: '#2d3832',
  },
  metricCaption: {
    paddingTop: 2,
    paddingBottom: 20,
    paddingHorizontal: 16,
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  roundAction: {
    minHeight: 78,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roundActionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  disabledAction: {
    opacity: 0.3,
  },
  roundFlag: {
    width: 31,
    height: 31,
  },
  roundActionText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  nextHoleRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  nextHoleText: {
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nextHoleLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
  },
  nextHoleValue: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  nextHoleFlagWrap: {
    width: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextHoleFlag: {
    width: 12,
    height: 12,
  },
  achievementTicker: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#2d3832',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activityDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.highlight,
  },
  achievementText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 10,
    letterSpacing: 1.55,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  quietTicker: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#2d3832',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quietText: {
    fontFamily: fonts.regular,
    fontSize: 10,
    letterSpacing: 1.4,
    color: 'rgba(255,255,255,0.45)',
  },
  quietAction: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.48)',
  },
  announcementCard: {
    minHeight: 80,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#2d3832',
    borderLeftWidth: 2,
    borderLeftColor: colors.highlight,
    gap: 14,
  },
  announcementTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  announcementLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  announcementPin: {
    width: 12,
    height: 15,
  },
  announcementKicker: {
    fontFamily: fonts.regular,
    fontSize: 10,
    letterSpacing: 1.6,
    color: '#ffffff',
  },
  announcementMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  announcementWhen: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
  },
  pinned: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.highlight,
  },
  announcementBody: {
    paddingLeft: 22,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: '#ffffff',
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coursePreview: {
    height: 134,
    justifyContent: 'flex-end',
  },
  courseCaption: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  courseCaptionText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
  },
  microDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.link,
  },
  playerList: {
    gap: 4,
  },
  playerRow: {
    height: 48,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerName: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#ffffff',
  },
  youLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
  },
  handicap: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
  },
  standings: {
    gap: 4,
  },
  standingRow: {
    height: 48,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  myStandingRow: {
    backgroundColor: '#16231c',
  },
  standingRank: {
    width: 18,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.textMuted,
  },
  firstStandingRank: {
    color: '#cfb447',
  },
  standingName: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#ffffff',
  },
  standingThru: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textMuted,
  },
  standingScore: {
    width: 48,
    fontFamily: fonts.serif,
    fontSize: 24,
    color: '#ffffff',
    textAlign: 'right',
  },
  myStandingText: {
    color: colors.highlight,
  },
  standingsDivider: {
    height: 24,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#2d3832',
  },
  standingsDividerText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.textMuted,
  },
});
