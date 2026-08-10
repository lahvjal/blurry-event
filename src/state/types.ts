/**
 * Shared domain types. These mirror the Supabase schema column-for-column so
 * screens written against them keep working once the backend is wired in.
 */

/** Set by an admin on the event; the scorecard adapts to it. */
export type GameStyle = 'solo' | 'scramble_2' | 'scramble_4';
/** How playing groups enter the course. Independent from the scoring format. */
export type StartFormat = 'staggered' | 'shotgun' | 'split_tee';
export type EventLifecycleStatus =
  | 'draft'
  | 'published'
  | 'live'
  | 'completed'
  | 'archived';

export const EVENT_LIFECYCLE_LABELS: Record<EventLifecycleStatus, string> = {
  draft: 'DRAFT',
  published: 'PUBLISHED',
  live: 'LIVE',
  completed: 'COMPLETED',
  archived: 'ARCHIVED',
};

export const GAME_STYLE_LABELS: Record<GameStyle, string> = {
  solo: 'SOLO',
  scramble_2: '2-MAN SCRAMBLE',
  scramble_4: '4-MAN SCRAMBLE',
};

export const START_FORMAT_LABELS: Record<StartFormat, string> = {
  staggered: 'STAGGERED TEE TIMES',
  shotgun: 'SHOTGUN START',
  split_tee: 'SPLIT-TEE START',
};

export const START_FORMAT_DESCRIPTIONS: Record<StartFormat, string> = {
  staggered: 'Groups start from Hole 1 at different assigned times.',
  shotgun: 'All groups start together, each from a different hole.',
  split_tee: 'Groups start from Holes 1 and 10 in parallel at assigned times.',
};

/** How many players a team holds under a given format. */
export function teamSize(style: GameStyle): number {
  switch (style) {
    case 'solo':
      return 1;
    case 'scramble_2':
      return 2;
    case 'scramble_4':
      return 4;
  }
}

/** True when scores are kept once per team rather than per player. */
export function isTeamFormat(style: GameStyle): boolean {
  return style !== 'solo';
}

/** The signed-in account's club-level identity, separate from event registration. */
export type AccountProfile = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  isClubAdmin: boolean;
};

/** The account's registration and permissions for one event. */
export type EventRegistrationAccess = {
  participantId: string;
  eventId: string;
  isAdmin: boolean;
};

/** An event the signed-in account may enter. */
export type AccessibleEvent = {
  id: string;
  name: string;
  courseName: string;
  eventDate: string;
  lifecycleStatus: EventLifecycleStatus;
  /** Club admins can access an event without being registered to play in it. */
  registration: EventRegistrationAccess | null;
};

/** Account context used to choose an event before event data is loaded. */
export type AccountEventAccess = {
  accountId: string;
  profile: AccountProfile | null;
  events: AccessibleEvent[];
};

export type ClubMemberAttendance = {
  eventId: string;
  eventName: string;
  courseName: string;
  eventDate: string;
  lifecycleStatus: EventLifecycleStatus;
  participantId: string;
  claimed: boolean;
  isEventAdmin: boolean;
  inviteSentAt: string | null;
};

/** Least-privilege account/invite identity shown only in Club Admin. */
export type ClubMember = {
  personKey: string;
  accountId: string | null;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  isClubAdmin: boolean;
  status: 'app_user' | 'invited';
  nameConflict: boolean;
  eventCount: number;
  attendances: ClubMemberAttendance[];
};

export type Participant = {
  id: string;
  fullName: string;
  /** Initials fallback when there's no avatar. */
  initials: string;
  handicap: number | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  /** The code that appears in this player's invite link. */
  inviteCode: string;
  /** Address used for Supabase auth; synthetic when no real email is known. */
  authEmail: string;
  /** False until they redeem their invite code and set a password. */
  claimed: boolean;
  /** When their invite email went out; null means they've never been sent one. */
  inviteSentAt: string | null;
  /** Admin-delegated placeholder that the assigned team leader may manage. */
  leaderManaged: boolean;
  /** Disabled for a managed placeholder that does not have a real email. */
  inviteEnabled: boolean;
  /** Requires the claiming account to use this participant's stored email. */
  claimEmailBound: boolean;
  /** Optimistic-concurrency token for leader-managed identity edits. */
  identityVersion: number;
};

/** A roster row before it becomes a Participant (CSV import or manual add). */
export type NewParticipantInput = {
  fullName: string;
  email: string | null;
  handicap: number | null;
  isAdmin: boolean;
};

/** An existing account an event admin may register for the active event. */
export type ExistingAccountCandidate = {
  accountId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  /** Most recent event handicap, used as the new registration's starting value. */
  handicap: number | null;
};

export type Team = {
  id: string;
  name: string;
  /** Event-admin-assigned roster manager; unrelated to score-entry authority. */
  leaderParticipantId: string | null;
  /**
   * Explicit one-player scoring-team exception for an otherwise team-scored
   * event. The round remains team-owned and appears in the main leaderboard.
   */
  individualException: boolean;
  teeTime: string | null;
  startingHole: number | null;
  cart: string | null;
  memberIds: string[];
};

