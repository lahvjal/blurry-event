import { makeInviteCode, syntheticEmail } from '@/lib/invites';
import { supabase } from '@/lib/supabase';
import {
  AccountEventAccess,
  Announcement,
  EventConfig,
  EventLifecycleStatus,
  ExistingAccountCandidate,
  GameStyle,
  Participant,
  ScoreUpdate,
  Scores,
  Team,
  TeamInvite,
  emptyScores,
} from '@/state/types';

/**
 * Read/write helpers over the Supabase schema, mapping snake_case rows onto the
 * domain types the screens use. Scores are written through the offline queue
 * (see lib/sync.ts) rather than here.
 */

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Drops the keys a caller left undefined and returns null when that empties the
 * row. Callers pass one object covering every editable column, so a patch that
 * touches one field arrives here mostly undefined — and PostgREST rejects a
 * PATCH with no columns in it.
 */
function assigned<T extends Record<string, unknown>>(row: T): Partial<T> | null {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  return entries.length === 0 ? null : (Object.fromEntries(entries) as Partial<T>);
}

export type EventBundle = {
  event: EventConfig;
  participants: Participant[];
  teams: Team[];
  invites: TeamInvite[];
  announcements: Announcement[];
  /** Keyed by team id (scramble) or participant id (solo). */
  roundsByEntrant: Record<string, Scores>;
  /** Maps an entrant key to its rounds.id, needed for score writes. */
  roundIdByEntrant: Record<string, string>;
  /** Current score rows ordered by their last entry/edit time. */
  scoreUpdates: ScoreUpdate[];
  /** The signed-in user's participant row, if their account is linked. */
  meId: string | null;
};

/**
 * Loads the signed-in account separately from its event registrations. An
 * account may have several event registrations; club admins can also see
 * every event without needing a participant registration in each one.
 */
export async function fetchAccountEventAccess(
  userId: string,
): Promise<AccountEventAccess> {
  const [profileRes, accessRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_club_admin')
      .eq('id', userId)
      .maybeSingle(),
    supabase.rpc('accessible_events'),
  ]);

  const firstError = [profileRes.error, accessRes.error].find(Boolean);
  if (firstError) throw firstError;

  const profile = profileRes.data as any;

  return {
    accountId: userId,
    profile: profile
      ? {
          userId: profile.id,
          displayName: profile.display_name ?? null,
          avatarUrl: profile.avatar_url ?? null,
          isClubAdmin: Boolean(profile.is_club_admin),
        }
      : null,
    events: (accessRes.data ?? []).map((event: any) => ({
      id: event.id,
      name: event.name,
      courseName: event.course_name,
      eventDate: event.event_date,
      lifecycleStatus: event.lifecycle_status as EventLifecycleStatus,
      registration: event.participant_id
        ? {
            participantId: event.participant_id,
            eventId: event.id,
            isAdmin: Boolean(event.event_is_admin),
          }
        : null,
    })),
  };
}

