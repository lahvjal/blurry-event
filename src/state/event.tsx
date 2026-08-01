import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useGlobalSearchParams } from 'expo-router';
import { Alert, AppState } from 'react-native';

import {
  apiAddExistingAccountToEvent,
  apiAddParticipants,
  apiApplyTeamAssignments,
  apiAssignToTeam,
  apiCreateTeam,
  apiDeleteTeam,
  apiInviteToTeam,
  apiPostAnnouncement,
  apiRegenerateInviteCode,
  apiRemoveParticipant,
  apiResetRound,
  apiSetGameStyle,
  apiUpdateEvent,
  apiUpdateHole,
  apiUpdateParticipant,
  apiUpdateProfile,
  apiUpdateTeam,
  apiUploadImage,
  apiAvailableEventAccounts,
  EventBundle,
  fetchAccountEventAccess,
  fetchEventBundle,
} from '@/lib/api';
import { selectDefaultEventFocus } from '@/lib/event-focus';
import {
  loadAccountEventAccess,
  loadEventSnapshot,
  loadLastEventSnapshot,
  saveAccountEventAccess,
  saveEventSnapshot,
} from '@/lib/offline/event-snapshot';
import { supabase } from '@/lib/supabase';
import { enqueue, setSyncScope } from '@/lib/sync';
import { isSyntheticEmail, makeInviteCode, syntheticEmail } from '@/lib/invites';
import {
  AccountEventAccess,
  Announcement,
  EventConfig,
  ExistingAccountCandidate,
  GameStyle,
  Hole,
  LeaderboardRow,
  NewParticipantInput,
  Participant,
  ScoreUpdate,
  Scores,
  Team,
  TeamInvite,
  emptyScores,
  isTeamFormat,
  parThrough,
  sumScores,
  teamSize,
} from '@/state/types';

const PARS = [5, 4, 3, 3, 5, 5, 4, 4, 3, 4, 5, 3, 4, 4, 3, 3, 5, 5];
const YARDS = [
  520, 410, 175, 168, 545, 530, 428, 402, 155, 415, 538, 182, 420, 395, 160,
  148, 512, 550,
];

const HOLES: Hole[] = PARS.map((par, i) => ({
  hole: i + 1,
  par,
  yards: YARDS[i],
}));

const SEED_EVENT: EventConfig = {
  id: 'blurry-invitational',
  name: 'Blurry Invitational',
  lifecycleStatus: 'published',
  courseName: 'Arrowhead Golf Club',
  // Placeholder geography only — an admin sets the real address in the app.
  addressLine: '',
  city: 'Littleton',
  state: 'CO',
  postalCode: '',
  eventDate: '2026-08-24',
  checkInTime: '7:00 AM',
  startTime: '8:20 AM',
  teeTimes: ['8:20 AM', '8:30 AM', '8:40 AM', '8:50 AM'],
  courseMapUrl: null,
  teeColor: 'White',
  gameStyle: 'scramble_4',
  holes: HOLES,
};

const avatars: Record<string, number> = {
  p1: require('@/assets/figma/avatar-me.png'),
  p2: require('@/assets/figma/avatar-1.png'),
  p3: require('@/assets/figma/avatar-2.png'),
  p4: require('@/assets/figma/avatar-3.png'),
  p5: require('@/assets/figma/avatar-4.png'),
};

/** Local asset stand-in until avatars come from Supabase Storage. */
export function localAvatar(participantId: string): number | null {
  return avatars[participantId] ?? null;
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function participant(
  id: string,
  fullName: string,
  handicap: number | null,
  isAdmin = false,
  claimed = true,
): Participant {
  const inviteCode = makeInviteCode();
  return {
    id,
    fullName,
    initials: initialsOf(fullName),
    handicap,
    avatarUrl: null,
    isAdmin,
    inviteCode,
    authEmail: syntheticEmail(inviteCode),
    claimed,
    inviteSentAt: null,
  };
}

const SEED_PARTICIPANTS: Participant[] = [
  participant('p1', 'Vel Monroe', 4.7, true),
  participant('p2', 'Jake Halvorsen', 9.8),
  participant('p3', 'Ryan Jessop', 11.2),
  participant('p4', 'Matt Kimball', 5.4),
  participant('p5', 'Jordan Reed', 4.2),
  participant('p6', 'Marcus Thorne', 7.1),
  participant('p7', 'Ethan Vance', 12.3),
  participant('p8', 'Avery Brooks', 2.9),
  participant('p9', 'Maya Gomez', 8.4),
  participant('p10', 'Marco Silva', 11.6),
  participant('p11', 'Noah Kim', 6.8),
  participant('p12', 'Cole Rivera', 14.1),
  // Invited but haven't redeemed their code yet.
  participant('p13', 'Drew Sable', 3.6, false, false),
  participant('p14', 'Ellis Pratt', 10.2, false, false),
  participant('p15', 'Grant Mullen', 15.7, false, false),
  participant('p16', 'Wes Tanner', 8.9, false, false),
];

const SEED_TEAMS: Team[] = [
  {
    id: 't1',
    name: 'Team 4',
    teeTime: '8:40 AM',
    startingHole: 1,
    cart: 'Cart 14',
    memberIds: ['p1', 'p2', 'p3', 'p4'],
  },
  {
    id: 't2',
    name: 'The Turn Dogs',
    teeTime: '8:20 AM',
    startingHole: 1,
    cart: 'Cart 11',
    memberIds: ['p5', 'p6', 'p7', 'p8'],
  },
  {
    id: 't3',
    name: 'Sunday Service',
    teeTime: '8:30 AM',
    startingHole: 1,
    cart: 'Cart 12',
    memberIds: ['p9', 'p10', 'p11', 'p12'],
  },
  {
    id: 't4',
    name: 'Green Jackets',
    teeTime: '8:50 AM',
    startingHole: 1,
    cart: 'Cart 13',
    memberIds: ['p13', 'p14', 'p15', 'p16'],
  },
];

/** Partial cards for the other groups so the leaderboard has something to rank. */
function seedScores(strokes: number[]): Scores {
  const scores = emptyScores();
  strokes.forEach((s, i) => {
    scores[i] = s;
  });
  return scores;
}

const SEED_ROUNDS: Record<string, Scores> = {
  t2: seedScores([4, 3, 2, 3, 4, 4, 3, 4, 2, 3, 4, 2, 3, 4, 2]),
  t3: seedScores([5, 3, 3, 2, 4, 4, 4, 3, 3, 4, 4, 3, 3, 3, 2]),
  t4: seedScores([4, 4, 3, 3, 4, 5, 4, 4, 3, 4, 5, 3, 4, 3]),
};

const SEED_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'a1',
    body: 'Range balls and breakfast burritos are on the club. Arrive early.',
    authorName: 'Blurry Boys',
    createdAt: '2026-08-21T15:00:00Z',
  },
  {
    id: 'a2',
    body: 'Pairings are final. Check your team and tee time on the event page.',
    authorName: 'Blurry Boys',
    createdAt: '2026-08-20T18:30:00Z',
  },
];