/**
 * A physical group on the course. It owns one start slot and always contains
 * zero to four participants, regardless of whether they score alone or as a team.
 */
export type PlayingGroup = {
  id: string;
  name: string;
  teeTime: string | null;
  startingHole: number | null;
  cart: string | null;
  memberIds: string[];
};

export type TeamInvite = {
  id: string;
  teamId: string;
  invitedParticipantId: string;
  invitedByParticipantId: string;
  status: 'pending' | 'accepted' | 'declined';
};

export type Hole = {
  hole: number;
  par: number;
  /** Yardage for EventConfig.teeColor, retained for existing score views. */
  yards: number;
};

/** One complete course tee card. Every tee carries its own 18 hole yardages. */
export type TeeYardageSet = {
  name: string;
  /** Display color selected by the organizer, independent of the tee's name. */
  color: string;
  yardages: number[];
};

export type Announcement = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

/**
 * 'event_group' is the all-hands thread every participant is added to, 'group'
 * is a chat someone created, 'direct' is a 1:1.
 */
export type ConversationKind = 'event_group' | 'group' | 'direct';

/** Durable chat identity. Account ids survive event-registration deletion. */
export type ConversationMember = {
  accountId: string | null;
  participantId: string | null;
  fullName: string;
  avatarUrl: string | null;
};

export type Conversation = {
  id: string;
  kind: ConversationKind;
  /** Null on direct threads, which are titled after the other person. */
  name: string | null;
  createdBy: string | null;
  createdByAccountId?: string | null;
  createdByName?: string | null;
  /** Present for the official group thread that follows one event team. */
  teamId?: string | null;
  /** Account actor ids when available, with participant ids as a legacy fallback. */
  memberIds: string[];
  members?: ConversationMember[];
  originEventId?: string | null;
  eventActive?: boolean;
  eventOwned?: boolean;
};

/** An inbox row: the conversation plus its preview line and unread count. */
export type ConversationSummary = Conversation & {
  /** Immutable event of origin. It labels and opens the thread; it does not filter the inbox. */
  eventId: string;
  eventName: string;
  eventActive: boolean;
  eventOwned: boolean;
  /** This account's event-specific participant identity for the conversation. */
  myParticipantId: string | null;
  myAccountId: string;
  /** Inbox-ready identity for the other person in a direct conversation. */
  directParticipantId: string | null;
  directParticipantName: string | null;
  directParticipantAvatarUrl: string | null;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  lastSenderName: string | null;
  lastMessageMediaMimeType: string | null;
  /** Newest message or reaction activity that is relevant to this member. */
  lastActivityAt: string | null;
  lastActivityKind: 'message' | 'reaction' | null;
  lastReactionEmoji: string | null;
  lastReactorId: string | null;
  lastReactorName: string | null;
  lastReactionMessageBody: string | null;
  lastReactionMessageMediaMimeType: string | null;
  unreadCount: number;
};

export type ChatMessageReaction = {
  participantId: string;
  emoji: string;
  participantName?: string | null;
};

export type ChatMessageMedia = {
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
};

/** Local picker result before it is uploaded and attached to a message. */
export type ChatMessageMediaDraft = {
  uri: string;
  mimeType: string | null;
  width: number;
  height: number;
  fileName: string | null;
  fileSize: number | null;
  /** Stable web payload; camera blob URLs can become unreadable before send. */
  webFile?: File | null;
};

export type ChatMessage = {
  id: string;
  eventId: string;
  conversationId: string;
  senderId: string;
  /** Event participant id retained for old offline snapshots and event UI. */
  senderParticipantId?: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  body: string;
  /** The message this one replies to, if any. */
  replyToId: string | null;
  /**
   * Generated on the device before the send. Lets an offline send that gets
   * retried on reconnect be recognised as the same message, and lets the
   * optimistic bubble be replaced by the row that comes back over realtime.
   */
  clientId: string;
  createdAt: string;
  /** Set by the server when the sender changes the message body. */
  editedAt: string | null;
  media: ChatMessageMedia | null;
  reactions: ChatMessageReaction[];
  /** True while the send is still sitting in the offline queue. */
  pending?: boolean;
  /** Local delivery detail for queued messages; server rows are implicitly sent. */
  deliveryState?: 'queued' | 'sent' | 'failed';
};