export async function fetchEventBundle(eventId: string): Promise<EventBundle> {
  const [
    eventRes,
    holesRes,
    participantsRes,
    teamsRes,
    roundsRes,
    announcementsRes,
  ] = await Promise.all([
    supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
    supabase.from('holes').select('*').eq('event_id', eventId).order('hole'),
    supabase
      .from('participants')
      .select('*')
      .eq('event_id', eventId)
      .order('full_name'),
    supabase.from('teams').select('*').eq('event_id', eventId).order('tee_time'),
    supabase.from('rounds').select('*').eq('event_id', eventId),
    supabase
      .from('announcements')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false }),
  ]);

  const firstError = [
    eventRes.error,
    holesRes.error,
    participantsRes.error,
    teamsRes.error,
    roundsRes.error,
    announcementsRes.error,
  ].find(Boolean);
  if (firstError) throw firstError;
  if (!eventRes.data) {
    throw new Error(`Event ${eventId} was not found or is inaccessible.`);
  }

  // Child tables without event_id are scoped through their already-filtered
  // parent rows. Avoid an unfiltered query when an event has no teams/rounds.
  const teamIds = (teamsRes.data ?? []).map((team: any) => team.id);
  const roundIds = (roundsRes.data ?? []).map((round: any) => round.id);
  const profileIds = (participantsRes.data ?? [])
    .map((participant: any) => participant.claimed_by)
    .filter((id: string | null): id is string => Boolean(id));

  const [membersRes, invitesRes, scoresRes, profilesRes] = await Promise.all([
    teamIds.length
      ? supabase.from('team_members').select('*').in('team_id', teamIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from('team_invites').select('*').in('team_id', teamIds)
      : Promise.resolve({ data: [], error: null }),
    roundIds.length
      ? supabase.from('scores').select('*').in('round_id', roundIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? supabase.from('profiles').select('*').in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const firstChildError = [
    membersRes.error,
    invitesRes.error,
    scoresRes.error,
    profilesRes.error,
  ].find(Boolean);
  if (firstChildError) throw firstChildError;

  const row = eventRes.data as any;
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;

  const profiles = new Map<string, any>(
    (profilesRes.data ?? []).map((p: any) => [p.id, p]),
  );

  const participants: Participant[] = (participantsRes.data ?? []).map((p: any) => {
    const profile = p.claimed_by ? profiles.get(p.claimed_by) : undefined;
    // participants.full_name is the single source of truth for names — both the
    // admin roster and a player's own profile edit write to it. The profile row
    // only supplies the avatar, so an admin rename is never silently overridden.
    const fullName = p.full_name;
    return {
      id: p.id,
      fullName,
      initials: initialsOf(fullName),
      handicap: p.handicap === null ? null : Number(p.handicap),
      avatarUrl: profile?.avatar_url ?? null,
      isAdmin: Boolean(p.is_admin),
      inviteCode: p.invite_code,
      authEmail: p.auth_email,
      claimed: p.claimed_by !== null,
      inviteSentAt: p.invite_sent_at ?? null,
    };
  });

  const membersByTeam = new Map<string, string[]>();
  (membersRes.data ?? []).forEach((m: any) => {
    const list = membersByTeam.get(m.team_id) ?? [];
    list.push(m.participant_id);
    membersByTeam.set(m.team_id, list);
  });

  const teams: Team[] = (teamsRes.data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    teeTime: t.tee_time,
    startingHole: t.starting_hole,
    cart: t.cart,
    memberIds: membersByTeam.get(t.id) ?? [],
  }));

  // Fold scores into per-entrant 18-slot arrays.
  const scoresByRound = new Map<string, Scores>();
  (scoresRes.data ?? []).forEach((s: any) => {
    const arr = scoresByRound.get(s.round_id) ?? emptyScores();
    arr[s.hole - 1] = s.strokes;
    scoresByRound.set(s.round_id, arr);
  });

  const roundsByEntrant: Record<string, Scores> = {};
  const roundIdByEntrant: Record<string, string> = {};
  const entrantByRound = new Map<string, string>();
  (roundsRes.data ?? []).forEach((r: any) => {
    const entrant = r.team_id ?? r.participant_id;
    if (!entrant) return;
    roundsByEntrant[entrant] = scoresByRound.get(r.id) ?? emptyScores();
    roundIdByEntrant[entrant] = r.id;
    entrantByRound.set(r.id, entrant);
  });
  const scoreUpdates: ScoreUpdate[] = (scoresRes.data ?? [])
    .map((score: any): ScoreUpdate | null => {
      const entrantId = entrantByRound.get(score.round_id);
      if (!entrantId) return null;
      return {
        entrantId,
        hole: score.hole,
        strokes: score.strokes,
        updatedAt: score.client_updated_at,
        enteredBy: score.entered_by ?? null,
        clientVersion:
          score.client_version === null || score.client_version === undefined
            ? undefined
            : Number(score.client_version),
        mutationId: score.last_mutation_id ?? null,
      };
    })
    .filter((score): score is ScoreUpdate => score !== null)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

  const meId =
    (participantsRes.data ?? []).find((p: any) => p.claimed_by === userId)?.id ?? null;

  return {
    event: {
      id: row.id,
      name: row.name,
      lifecycleStatus: (row.lifecycle_status ?? 'published') as EventLifecycleStatus,
      courseName: row.course_name,
      addressLine: row.address_line ?? '',
      city: row.city ?? '',
      state: row.state ?? '',
      postalCode: row.postal_code ?? '',
      eventDate: row.event_date,
      checkInTime: row.check_in_time,
      startTime: row.start_time ?? '8:00 AM',
      teeTimes: row.tee_times ?? [],
      courseMapUrl: row.course_map_url ?? null,
      teeColor: row.tee_color || 'White',
      gameStyle: row.game_style as GameStyle,
      holes: (holesRes.data ?? []).map((h: any) => ({
        hole: h.hole,
        par: h.par,
        yards: h.yards,
      })),
    },
    participants,
    teams,
    invites: (invitesRes.data ?? []).map((i: any) => ({
      id: i.id,
      teamId: i.team_id,
      invitedParticipantId: i.invited_participant_id,
      invitedByParticipantId: i.invited_by,
      status: i.status as TeamInvite['status'],
    })),
    announcements: (announcementsRes.data ?? []).map((a: any) => {
      const author = participants.find((p) => p.id === a.created_by);
      return {
        id: a.id,
        body: a.body,
        authorName: author?.fullName ?? 'Blurry Boys',
        createdAt: a.created_at,
      };
    }),
    roundsByEntrant,
    roundIdByEntrant,
    scoreUpdates,
    meId,
  };
}

/**
 * Finds or creates the round a score should attach to. Called lazily on the
 * first score of a round so we don't create empty rounds for everyone.
 */
export async function ensureRound(params: {
  eventId: string;
  teamId: string | null;
  participantId: string | null;
}): Promise<string> {
  const { eventId, teamId, participantId } = params;

  const existing = await supabase
    .from('rounds')
    .select('id')
    .eq('event_id', eventId)
    .eq(teamId ? 'team_id' : 'participant_id', teamId ?? participantId!)
    .maybeSingle();

  if (existing.data?.id) return existing.data.id as string;

  const created = await supabase
    .from('rounds')
    .insert({ event_id: eventId, team_id: teamId, participant_id: participantId })
    .select('id')
    .single();

  if (created.error) throw created.error;
  return created.data.id as string;
}

// --- Admin writes -----------------------------------------------------------

export async function apiSetGameStyle(eventId: string, style: GameStyle) {
  const { error } = await supabase
    .from('events')
    .update({ game_style: style })
    .eq('id', eventId);
  if (error) throw error;
}

export async function apiCreateClubEvent(input: {
  name: string;
  courseName: string;
  eventDate: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_club_event', {
    p_name: input.name,
    p_course_name: input.courseName,
    p_event_date: input.eventDate,
  });
  if (error) throw error;
  if (!data) throw new Error('The event was created without an event ID.');
  return data as string;
}

