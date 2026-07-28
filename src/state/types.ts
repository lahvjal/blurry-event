/**
 * Shared domain types. These mirror the Supabase schema column-for-column so
 * screens written against them keep working once the backend is wired in.
 */

/** Set by an admin on the event; the scorecard adapts to it. */
export type GameStyle = 'solo' | 'scramble_2' | 'scramble_4';

export const GAME_STYLE_LABELS: Record<GameStyle, string> = {
  solo: 'SOLO',
  scramble_2: '2-MAN SCRAMBLE',
  scramble_4: '4-MAN SCRAMBLE',
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
};

/** A roster row before it becomes a Participant (CSV import or manual add). */
export type NewParticipantInput = {
  fullName: string;
  email: string | null;
  handicap: number | null;
  isAdmin: boolean;
};

export type Team = {
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
  yards: number;
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

export type Conversation = {
  id: string;
  kind: ConversationKind;
  /** Null on direct threads, which are titled after the other person. */
  name: string | null;
  createdBy: string | null;
  /** Participant ids, including yours. */
  memberIds: string[];
};

/** An inbox row: the conversation plus its preview line and unread count. */
export type ConversationSummary = Conversation & {
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  unreadCount: number;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  /**
   * Generated on the device before the send. Lets an offline send that gets
   * retried on reconnect be recognised as the same message, and lets the
   * optimistic bubble be replaced by the row that comes back over realtime.
   */
  clientId: string;
  createdAt: string;
  /** True while the send is still sitting in the offline queue. */
  pending?: boolean;
};

export type EventConfig = {
  id: string;
  name: string;
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
  /** Slots teams can be assigned to, in play order, e.g. "8:40 AM". */
  teeTimes: string[];
  /** Uploaded course map image; null until an admin adds one. */
  courseMapUrl: string | null;
  gameStyle: GameStyle;
  holes: Hole[];
};

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
