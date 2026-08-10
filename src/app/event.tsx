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
import { OfflineNotice } from '@/components/offline-state';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { HomeScreenPushPrompt } from '@/components/push-controls';
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
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { eventPath } from '@/lib/routes';
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

function HomeNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <View accessibilityRole="alert" style={styles.homeNotice}>
      <Text style={styles.homeNoticeText}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss event notice"
        hitSlop={8}
        onPress={onDismiss}>
        <Text style={styles.homeNoticeDismiss}>DISMISS</Text>
      </Pressable>
    </View>
  );
}

function HomeWithoutFocusedEvent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const offline = useBrowserDefinitelyOffline();
  const {
    accountAccess,
    homeNotice,
    dismissHomeNotice,
  } = useEvent();
  const notificationUnread = useNotificationUnread(
    'account-home',
    [],
    accountAccess?.accountId ?? null,
    [],
  );
  const firstName =
    accountAccess?.profile?.displayName?.trim().split(/\s+/)[0] ?? 'there';

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <ScrollView
        contentContainerStyle={[
          { paddingTop: insets.top + HOME_HERO_TOP_OFFSET, paddingHorizontal: 10, paddingBottom: 130, gap: 40 },
        ]}>
        <View style={styles.primary}>
          <View style={styles.greetingBlock}>
            <Text style={styles.greeting}>{greeting()}, {firstName}.</Text>
            <Text style={styles.subGreeting}>LET’S PLAY SOME GOLF.</Text>
          </View>
          <HomeScreenPushPrompt accountId={accountAccess?.accountId ?? null} />
          {homeNotice ? <HomeNotice message={homeNotice} onDismiss={dismissHomeNotice} /> : null}
          <View style={styles.noEventSelector}>
            <Text style={styles.noEventSelectorLabel}>VIEWING EVENT</Text>
            <Text style={styles.noEventSelectorTitle}>NO EVENT SELECTED</Text>
          </View>
          <GradientPanel colors={['#1d2922', '#161e1a']} style={[styles.eventCard, styles.noEventDimmed]}>
            <View style={styles.eventTop}>
              <View style={styles.eventTitleBlock}>
                <Text style={styles.eventTitle}>No event selected</Text>
                <Text style={styles.eventCourse}>Choose or create an event to begin</Text>
              </View>
              <Text style={styles.teamTag}>—</Text>
            </View>
            <View style={styles.statusWrap}><Badge label="NO EVENT" color={colors.textMuted} background={colors.bgElevated} style={styles.statusBadge} /></View>
            <View style={styles.timeMetric}><Text style={styles.timeClock}>—</Text></View>
            <Text style={styles.metricCaption}>EVENT DETAILS WILL APPEAR HERE</Text>
            <View style={[styles.roundAction, styles.disabledAction]}>
              <View style={styles.roundActionLeft}><Image source={roundFlag} style={styles.roundFlag} contentFit="contain" /><Text style={styles.roundActionText}>START ROUND</Text></View>
              <Chevron color="#ffffff" />
            </View>
          </GradientPanel>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: offline }}
            disabled={offline}
            style={[styles.emptyHomePrimary, offline && styles.emptyHomeActionDisabled]}
            onPress={() => router.push(accountAccess?.profile?.isClubAdmin ? '/admin-events' : '/invite')}>
            <Text style={styles.emptyHomePrimaryText}>{accountAccess?.profile?.isClubAdmin ? 'CREATE OR MANAGE EVENTS' : 'REDEEM AN EVENT INVITE'}</Text>
          </Pressable>
        </View>
        <View style={[styles.section, styles.noEventDimmed]}>
          <View style={styles.sectionHeader}><SectionLabel>schedule</SectionLabel></View>
          <View style={styles.scheduleCard}><View style={styles.scheduleEmpty}><Text style={styles.scheduleTitle}>NO EVENT SELECTED</Text><Text style={styles.scheduleDetail}>Event timing will appear here.</Text></View></View>
        </View>
        <View style={[styles.section, styles.noEventDimmed]}>
          <View style={styles.sectionHeader}><SectionLabel>my team</SectionLabel><LinkAction label="open" onPress={() => {}} /></View>
          <View style={styles.myTeamCard}><View style={styles.myTeamCardCopy}><Text style={styles.myTeamCardTitle}>No team selected</Text><Text style={styles.myTeamCardDetail}>Join an event to see your team.</Text></View><Chevron color={colors.highlight} /></View>
        </View>
        <View style={[styles.section, styles.noEventDimmed]}>
          <View style={styles.sectionHeader}><SectionLabel>event standings</SectionLabel><LinkAction label="view all" onPress={() => router.push('/leaderboard')} /></View>
          <View style={styles.standings}><Text style={styles.metricCaption}>NO LEADERBOARD YET</Text></View>
        </View>
      </ScrollView>
      <HomeHeader
        stuck={false}
        unread={notificationUnread}
        onPressNotifications={() => router.push('/notifications')}
      />
      <FloatingNav />
    </View>
  );
}