export async function apiUpdateEvent(
  eventId: string,
  patch: {
    name?: string;
    courseName?: string;
    addressLine?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    eventDate?: string;
    checkInTime?: string;
    startTime?: string;
    teeTimes?: string[];
    courseMapUrl?: string | null;
    teeColor?: string;
    lifecycleStatus?: EventLifecycleStatus;
  },
) {
  const payload = assigned({
    name: patch.name,
    course_name: patch.courseName,
    address_line: patch.addressLine,
    city: patch.city,
    state: patch.state,
    postal_code: patch.postalCode,
    event_date: patch.eventDate,
    check_in_time: patch.checkInTime,
    start_time: patch.startTime,
    tee_times: patch.teeTimes,
    course_map_url: patch.courseMapUrl,
    tee_color: patch.teeColor,
    lifecycle_status: patch.lifecycleStatus,
  });
  if (!payload) return;

  const { error } = await supabase.from('events').update(payload).eq('id', eventId);
  if (error) throw error;
}

export async function apiUpdateHole(
  eventId: string,
  hole: number,
  patch: { par?: number; yards?: number },
) {
  const payload = assigned({ par: patch.par, yards: patch.yards });
  if (!payload) return;

  const { error } = await supabase
    .from('holes')
    .update(payload)
    .eq('event_id', eventId)
    .eq('hole', hole);
  if (error) throw error;
}