type EventState = {
  accountAccess: AccountEventAccess | null;
  activeEventId: string | null;
  accessLoading: boolean;
  eventLoading: boolean;
  event: EventConfig;
  participants: Participant[];
  teams: Team[];
  announcements: Announcement[];
  invites: TeamInvite[];
  /** The signed-in participant. */
  me: Participant;
  myTeam: Team | null;
  /** Key the active round is stored under: team id for scrambles, else participant id. */
  myEntrantId: string;
  myScores: Scores;
  currentHoleIndex: number;
  leaderboard: LeaderboardRow[];
  /** Latest score entries across the field, used for event achievements. */
  scoreUpdates: ScoreUpdate[];
  /**
   * True once state reflects rows read from Supabase. False while showing the
   * built-in demo data, where the ids are made up and nothing is written back.
   */
  isLive: boolean;
  /** ISO time the shown data was cached, or null when it came straight from the server. */
  snapshotAt: string | null;
  /** One-shot Home banner explaining a stale or unauthorized event fallback. */
  homeNotice: string | null;
  /** Present when no focused bundle or safe snapshot could be loaded. */
  eventLoadError: string | null;

  participantById: (id: string) => Participant | undefined;
  teamOf: (participantId: string) => Team | undefined;
  /** Re-reads everything from Supabase. Runs on sign-in and on app foreground. */
  refresh: () => Promise<void>;
  /** Ignores route/current focus and returns the event Home actually opened. */
  focusDefaultHome: () => Promise<string | null>;
  dismissHomeNotice: () => void;
  reportUnavailableEventLink: (hasAccessibleEvents: boolean) => void;

  // Player actions
  setScore: (holeIndex: number, strokes: number) => void;
  resetRound: () => void;
  inviteToTeam: (participantId: string) => void;
  updateMyProfile: (patch: Partial<Pick<Participant, 'fullName' | 'handicap' | 'avatarUrl'>>) => void;

  // Admin actions
  setGameStyle: (style: GameStyle) => void;
  /** Event details: name, course, location, date, times, tee slots, map, tees. */
  updateEvent: (
    patch: Partial<
      Pick<
        EventConfig,
        | 'name'
        | 'courseName'
        | 'addressLine'
        | 'city'
        | 'state'
        | 'postalCode'
        | 'eventDate'
        | 'checkInTime'
        | 'startTime'
        | 'teeTimes'
        | 'courseMapUrl'
        | 'teeColor'
        | 'lifecycleStatus'
      >
    >,
  ) => Promise<boolean>;
  /** Edits one hole of the scorecard. `hole` is 1-based. */
  updateHole: (hole: number, patch: Partial<Pick<Hole, 'par' | 'yards'>>) => void;
  postAnnouncement: (body: string) => void;
  assignToTeam: (participantId: string, teamId: string | null) => void;
  updateTeam: (teamId: string, patch: Partial<Pick<Team, 'name' | 'teeTime' | 'startingHole' | 'cart'>>) => void;

  // Team admin
  /** Resolves to the new team's id, or null if the server refused it. */
  createTeam: (name?: string) => Promise<string | null>;
  /** Members become unassigned; any scores for the team are discarded. */
  deleteTeam: (teamId: string) => void;
  /** Snake-drafts everyone into balanced teams by handicap. Replaces current teams. */
  autoBalanceTeams: () => Promise<void>;

  // Roster admin
  /**
   * Bulk add (CSV import or manual). Returns how many were added vs skipped as
   * duplicates. Awaits the insert rather than adding optimistically, because
   * invite codes are only known once the row exists.
   */
  addParticipants: (
    rows: NewParticipantInput[],
  ) => Promise<{ added: number; duplicates: string[] }>;
  /** Safe account directory scoped to accounts not yet registered here. */
  availableExistingAccounts: () => Promise<ExistingAccountCandidate[]>;
  /** Creates a claimed event registration; existing accounts need no invite. */
  addExistingAccount: (accountId: string) => Promise<Participant>;
  updateParticipant: (
    id: string,
    patch: Partial<Pick<Participant, 'fullName' | 'handicap' | 'isAdmin' | 'authEmail'>>,
  ) => void;
  removeParticipant: (id: string) => Promise<void>;
  regenerateInviteCode: (id: string) => Promise<void>;
};

const EventContext = createContext<EventState | null>(null);