export default function EventHome() {
  const {
    accessLoading,
    activeEventId,
    eventLoading,
  } = useEvent();

  if (accessLoading || eventLoading) {
    return (
      <View style={styles.homeLoading}>
        <Text style={styles.homeLoadingText}>OPENING HOME</Text>
      </View>
    );
  }
  if (!activeEventId) {
    // A stale deep link or a failed fetch must never turn the entire app into
    // an error screen when this account simply has no events. Home, Inbox and
    // Profile remain useful account-level destinations in that state.
    return <HomeWithoutFocusedEvent />;
  }
  return <FocusedEventHome />;
}

function FocusedEventHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const offline = useBrowserDefinitelyOffline();
  const {
    event,
    me,
    myTeam,
    myPlayingGroup,
    myScores,
    currentHoleIndex,
    announcements,
    leaderboard,
    scoreUpdates,
    participantById,
    isLive,
    homeNotice,
    dismissHomeNotice,
    accountAccess,
  } = useEvent();
  const [headerStuck, setHeaderStuck] = React.useState(false);
  const [openingTeamChat, setOpeningTeamChat] = React.useState(false);

  const holesPlayed = myScores.filter((score) => score !== null).length;
  const roundStarted = holesPlayed > 0;
  const complete = holesPlayed === 18;
  const isRegisteredPlayer = Boolean(
    accountAccess?.events.some(
      (accessibleEvent) =>
        accessibleEvent.id === event.id &&
        accessibleEvent.registration?.participantId === me.id,
    ),
  );
  const dayCount = daysUntil(event.eventDate);
  const isEventDay = localIsoDate() === event.eventDate;
  const eventEnded =
    event.lifecycleStatus === 'completed' ||
    event.lifecycleStatus === 'archived' ||
    (event.lifecycleStatus === 'published' && dayCount < 0);
  const canStart =
    !eventEnded &&
    isEventDay &&
    Boolean(myPlayingGroup) &&
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
  const teeTime = splitTime(myPlayingGroup?.teeTime ?? event.startTime);

  const announcementIds = React.useMemo(
    () => announcements.map((announcement) => announcement.id),
    [announcements],
  );
  const notificationUnread = useNotificationUnread(
    `${event.id}.${me.id}`,
    announcementIds,
    accountAccess?.accountId ?? null,
    accountAccess?.events
      .filter((item) => item.registration)
      .map((item) => item.id) ?? [],
  );
  const latestAnnouncement = announcements[0];

  const teammates = React.useMemo(
    () =>
      (myPlayingGroup?.memberIds ?? [])
        .map((id) => participantById(id))
        .filter((player): player is NonNullable<typeof player> => Boolean(player)),
    [myPlayingGroup?.memberIds, participantById],
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
      router.push(eventPath(event.id, 'my-team') as never);
      return;
    }
    if (offline) {
      // Team details are cached, while creating/reconciling the official team
      // conversation is a server mutation.
      router.push(eventPath(event.id, 'my-team') as never);
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
    : `START HOLE ${myPlayingGroup?.startingHole ?? 'TBD'}`;
  const myTeamTitle =
    myTeam?.name ?? myPlayingGroup?.name ?? 'Assignment pending';
  const myTeamDetail = myTeam
    ? `${myTeam.individualException ? 'ONE-PLAYER SCORING TEAM' : 'SCORING TEAM'} · ${
        myPlayingGroup
          ? `${myPlayingGroup.name.toUpperCase()} · HOLE ${myPlayingGroup.startingHole ?? 'TBD'}`
          : 'PLAYING GROUP PENDING'
      }`
    : myPlayingGroup
      ? `PLAYING GROUP · INDIVIDUAL SCORECARD · HOLE ${myPlayingGroup.startingHole ?? 'TBD'}`
      : isTeamFormat(event.gameStyle)
        ? 'No scoring team or playing group has been assigned yet.'
        : 'No playing group has been assigned yet. Your scorecard remains individual.';
  const openMyTeam = () =>
    router.push(eventPath(event.id, 'my-team') as never);

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

          <HomeScreenPushPrompt accountId={accountAccess?.accountId ?? null} />

          {homeNotice ? (
            <HomeNotice message={homeNotice} onDismiss={dismissHomeNotice} />
          ) : null}

          {me.isAdmin ? (
            <Pressable
              style={styles.adminButton}
              onPress={() => router.push(eventPath(event.id, 'admin') as never)}>
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
                  : (myPlayingGroup?.name ?? 'SOLO')}
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
            <SectionLabel>schedule</SectionLabel>
            <Text style={styles.scheduleDate}>{event.eventDate}</Text>
          </View>
          <GradientPanel colors={['#203329', '#151e19']} style={styles.scheduleCard}>
            {event.scheduleItems.length > 0 ? (
              event.scheduleItems.map((item, index) => (
                <View
                  key={`${item.time}-${item.title}-${index}`}
                  style={[
                    styles.scheduleItem,
                    index < event.scheduleItems.length - 1 && styles.scheduleItemBorder,
                  ]}>
                  <Text style={styles.scheduleTime}>{item.time}</Text>
                  <View style={styles.scheduleCopy}>
                    <Text style={styles.scheduleTitle}>{item.title}</Text>
                    {item.detail ? <Text style={styles.scheduleDetail}>{item.detail}</Text> : null}
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.scheduleEmpty}>
                <Text style={styles.scheduleTitle}>SCHEDULE COMING SOON</Text>
                <Text style={styles.scheduleDetail}>Event timing will be posted here.</Text>
              </View>
            )}
          </GradientPanel>
        </View>

        {isRegisteredPlayer ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <SectionLabel>my team</SectionLabel>
              <LinkAction label="open" onPress={openMyTeam} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open My Team"
              accessibilityHint={
                myTeam || myPlayingGroup
                  ? 'View your scoring team and playing group assignment.'
                  : 'View your pending team and playing group assignment.'
              }
              onPress={openMyTeam}
              style={({ pressed }) => [
                styles.myTeamCard,
                pressed && styles.myTeamCardPressed,
              ]}>
              <View style={styles.myTeamCardCopy}>
                <Text numberOfLines={1} style={styles.myTeamCardTitle}>
                  {myTeamTitle}
                </Text>
                <Text style={styles.myTeamCardDetail}>{myTeamDetail}</Text>
              </View>
              <Chevron color={colors.highlight} />
            </Pressable>
          </View>
        ) : null}

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
        ) : myPlayingGroup ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <SectionLabel>{myTeam?.name ?? myPlayingGroup.name}</SectionLabel>
              <LinkAction
                label={myTeam ? (openingTeamChat ? 'opening…' : 'view team') : 'view group'}
                onPress={
                  myTeam
                    ? () => void openTeamChat()
                    : openMyTeam
                }
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
  homeLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  homeLoadingText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  emptyHomeContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 16,
  },
  emptyHomeEyebrow: {
    marginTop: 20,
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.highlight,
  },
  emptyHomeTitle: {
    fontFamily: fonts.serif,
    fontSize: 42,
    lineHeight: 48,
    color: '#ffffff',
  },
  emptyHomeBody: {
    maxWidth: 480,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  emptyHomePrimary: {
    minHeight: 56,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(123,255,178,0.14)',
  },
  emptyHomePrimaryText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  emptyHomeSecondary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  emptyHomeActionDisabled: {
    opacity: 0.4,
  },
  emptyHomeSecondaryText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.55)',
  },
  homeNotice: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(238,190,104,0.35)',
    backgroundColor: 'rgba(76,57,24,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  homeNoticeText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: '#f2d49d',
  },
  homeNoticeDismiss: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: '#f2d49d',
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
  noEventDimmed: {
    opacity: 0.42,
  },
  noEventSelector: {
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  noEventSelectorLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 1.35,
    color: 'rgba(255,255,255,0.46)',
  },
  noEventSelectorTitle: {
    minHeight: 62,
    paddingVertical: 21,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#2d3832',
    backgroundColor: 'rgba(20,29,24,0.92)',
    fontFamily: fonts.bold,
    fontSize: 14,
    color: 'rgba(255,255,255,0.48)',
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
  scheduleDate: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
  },
  scheduleCard: {
    overflow: 'hidden',
  },
  scheduleItem: {
    minHeight: 66,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    gap: 16,
  },
  scheduleItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(123,255,178,0.16)',
  },
  scheduleTime: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
    width: 84,
    paddingTop: 2,
  },
  scheduleCopy: {
    flex: 1,
    gap: 4,
  },
  scheduleTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  scheduleDetail: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.58)',
  },
  scheduleEmpty: {
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 4,
  },
  microDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.link,
  },
  myTeamCard: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  myTeamCardPressed: {
    opacity: 0.72,
  },
  myTeamCardCopy: {
    flex: 1,
    gap: 5,
  },
  myTeamCardTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  myTeamCardDetail: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.52)',
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