/**
 * Uploads an image to the public event-media bucket and returns its URL.
 * `folder` must be "course/<event id>" (event admin only) or
 * "avatars/<user id>" per storage RLS.
 */
export async function apiUploadImage(
  folder: string,
  localUri: string,
): Promise<string> {
  const response = await fetch(localUri);
  const bytes = await response.arrayBuffer();

  const extension = localUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const contentType = extension === 'png' ? 'image/png' : 'image/jpeg';
  const path = `${folder}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from('event-media')
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from('event-media').getPublicUrl(path);
  return data.publicUrl;
}

export async function apiPostAnnouncement(
  eventId: string,
  body: string,
  authorParticipantId: string | null,
) {
  const { error } = await supabase
    .from('announcements')
    .insert({ event_id: eventId, body, created_by: authorParticipantId });
  if (error) throw error;
}

export async function apiUpdateTeam(
  teamId: string,
  patch: { name?: string; teeTime?: string | null; startingHole?: number | null; cart?: string | null },
) {
  const payload = assigned({
    name: patch.name,
    tee_time: patch.teeTime,
    starting_hole: patch.startingHole,
    cart: patch.cart,
  });
  if (!payload) return;

  const { error } = await supabase.from('teams').update(payload).eq('id', teamId);
  if (error) throw error;
}

export async function apiAssignToTeam(participantId: string, teamId: string | null) {
  // team_members has a unique constraint on participant_id, so clear first.
  const del = await supabase
    .from('team_members')
    .delete()
    .eq('participant_id', participantId);
  if (del.error) throw del.error;

  if (teamId) {
    const { error } = await supabase
      .from('team_members')
      .insert({ team_id: teamId, participant_id: participantId });
    if (error) throw error;
  }
}

export async function apiCreateTeam(eventId: string, name: string): Promise<string> {
  const { data, error } = await supabase
    .from('teams')
    .insert({ event_id: eventId, name })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Members are freed by the team_members cascade; so is the team's round. */
export async function apiDeleteTeam(teamId: string) {
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) throw error;
}

/**
 * Replaces the event's whole team arrangement in one transaction, creating teams
 * for entries with a null id and deleting any team left out. Returns the team ids
 * in the order given, so the caller can swap its placeholder ids for real ones.
 */
export async function apiApplyTeamAssignments(
  eventId: string,
  teams: {
    id: string | null;
    name: string;
    teeTime: string | null;
    startingHole: number | null;
    cart: string | null;
    memberIds: string[];
  }[],
): Promise<string[]> {
  const { data, error } = await supabase.rpc('apply_team_assignments', {
    p_event_id: eventId,
    p_teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      tee_time: team.teeTime,
      starting_hole: team.startingHole,
      cart: team.cart,
      member_ids: team.memberIds,
    })),
  });
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

export async function apiInviteToTeam(
  teamId: string,
  invitedParticipantId: string,
  invitedBy: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('team_invites')
    .insert({
      team_id: teamId,
      invited_participant_id: invitedParticipantId,
      invited_by: invitedBy,
    })
    .select('id')
    .maybeSingle();
  // Unique on (team_id, invited_participant_id): they're already invited.
  if (error && error.code !== '23505') throw error;
  return (data?.id as string | undefined) ?? null;
}

/** Clears the card without discarding the round itself. */
export async function apiResetRound(roundId: string) {
  const { error } = await supabase.from('scores').delete().eq('round_id', roundId);
  if (error) throw error;
}

// --- Roster writes ----------------------------------------------------------

/**
 * A narrow admin-only directory. The RPC intentionally omits auth email so an
 * event admin can choose a known member without receiving an account directory.
 */
export async function apiAvailableEventAccounts(
  eventId: string,
): Promise<ExistingAccountCandidate[]> {
  const { data, error } = await supabase.rpc('available_event_accounts', {
    p_event_id: eventId,
  });
  if (error) throw error;

  return (data ?? []).map((account: any) => ({
    accountId: account.account_id,
    displayName: account.display_name,
    username: account.username ?? null,
    avatarUrl: account.avatar_url ?? null,
    handicap: account.handicap === null ? null : Number(account.handicap),
  }));
}

export async function apiAddExistingAccountToEvent(
  eventId: string,
  accountId: string,
): Promise<Participant> {
  const { data, error } = await supabase.rpc('add_existing_account_to_event', {
    p_event_id: eventId,
    p_account_id: accountId,
  });
  if (error) throw error;

  const participant = data?.[0] as any;
  if (!participant) {
    throw new Error('The account could not be added to this event.');
  }

  return {
    id: participant.id,
    fullName: participant.full_name,
    initials: initialsOf(participant.full_name),
    handicap: participant.handicap === null ? null : Number(participant.handicap),
    avatarUrl: participant.avatar_url ?? null,
    isAdmin: Boolean(participant.is_admin),
    inviteCode: participant.invite_code,
    authEmail: participant.auth_email,
    claimed: participant.claimed_by !== null,
    inviteSentAt: participant.invite_sent_at ?? null,
  };
}

export async function apiAddParticipants(
  eventId: string,
  rows: { fullName: string; email: string | null; handicap: number | null; isAdmin: boolean }[],
): Promise<Participant[]> {
  // invite_code has a column default, but auth_email is derived from the code
  // when there's no real address and a default can't reference a sibling
  // default. Generating the code here keeps it to one insert.
  const payload = rows.map((row) => {
    const inviteCode = makeInviteCode();
    return {
      event_id: eventId,
      full_name: row.fullName,
      handicap: row.handicap,
      is_admin: row.isAdmin,
      invite_code: inviteCode,
      auth_email: row.email?.trim().toLowerCase() || syntheticEmail(inviteCode),
    };
  });

  const { data, error } = await supabase.from('participants').insert(payload).select('*');
  if (error) throw error;

  return (data ?? []).map((p: any) => ({
    id: p.id,
    fullName: p.full_name,
    initials: initialsOf(p.full_name),
    handicap: p.handicap === null ? null : Number(p.handicap),
    avatarUrl: null,
    isAdmin: Boolean(p.is_admin),
    inviteCode: p.invite_code,
    authEmail: p.auth_email,
    claimed: p.claimed_by !== null,
    inviteSentAt: p.invite_sent_at ?? null,
  }));
}

export async function apiUpdateParticipant(
  id: string,
  patch: {
    fullName?: string;
    handicap?: number | null;
    isAdmin?: boolean;
    /**
     * Only pass for unclaimed participants. Once someone has signed up their
     * address lives in auth.users too, and changing it here alone would make
     * lookup_invite hand back an address their password doesn't match.
     */
    authEmail?: string;
  },
) {
  const payload = assigned({
    full_name: patch.fullName,
    handicap: patch.handicap,
    is_admin: patch.isAdmin,
    auth_email: patch.authEmail,
  });
  if (!payload) return;

  const { error } = await supabase.from('participants').update(payload).eq('id', id);
  if (error) throw error;
}

export async function apiRemoveParticipant(id: string) {
  const { data, error } = await supabase
    .from('participants')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error('The player was not removed. Check your admin access and try again.');
  }
}

export async function apiRegenerateInviteCode(id: string, hasRealEmail: boolean) {
  const code = makeInviteCode();
  const patch: Record<string, string> = { invite_code: code };
  if (!hasRealEmail) {
    patch.auth_email = syntheticEmail(code);
  }
  const { error } = await supabase.from('participants').update(patch).eq('id', id);
  if (error) throw error;
  return code;
}

/**
 * Upsert rather than update: the profile row is normally created by the signup
 * trigger, but an account that predates it — or one whose participant row wasn't
 * matched at signup — has none, and an update would silently affect no rows.
 */
export async function apiUpdateProfile(
  userId: string,
  patch: { displayName?: string; avatarUrl?: string | null },
) {
  const fields = assigned({
    display_name: patch.displayName,
    avatar_url: patch.avatarUrl,
  });
  if (!fields) return;

  const { error } = await supabase.from('profiles').upsert(
    { id: userId, ...fields, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  );
  if (error) throw error;
}