const UNLINKED_ME: Participant = {
  id: 'unlinked',
  fullName: 'Guest',
  initials: 'G',
  handicap: null,
  avatarUrl: null,
  isAdmin: false,
  inviteCode: '',
  authEmail: '',
  claimed: false,
  inviteSentAt: null,
};

/** What a rejected write is explained with when the server didn't say. */
function reasonFor(error: unknown): string {
  const message = (error as { message?: string } | null)?.message;
  return message && message.trim().length > 0
    ? message
    : 'Check your connection and try again.';
}

export function EventProvider({ children }: { children: React.ReactNode }) {
  const routeParams = useGlobalSearchParams<{ eventId?: string | string[] }>();
  const requestedEventId = Array.isArray(routeParams.eventId)
    ? routeParams.eventId[0]
    : routeParams.eventId;
  const requestedEventIdRef = useRef(requestedEventId);
  requestedEventIdRef.current = requestedEventId;
  const attemptedRouteEventIdRef = useRef<string | null>(null);
  const [accountAccess, setAccountAccess] = useState<AccountEventAccess | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [eventLoading, setEventLoading] = useState(true);
  const [event, setEvent] = useState<EventConfig>(SEED_EVENT);
  const [participants, setParticipants] = useState<Participant[]>(SEED_PARTICIPANTS);
  const [teams, setTeams] = useState<Team[]>(SEED_TEAMS);
  const [announcements, setAnnouncements] = useState<Announcement[]>(SEED_ANNOUNCEMENTS);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [rounds, setRounds] = useState<Record<string, Scores>>(SEED_ROUNDS);
  const [scoreUpdates, setScoreUpdates] = useState<ScoreUpdate[]>([]);
  const [myId, setMyId] = useState<string | null>('p1');
  /** rounds.id per entrant key, needed to clear a card. */
  const [roundIds, setRoundIds] = useState<Record<string, string>>({});
  const [isLive, setIsLive] = useState(false);
  /** Set when the screens are rendering a cached snapshot rather than a live read. */
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [homeNotice, setHomeNotice] = useState<string | null>(null);
  const [eventLoadError, setEventLoadError] = useState<string | null>(null);

  const clearFocusedEvent = useCallback(() => {
    setActiveEventId(null);
    setParticipants([]);
    setTeams([]);
    setInvites([]);
    setAnnouncements([]);
    setRounds({});
    setScoreUpdates([]);
    setRoundIds({});
    setMyId(null);
    setIsLive(false);
    setSnapshotAt(null);
    setEventLoading(false);
  }, []);

  const applySeed = useCallback(() => {
    setSyncScope(null, null);
    setAccountAccess({
      accountId: 'demo',
      profile: {
        userId: 'demo',
        displayName: 'Vel Monroe',
        avatarUrl: null,
        isClubAdmin: false,
      },
      events: [
        {
          id: SEED_EVENT.id,
          name: SEED_EVENT.name,
          courseName: SEED_EVENT.courseName,
          eventDate: SEED_EVENT.eventDate,
          lifecycleStatus: SEED_EVENT.lifecycleStatus,
          registration: {
            participantId: 'p1',
            eventId: SEED_EVENT.id,
            isAdmin: true,
          },
        },
      ],
    });
    setActiveEventId(SEED_EVENT.id);
    setAccessLoading(false);
    setEventLoading(false);
    setEvent(SEED_EVENT);
    setParticipants(SEED_PARTICIPANTS);
    setTeams(SEED_TEAMS);
    setInvites([]);
    setAnnouncements(SEED_ANNOUNCEMENTS);
    setRounds(SEED_ROUNDS);
    setScoreUpdates([]);
    setRoundIds({});
    setMyId('p1');
    setIsLive(false);
    setSnapshotAt(null);
    setHomeNotice(null);
    setEventLoadError(null);
  }, []);

  const applyBundle = useCallback((bundle: EventBundle) => {
    setEvent({
      ...bundle.event,
      lifecycleStatus: bundle.event.lifecycleStatus ?? 'published',
    });
    setParticipants(bundle.participants);
    setTeams(bundle.teams);
    setInvites(bundle.invites);
    setAnnouncements(bundle.announcements);
    setRounds(bundle.roundsByEntrant);
    setScoreUpdates(bundle.scoreUpdates ?? []);
    setRoundIds(bundle.roundIdByEntrant);
    setMyId(bundle.meId);
    // Cached data is still real data — writes must keep queueing while offline.
    setIsLive(true);
  }, []);

  const loadFromServer = useCallback(async (targetEventId?: string | null) => {
    setAccessLoading(true);
    setEventLoadError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      applySeed();
      return SEED_EVENT.id;
    }

    const userId = session.user.id;
    const routeEventId =
      targetEventId === null
        ? undefined
        : targetEventId ?? requestedEventIdRef.current;
    let access: AccountEventAccess | null = null;

    try {
      access = await fetchAccountEventAccess(userId);
      void saveAccountEventAccess(access).catch(() => {});
    } catch (error) {
      access = await loadAccountEventAccess(userId).catch(() => null);
      if (access) {
        // Continue below. Exact event snapshots still gate what can be opened.
      } else {
        // A pre-multi-event install may only have its last Invitational bundle.
        const snapshot = await loadLastEventSnapshot(userId).catch(() => null);
        if (
          snapshot &&
          (!routeEventId || snapshot.bundle.event.id === routeEventId)
        ) {
          const registration = snapshot.bundle.participants.find(
            (participant) => participant.id === snapshot.bundle.meId,
          );
          access = {
            accountId: userId,
            profile: null,
            events: [
              {
                id: snapshot.bundle.event.id,
                name: snapshot.bundle.event.name,
                courseName: snapshot.bundle.event.courseName,
                eventDate: snapshot.bundle.event.eventDate,
                lifecycleStatus: snapshot.bundle.event.lifecycleStatus,
                registration: snapshot.bundle.meId
                  ? {
                      participantId: snapshot.bundle.meId,
                      eventId: snapshot.bundle.event.id,
                      isAdmin: Boolean(registration?.isAdmin),
                    }
                  : null,
              },
            ],
          };
          setAccountAccess(access);
          setActiveEventId(snapshot.bundle.event.id);
          setSyncScope(userId, snapshot.bundle.event.id);
          setAccessLoading(false);
          setEventLoading(false);
          applyBundle(snapshot.bundle);
          setSnapshotAt(snapshot.savedAt);
          return snapshot.bundle.event.id;
        }
      }
      if (!access) {
        setSyncScope(null, null);
        setAccountAccess(null);
        setAccessLoading(false);
        clearFocusedEvent();
        setEventLoadError(reasonFor(error));
        throw error;
      }
    }

    setAccountAccess(access);
    setAccessLoading(false);

    const requestedEvent = routeEventId
      ? access.events.find((candidate) => candidate.id === routeEventId) ?? null
      : null;
    const invalidEventLink = Boolean(routeEventId && !requestedEvent);
    if (invalidEventLink) {
      attemptedRouteEventIdRef.current = routeEventId ?? null;
      setHomeNotice(
        access.events.length > 0
          ? 'That event link is no longer available to this account. Showing your default event.'
          : 'That event link is no longer available to this account. Redeem an invite to add an event.',
      );
    } else if (requestedEvent) {
      setHomeNotice(null);
    }

    const defaultFocus = selectDefaultEventFocus(access.events);
    const eventId = requestedEvent?.id ?? defaultFocus.event?.id ?? null;
    const usingDefaultFocus = requestedEvent === null;

    if (!eventId) {
      setSyncScope(null, null);
      clearFocusedEvent();
      return null;
    }

    setEventLoading(true);
    try {
      const bundle = await fetchEventBundle(eventId);
      applyBundle(bundle);
      setActiveEventId(eventId);
      setSyncScope(userId, eventId);
      setEventLoading(false);
      setSnapshotAt(null);
      void saveEventSnapshot(bundle, userId, eventId).catch(() => {});
      return eventId;
    } catch (error) {
      let snapshot = await loadEventSnapshot(userId, eventId).catch(() => null);
      if (!snapshot && usingDefaultFocus) {
        const lastSnapshot = await loadLastEventSnapshot(userId).catch(() => null);
        if (
          lastSnapshot &&
          access.events.some(
            (candidate) => candidate.id === lastSnapshot.bundle.event.id,
          )
        ) {
          snapshot = lastSnapshot;
          setHomeNotice((current) =>
            current ??
            'The default event could not be refreshed. Showing the last event saved on this device.',
          );
        }
      }
      if (snapshot) {
        applyBundle(snapshot.bundle);
        setActiveEventId(snapshot.bundle.event.id);
        setSyncScope(userId, snapshot.bundle.event.id);
        setEventLoading(false);
        setSnapshotAt(snapshot.savedAt);
        return snapshot.bundle.event.id;
      }
      setSyncScope(null, null);
      clearFocusedEvent();
      setEventLoadError(reasonFor(error));
      throw error;
    }
  }, [applySeed, applyBundle, clearFocusedEvent]);

  const loadAndReport = useCallback(async (eventId?: string | null) => {
    try {
      return await loadFromServer(eventId);
    } catch (error) {
      Alert.alert(
        "Couldn't load the event",
        `${reasonFor(error)}\n\nTry again from Home when your connection is available.`,
      );
      return null;
    }
  }, [loadFromServer]);

  const focusDefaultHome = useCallback(
    () => loadAndReport(null),
    [loadAndReport],
  );
  const refreshFocusedEvent = useCallback(async () => {
    await loadFromServer();
  }, [loadFromServer]);
  const dismissHomeNotice = useCallback(() => setHomeNotice(null), []);
  const reportUnavailableEventLink = useCallback((hasAccessibleEvents: boolean) => {
    setHomeNotice((current) =>
      current ??
      (hasAccessibleEvents
        ? 'That event link is no longer available to this account. Showing your default event.'
        : 'That event link is no longer available to this account. Redeem an invite to add an event.'),
    );
  }, []);

  useEffect(() => {
    void loadAndReport();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        void loadAndReport();
      } else {
        applySeed();
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, [loadAndReport, applySeed]);

  // Screen-to-screen navigation inside one event must not recreate the auth
  // subscription or reload the event bundle. Only a genuinely different
  // route event starts one explicit event switch.
  useEffect(() => {
    if (!requestedEventId) {
      attemptedRouteEventIdRef.current = null;
      return;
    }
    if (
      accessLoading ||
      requestedEventId === activeEventId ||
      attemptedRouteEventIdRef.current === requestedEventId
    ) {
      return;
    }
    attemptedRouteEventIdRef.current = requestedEventId;
    void loadAndReport(requestedEventId);
  }, [accessLoading, activeEventId, loadAndReport, requestedEventId]);

  // Someone else's edits — a new pairing, a fresh announcement — land on this
  // device the next time it comes back to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void loadFromServer().catch(() => {});
    });
    return () => subscription.remove();
  }, [loadFromServer]);

  // The home screen's live standings and achievement ticker should move while
  // it is open, not only after an app foreground. A short debounce folds a team
  // submitting several nearby scores into one consistent bundle refresh.
  useEffect(() => {
    if (!isLive) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void loadFromServer().catch(() => {});
      }, 250);
    };
    const channel = supabase
      .channel(`event-home-live:${event.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scores',
          filter: `event_id=eq.${event.id}`,
        },
        refreshSoon,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcements',
          filter: `event_id=eq.${event.id}`,
        },
        refreshSoon,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [event.id, isLive, loadFromServer]);

  /**
   * Sends one write to Supabase behind an optimistic local update. If the server
   * refuses it, local state is replaced with the server's copy so a rejected
   * edit can't sit on screen looking saved.
   *
   * A no-op on the demo data, where the ids aren't real rows.
   */
  const persist = useCallback(
    async (what: string, work: () => Promise<void>) => {
      if (!isLive) return true;
      try {
        await work();
        return true;
      } catch (error) {
        Alert.alert(`Couldn't save ${what}`, reasonFor(error));
        await loadFromServer().catch(() => {});
        return false;
      }
    },
    [isLive, loadFromServer],
  );

  // Team fields are edited with the keyboard, one state update per keystroke.
  // Patches for a team are merged and sent once typing stops.
  const teamWrites = useRef(
    new Map<
      string,
      { timer: ReturnType<typeof setTimeout>; patch: Partial<Team> }
    >(),
  );

  useEffect(
    () => () => {
      teamWrites.current.forEach(({ timer }) => clearTimeout(timer));
      teamWrites.current.clear();
    },
    [],
  );

  const persistTeamPatch = useCallback(
    (teamId: string, patch: Partial<Pick<Team, 'name' | 'teeTime' | 'startingHole' | 'cart'>>) => {
      if (!isLive) return;

      const inFlight = teamWrites.current.get(teamId);
      if (inFlight) clearTimeout(inFlight.timer);
      const merged = { ...inFlight?.patch, ...patch };

      const timer = setTimeout(() => {
        teamWrites.current.delete(teamId);
        void persist('the team', () => apiUpdateTeam(teamId, merged));
      }, 500);

      teamWrites.current.set(teamId, { timer, patch: merged });
    },
    [isLive, persist],
  );

  const me = useMemo(() => {
    const profile = accountAccess?.profile;
    const clubAdmin = Boolean(profile?.isClubAdmin);
    const participant = myId
      ? participants.find((candidate) => candidate.id === myId)
      : null;
    if (participant) {
      return { ...participant, isAdmin: participant.isAdmin || clubAdmin };
    }
    if (profile) {
      const fullName = profile.displayName?.trim() || 'Club Admin';
      return {
        ...UNLINKED_ME,
        fullName,
        initials: initialsOf(fullName),
        avatarUrl: profile.avatarUrl,
        isAdmin: clubAdmin,
      };
    }
    return UNLINKED_ME;
  }, [accountAccess?.profile, participants, myId]);

  const myTeam = useMemo(
    () => (myId ? teams.find((t) => t.memberIds.includes(myId)) ?? null : null),
    [teams, myId],
  );

  const myEntrantId = myId
    ? isTeamFormat(event.gameStyle)
      ? (myTeam?.id ?? myId)
      : myId
    : 'unlinked';

  /**
   * Who owns the active round server-side: the team under a scramble, the player
   * under solo — and the player too when a scramble hasn't paired them yet.
   */
  const myRoundOwner = useMemo(
    () =>
      isTeamFormat(event.gameStyle) && myTeam
        ? { teamId: myTeam.id, participantId: null }
        : { teamId: null, participantId: myId },
    [event.gameStyle, myTeam, myId],
  );

  const myScores = rounds[myEntrantId] ?? emptyScores();

  const currentHoleIndex = useMemo(() => {
    const start = Math.max(0, Math.min(17, (myTeam?.startingHole ?? 1) - 1));
    for (let offset = 0; offset < 18; offset += 1) {
      const index = (start + offset) % 18;
      if (myScores[index] === null) return index;
    }
    return (start + 17) % 18;
  }, [myScores, myTeam?.startingHole]);

  const participantById = useCallback(
    (id: string) => participants.find((p) => p.id === id),
    [participants],
  );

  const teamOf = useCallback(
    (participantId: string) => teams.find((t) => t.memberIds.includes(participantId)),
    [teams],
  );

  const leaderboard = useMemo<LeaderboardRow[]>(() => {
    const entrants = isTeamFormat(event.gameStyle)
      ? teams.map((t) => ({ id: t.id, name: t.name }))
      : participants.map((p) => ({ id: p.id, name: p.fullName }));

    return entrants
      .map(({ id, name }) => {
        const scores = rounds[id] ?? emptyScores();
        const strokes = sumScores(scores);
        const thru = scores.filter((s) => s !== null).length;
        return {
          entrantId: id,
          name,
          thru,
          strokes: strokes ?? 0,
          toPar: strokes === null ? null : strokes - parThrough(scores, event.holes),
          isMine: id === myEntrantId,
        };
      })
      .sort((a, b) => {
        // Unplayed entrants sink to the bottom; otherwise best to-par first.
        if (a.toPar === null && b.toPar === null) return a.name.localeCompare(b.name);
        if (a.toPar === null) return 1;
        if (b.toPar === null) return -1;
        if (a.toPar !== b.toPar) return a.toPar - b.toPar;
        return b.thru - a.thru;
      });
  }, [event.gameStyle, event.holes, teams, participants, rounds, myEntrantId]);

  const setScore = useCallback(
    (holeIndex: number, strokes: number) => {
      const updatedAt = new Date().toISOString();
      setRounds((prev) => {
        const existing = prev[myEntrantId] ?? emptyScores();
        const next = [...existing];
        next[holeIndex] = strokes;
        return { ...prev, [myEntrantId]: next };
      });
      setScoreUpdates((current) => [
        {
          entrantId: myEntrantId,
          hole: holeIndex + 1,
          strokes,
          updatedAt,
          enteredBy: myId,
        },
        ...current.filter(
          (update) =>
            update.entrantId !== myEntrantId || update.hole !== holeIndex + 1,
        ),
      ]);

      if (!isLive || !myId) return;
      // Queued rather than written straight through: this is the one write that
      // has to survive standing in a bunker with no bars.
      void enqueue({
        kind: 'score',
        eventId: event.id,
        teamId: myRoundOwner.teamId,
        participantId: myRoundOwner.participantId,
        hole: holeIndex + 1,
        strokes,
        enteredBy: myId,
        clientUpdatedAt: updatedAt,
      });
    },
    [myEntrantId, isLive, myId, event.id, myRoundOwner],
  );

  const resetRound = useCallback(() => {
    setRounds((prev) => ({ ...prev, [myEntrantId]: emptyScores() }));
    setScoreUpdates((current) =>
      current.filter((update) => update.entrantId !== myEntrantId),
    );
    const roundId = roundIds[myEntrantId];
    if (!roundId) return;
    void persist('the cleared card', () => apiResetRound(roundId));
  }, [myEntrantId, roundIds, persist]);

  const inviteToTeam = useCallback(
    (participantId: string) => {
      if (!myTeam || !myId) return;
      if (myTeam.memberIds.length >= teamSize(event.gameStyle)) return;

      const localId = `inv-${Date.now()}`;
      setInvites((prev) => [
        ...prev,
        {
          id: localId,
          teamId: myTeam.id,
          invitedParticipantId: participantId,
          invitedByParticipantId: myId,
          status: 'pending',
        },
      ]);

      void persist('the invite', async () => {
        const id = await apiInviteToTeam(myTeam.id, participantId, myId);
        if (id) {
          setInvites((prev) =>
            prev.map((invite) => (invite.id === localId ? { ...invite, id } : invite)),
          );
        }
      });
    },
    [myTeam, event.gameStyle, myId, persist],
  );

  const updateMyProfile = useCallback(
    (patch: Partial<Pick<Participant, 'fullName' | 'handicap' | 'avatarUrl'>>) => {
      if (myId) {
        setParticipants((prev) =>
          prev.map((p) =>
            p.id === myId
              ? {
                  ...p,
                  ...patch,
                  initials: patch.fullName ? initialsOf(patch.fullName) : p.initials,
                }
              : p,
          ),
        );
      }
      if (patch.fullName !== undefined || patch.avatarUrl !== undefined) {
        setAccountAccess((current) =>
          current?.profile
            ? {
                ...current,
                profile: {
                  ...current.profile,
                  displayName:
                    patch.fullName === undefined
                      ? current.profile.displayName
                      : patch.fullName,
                  avatarUrl:
                    patch.avatarUrl === undefined
                      ? current.profile.avatarUrl
                      : patch.avatarUrl,
                },
              }
            : current,
        );
      }

      void persist('your profile', async () => {
        // Roster name/handicap belong to this event registration. Account name
        // and avatar belong to the profile and remain editable for a club admin
        // who is not registered to play in this event.
        if (
          myId &&
          (patch.fullName !== undefined || patch.handicap !== undefined)
        ) {
          await apiUpdateParticipant(myId, {
            fullName: patch.fullName,
            handicap: patch.handicap,
          });
        }
        if (patch.avatarUrl === undefined && patch.fullName === undefined) return;

        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;
        if (!userId) return;

        // The picker hands back a local file:// uri, which only means anything on
        // this device — the bytes have to go to Storage before the url is worth
        // saving.
        const avatarUrl =
          patch.avatarUrl === undefined || patch.avatarUrl === null
            ? patch.avatarUrl
            : await apiUploadImage(`avatars/${userId}`, patch.avatarUrl);

        await apiUpdateProfile(userId, { displayName: patch.fullName, avatarUrl });

        if (typeof avatarUrl === 'string' && myId) {
          setParticipants((prev) =>
            prev.map((p) => (p.id === myId ? { ...p, avatarUrl } : p)),
          );
        }
        if (typeof avatarUrl === 'string') {
          setAccountAccess((current) =>
            current?.profile
              ? {
                  ...current,
                  profile: { ...current.profile, avatarUrl },
                }
              : current,
          );
        }
      });
    },
    [myId, persist],
  );

  const setGameStyle = useCallback(
    (style: GameStyle) => {
      setEvent((prev) => ({ ...prev, gameStyle: style }));
      void persist('the format', () => apiSetGameStyle(event.id, style));
    },
    [event.id, persist],
  );

  const updateEvent = useCallback<EventState['updateEvent']>(
    async (patch) => {
      let savedPatch = patch;
      const saved = await persist('the event details', async () => {
        // A freshly picked course map is a local file:// uri, which resolves to
        // nothing on anybody else's phone. The bytes go to Storage first and the
        // public url is what gets saved.
        const uploaded =
          patch.courseMapUrl && !patch.courseMapUrl.startsWith('http')
            ? await apiUploadImage(`course/${event.id}`, patch.courseMapUrl)
            : null;

        savedPatch = {
          ...patch,
          courseMapUrl: uploaded ?? patch.courseMapUrl,
        };
        await apiUpdateEvent(event.id, savedPatch);
      });

      if (saved) {
        setEvent((prev) => ({ ...prev, ...savedPatch }));
        setAccountAccess((current) =>
          current
            ? {
                ...current,
                events: current.events.map((candidate) =>
                  candidate.id === event.id
                    ? {
                        ...candidate,
                        name: savedPatch.name ?? candidate.name,
                        courseName:
                          savedPatch.courseName ?? candidate.courseName,
                        eventDate:
                          savedPatch.eventDate ?? candidate.eventDate,
                        lifecycleStatus:
                          savedPatch.lifecycleStatus ??
                          candidate.lifecycleStatus,
                      }
                    : candidate,
                ),
              }
            : current,
        );
      }
      return saved;
    },
    [event.id, persist],
  );

  const updateHole = useCallback(
    (hole: number, patch: Partial<Pick<Hole, 'par' | 'yards'>>) => {
      setEvent((prev) => ({
        ...prev,
        holes: prev.holes.map((h) => (h.hole === hole ? { ...h, ...patch } : h)),
      }));
      void persist('the scorecard', () => apiUpdateHole(event.id, hole, patch));
    },
    [event.id, persist],
  );

  const postAnnouncement = useCallback(
    (body: string) => {
      setAnnouncements((prev) => [
        {
          id: `a-${Date.now()}`,
          body,
          authorName: me.fullName,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      void persist('the announcement', () => apiPostAnnouncement(event.id, body, myId));
    },
    [me.fullName, event.id, myId, persist],
  );

  const assignToTeam = useCallback(
    (participantId: string, teamId: string | null) => {
      setTeams((prev) =>
        prev.map((team) => {
          const without = team.memberIds.filter((id) => id !== participantId);
          if (team.id === teamId) return { ...team, memberIds: [...without, participantId] };
          return { ...team, memberIds: without };
        }),
      );
      void persist('the pairing', () => apiAssignToTeam(participantId, teamId));
    },
    [persist],
  );

  const updateTeam = useCallback(
    (teamId: string, patch: Partial<Pick<Team, 'name' | 'teeTime' | 'startingHole' | 'cart'>>) => {
      setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, ...patch } : t)));
      persistTeamPatch(teamId, patch);
    },
    [persistTeamPatch],
  );

  const createTeam = useCallback<EventState['createTeam']>(
    async (name) => {
      const teamName = name?.trim() || `Team ${teams.length + 1}`;
      const blank = {
        name: teamName,
        teeTime: null,
        startingHole: null,
        cart: null,
        memberIds: [],
      };

      // The one action that isn't optimistic: a placeholder row would carry an
      // invented id, and a rename or tee time set before the real id arrived
      // would be written against a row that doesn't exist.
      if (!isLive) {
        const localId = `t-${Date.now()}`;
        setTeams((prev) => [...prev, { id: localId, ...blank }]);
        return localId;
      }

      try {
        const id = await apiCreateTeam(event.id, teamName);
        setTeams((prev) => [...prev, { id, ...blank }]);
        return id;
      } catch (error) {
        Alert.alert("Couldn't add the team", reasonFor(error));
        return null;
      }
    },
    [teams.length, event.id, isLive],
  );

  const deleteTeam = useCallback(
    (teamId: string) => {
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      setRounds((prev) => {
        const next = { ...prev };
        delete next[teamId];
        return next;
      });
      void persist('the team', () => apiDeleteTeam(teamId));
    },
    [persist],
  );

  /**
   * Snake draft by handicap: sort best-to-worst, deal 1..N then N..1, so each
   * team ends up with a comparable spread rather than all the low indexes
   * landing together. Players without a handicap are treated as mid-pack.
   */
  const autoBalanceTeams = useCallback<EventState['autoBalanceTeams']>(async () => {
    const size = teamSize(event.gameStyle);
    const ranked = [...participants].sort((a, b) => {
      const ah = a.handicap ?? 12;
      const bh = b.handicap ?? 12;
      return ah - bh;
    });

    const teamCount = Math.max(1, Math.ceil(ranked.length / size));
    const buckets: string[][] = Array.from({ length: teamCount }, () => []);

    ranked.forEach((player, i) => {
      const round = Math.floor(i / teamCount);
      const slot = i % teamCount;
      // Reverse direction on odd rounds for the snake.
      const target = round % 2 === 0 ? slot : teamCount - 1 - slot;
      buckets[target].push(player.id);
    });

    // Existing teams are reused position by position so their tee times, carts
    // and — importantly — their rounds survive the reshuffle. Only teams past the
    // end of the new arrangement are dropped.
    const arrangement = buckets.map((memberIds, i) => {
      const existing = teams[i];
      return {
        id: existing?.id ?? null,
        name: existing?.name ?? `Team ${i + 1}`,
        teeTime: existing?.teeTime ?? null,
        startingHole: existing?.startingHole ?? null,
        cart: existing?.cart ?? null,
        memberIds,
      };
    });

    const seat = (ids: (string | null)[]) =>
      setTeams(
        arrangement.map((team, i) => ({
          ...team,
          id: ids[i] ?? `t-auto-${i}-${Date.now()}`,
        })),
      );

    if (!isLive) {
      seat(arrangement.map((team) => team.id));
      return;
    }

    // Seated only once the server has the arrangement, so the ids on screen are
    // always ones the next edit can be written against.
    try {
      seat(await apiApplyTeamAssignments(event.id, arrangement));
    } catch (error) {
      Alert.alert("Couldn't balance the teams", reasonFor(error));
      await loadFromServer().catch(() => {});
    }
  }, [participants, teams, event.gameStyle, event.id, isLive, loadFromServer]);

  const addParticipants = useCallback<EventState['addParticipants']>(
    async (rows) => {
      const existingEmails = new Set(
        participants.map((p) => p.authEmail.toLowerCase()).filter(Boolean),
      );
      const existingNames = new Set(participants.map((p) => p.fullName.toLowerCase()));

      const duplicates: string[] = [];
      const fresh: NewParticipantInput[] = [];

      rows.forEach((row) => {
        const email = row.email?.toLowerCase() ?? null;
        const name = row.fullName.toLowerCase();
        // Match on either identity. Re-importing a corrected list is far more
        // common than two players genuinely sharing a name, so a name clash is
        // treated as a duplicate — add a real namesake by hand.
        if ((email && existingEmails.has(email)) || existingNames.has(name)) {
          duplicates.push(row.fullName);
          return;
        }
        if (email) existingEmails.add(email);
        existingNames.add(name);
        fresh.push(row);
      });

      if (fresh.length === 0) return { added: 0, duplicates };

      if (!isLive) {
        setParticipants((prev) => [
          ...prev,
          ...fresh.map((row, i) => {
            const inviteCode = makeInviteCode();
            return {
              id: `p-${Date.now()}-${prev.length + i}`,
              fullName: row.fullName,
              initials: initialsOf(row.fullName),
              handicap: row.handicap,
              avatarUrl: null,
              isAdmin: row.isAdmin,
              inviteCode,
              authEmail: row.email?.toLowerCase() ?? syntheticEmail(inviteCode),
              claimed: false,
              inviteSentAt: null,
            };
          }),
        ]);
        return { added: fresh.length, duplicates };
      }

      try {
        const created = await apiAddParticipants(event.id, fresh);
        setParticipants((prev) => [...prev, ...created]);
        return { added: created.length, duplicates };
      } catch (error) {
        Alert.alert("Couldn't add to the roster", reasonFor(error));
        return { added: 0, duplicates };
      }
    },
    [participants, event.id, isLive],
  );

  const availableExistingAccounts = useCallback<
    EventState['availableExistingAccounts']
  >(async () => {
    if (!isLive) return [];
    return apiAvailableEventAccounts(event.id);
  }, [event.id, isLive]);

  const addExistingAccount = useCallback<EventState['addExistingAccount']>(
    async (accountId) => {
      if (!isLive) {
        throw new Error('Sign in before adding an existing account.');
      }

      const created = await apiAddExistingAccountToEvent(event.id, accountId);
      setParticipants((current) =>
        current.some((participant) => participant.id === created.id)
          ? current
          : [...current, created],
      );

      // A club admin can enter an event without playing in it and then choose
      // their own account. Reflect that new registration without a full reload.
      if (accountAccess?.accountId === accountId) {
        setMyId(created.id);
        setAccountAccess((current) =>
          current
            ? {
                ...current,
                events: current.events.map((candidate) =>
                  candidate.id === event.id
                    ? {
                        ...candidate,
                        registration: {
                          participantId: created.id,
                          eventId: event.id,
                          isAdmin: created.isAdmin,
                        },
                      }
                    : candidate,
                ),
              }
            : current,
        );
      }

      return created;
    },
    [accountAccess?.accountId, event.id, isLive],
  );

  const updateParticipant = useCallback(
    (
      id: string,
      patch: Partial<Pick<Participant, 'fullName' | 'handicap' | 'isAdmin' | 'authEmail'>>,
    ) => {
      const current = participants.find((p) => p.id === id);
      if (!current) return;

      // Clearing the email falls back to the code-derived placeholder so the
      // participant can still sign in with their invite code alone.
      const authEmail =
        patch.authEmail === undefined
          ? undefined
          : patch.authEmail.trim() === ''
            ? syntheticEmail(current.inviteCode)
            : patch.authEmail.trim().toLowerCase();

      setParticipants((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                ...patch,
                authEmail: authEmail ?? p.authEmail,
                initials: patch.fullName ? initialsOf(patch.fullName) : p.initials,
              }
            : p,
        ),
      );

      void persist('the roster', () =>
        apiUpdateParticipant(id, {
          fullName: patch.fullName,
          handicap: patch.handicap,
          isAdmin: patch.isAdmin,
          authEmail,
        }),
      );
    },
    [participants, persist],
  );

  const removeParticipant = useCallback(
    async (id: string) => {
      // Keep destructive writes non-optimistic. A row that disappears and
      // silently comes back after an RLS or network failure looks like a broken
      // Remove button and can prompt repeated taps.
      if (isLive) {
        await apiRemoveParticipant(id);
      }
      setParticipants((prev) => prev.filter((p) => p.id !== id));
      setTeams((prev) =>
        prev.map((team) => ({
          ...team,
          memberIds: team.memberIds.filter((memberId) => memberId !== id),
        })),
      );
    },
    [isLive],
  );

  /** Invalidates the old code — use when an invite leaks or needs resending. */
  const regenerateInviteCode = useCallback<EventState['regenerateInviteCode']>(
    async (id) => {
      const current = participants.find((p) => p.id === id);
      if (!current) return;
      const keepsEmail = !isSyntheticEmail(current.authEmail);

      const apply = (inviteCode: string) =>
        setParticipants((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  inviteCode,
                  authEmail: keepsEmail ? p.authEmail : syntheticEmail(inviteCode),
                }
              : p,
          ),
        );

      // Not optimistic on purpose: showing a code before the write lands would
      // put an invite on screen that nothing can be redeemed against.
      if (!isLive) {
        apply(makeInviteCode());
        return;
      }

      try {
        apply(await apiRegenerateInviteCode(id, keepsEmail));
      } catch (error) {
        Alert.alert("Couldn't regenerate the invite", reasonFor(error));
      }
    },
    [participants, isLive],
  );

  const value: EventState = {
    accountAccess,
    activeEventId,
    accessLoading,
    eventLoading,
    event,
    participants,
    teams,
    announcements,
    invites,
    me,
    myTeam,
    myEntrantId,
    myScores,
    currentHoleIndex,
    leaderboard,
    scoreUpdates,
    isLive,
    snapshotAt,
    homeNotice,
    eventLoadError,
    participantById,
    teamOf,
    refresh: refreshFocusedEvent,
    focusDefaultHome,
    dismissHomeNotice,
    reportUnavailableEventLink,
    setScore,
    resetRound,
    inviteToTeam,
    updateMyProfile,
    setGameStyle,
    updateEvent,
    updateHole,
    postAnnouncement,
    assignToTeam,
    updateTeam,
    createTeam,
    deleteTeam,
    autoBalanceTeams,
    addParticipants,
    availableExistingAccounts,
    addExistingAccount,
    updateParticipant,
    removeParticipant,
    regenerateInviteCode,
  };

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}

export function useEvent() {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error('useEvent must be used inside EventProvider');
  return ctx;
}