export type EventConfig = {
  id: string;
  name: string;
  lifecycleStatus: EventLifecycleStatus;
  courseName: string;
  /** Street address of the course. Blank until an admin fills it in. */
  addressLine: string;
  city: string;
  /** Two-letter state / province code. */
  state: string;
  postalCode: string;
  /** ISO date (YYYY-MM-DD) of the first tee. */
  eventDate: string;
  checkInTime: string;
  /** First tee / shotgun start time shown to players. */
  startTime: string;
  /** Scheduling policy; deliberately independent from gameStyle. */
  startFormat: StartFormat;
  /** Slots teams can be assigned to, in play order, e.g. "8:40 AM". */
  teeTimes: string[];
  /** Player-facing itinerary, kept at the event level rather than baked into Home. */
  scheduleItems: EventScheduleItem[];
  /** Uploaded course map image; null until an admin adds one. */
  courseMapUrl: string | null;
  /** Which tees the field is playing, e.g. "White". Shown on score entry. */
  teeColor: string;
  /** All course tee cards; old snapshots fall back to the event tee and holes. */
  teeYardageSets: TeeYardageSet[];
  gameStyle: GameStyle;
  holes: Hole[];
};

export type EventScheduleItem = {
  time: string;
  title: string;
  detail?: string;
};

/**
 * The tee names that cover almost every course, roughly longest to shortest,
 * with the swatch each one is known by. Offered as presets in admin; the stored
 * value is plain text, so a course calling them something else still fits.
 */
export const TEE_PRESETS: { name: string; swatch: string }[] = [
  { name: 'Black', swatch: '#1c1f1d' },
  { name: 'Blue', swatch: '#3f7fd0' },
  { name: 'White', swatch: '#f2f4f2' },
  { name: 'Gold', swatch: '#d2a63c' },
  { name: 'Green', swatch: '#4a9d63' },
  { name: 'Red', swatch: '#cf4d4d' },
];

/** Compact "Littleton, CO" for headers and cards. */
export function shortLocation(event: EventConfig): string {
  return [event.city, event.state].filter(Boolean).join(', ');
}

/** Full postal address on one line, omitting anything not filled in. */
export function fullAddress(event: EventConfig): string {
  const cityState = [event.city, event.state].filter(Boolean).join(', ');
  return [event.addressLine, cityState, event.postalCode]
    .filter(Boolean)
    .join(', ');
}

/**
 * Deep link for the Maps app. Falls back to searching the course by name when
 * no street address has been entered, which Maps resolves well for a named club.
 */
export function mapsUrl(event: EventConfig): string {
  const query = event.addressLine
    ? `${event.courseName}, ${fullAddress(event)}`
    : [event.courseName, shortLocation(event)].filter(Boolean).join(', ');
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}

/** Builds evenly spaced tee time slots, e.g. 8:00 AM + 10min × 6. */
export function generateTeeTimes(
  first: string,
  intervalMinutes: number,
  count: number,
): string[] {
  const parsed = parseTimeOfDay(first);
  if (!parsed || intervalMinutes <= 0 || count <= 0) return [];

  const slots: string[] = [];
  let minutes = parsed;
  for (let i = 0; i < count; i++) {
    slots.push(formatTimeOfDay(minutes));
    minutes = (minutes + intervalMinutes) % (24 * 60);
  }
  return slots;
}

/** Minutes since midnight, or null if unparseable. Accepts "8:40 AM" or "08:40". */
export function parseTimeOfDay(value: string): number | null {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const mins = Number(match[2]);
  const meridiem = match[3];
  if (mins > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }

  return hours * 60 + mins;
}

export function formatTimeOfDay(minutesSinceMidnight: number): string {
  const total = ((minutesSinceMidnight % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours24 = Math.floor(total / 60);
  const mins = total % 60;
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, '0')} ${meridiem}`;
}

/** 18 entries; null means the hole hasn't been scored yet. */
export type Scores = (number | null)[];

/**
 * The latest persisted value for one scored hole, including enough metadata to
 * build the event-wide achievement ticker in update order.
 */
export type ScoreUpdate = {
  entrantId: string;
  hole: number;
  strokes: number;
  updatedAt: string;
  enteredBy: string | null;
  /** Offline mutation metadata, absent on scores written before the rollout. */
  clientVersion?: number;
  mutationId?: string | null;
};

export type Round = {
  id: string;
  /** Set for scramble formats. */
  teamId: string | null;
  /** Set for solo format. */
  participantId: string | null;
  scores: Scores;
  status: 'in_progress' | 'complete';
};

export type LeaderboardRow = {
  /** Team id for scrambles, participant id for solo. */
  entrantId: string;
  name: string;
  /** Holes completed. */
  thru: number;
  /** Strokes taken over completed holes. */
  strokes: number;
  /** Strokes relative to par over completed holes; null when nothing scored. */
  toPar: number | null;
  isMine: boolean;
};

export function emptyScores(): Scores {
  return Array(18).fill(null);
}

export function sumScores(scores: Scores): number | null {
  const played = scores.filter((s): s is number => s !== null);
  if (played.length === 0) return null;
  return played.reduce((total, s) => total + s, 0);
}

/** Par over only the holes that have been scored, for a fair to-par figure. */
export function parThrough(scores: Scores, holes: Hole[]): number {
  return holes.reduce(
    (total, h, i) => (scores[i] !== null ? total + h.par : total),
    0,
  );
}

export function formatToPar(toPar: number | null): string {
  if (toPar === null) return '–';
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}
