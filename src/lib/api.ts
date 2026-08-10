import { makeInviteCode, syntheticEmail } from '@/lib/invites';
import { supabase } from '@/lib/supabase';
import {
  AccountEventAccess,
  Announcement,
  ClubMember,
  EventConfig,
  EventLifecycleStatus,
  ExistingAccountCandidate,
  GameStyle,
  Hole,
  TeeYardageSet,
  Participant,
  PlayingGroup,
  ScoreUpdate,
  Scores,
  Team,
  TeamInvite,
  StartFormat,
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
  /** Optional only for reading v1 offline snapshots created before scheduling v2. */
  playingGroups?: PlayingGroup[];
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
    teeSetsRes,
    teeYardagesRes,
    participantsRes,
    teamsRes,
    playingGroupsRes,
    roundsRes,
    announcementsRes,
  ] = await Promise.all([
    supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
    supabase.from('holes').select('*').eq('event_id', eventId).order('hole'),
    supabase.from('event_tees').select('*').eq('event_id', eventId).order('sort_order'),
    supabase.from('tee_yardages').select('*').eq('event_id', eventId).order('hole'),
    supabase
      .from('participants')
      .select('*')
      .eq('event_id', eventId)
      .order('full_name'),
    supabase.from('teams').select('*').eq('event_id', eventId).order('tee_time'),
    supabase
      .from('playing_groups')
      .select('*')
      .eq('event_id', eventId)
      .order('sort_order')
      .order('created_at'),
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
    playingGroupsRes.error,
    roundsRes.error,
    announcementsRes.error,
  ].find(Boolean);
  if (firstError) throw firstError;
  if (!eventRes.data) {
    throw new Error(`Event ${eventId} was not found or is inaccessible.`);
  }

  // Tee cards were added after the original scorecard. A client updated ahead
  // of the migration still opens legacy events safely using holes.yards.
  const teeSchemaAvailable = !teeSetsRes.error && !teeYardagesRes.error;

  // Child tables without event_id are scoped through their already-filtered
  // parent rows. Avoid an unfiltered query when an event has no teams/rounds.
  const teamIds = (teamsRes.data ?? []).map((team: any) => team.id);
  const playingGroupIds = (playingGroupsRes.data ?? []).map((group: any) => group.id);
  const roundIds = (roundsRes.data ?? []).map((round: any) => round.id);
  const profileIds = (participantsRes.data ?? [])
    .map((participant: any) => participant.claimed_by)
    .filter((id: string | null): id is string => Boolean(id));

  const [membersRes, playingGroupMembersRes, invitesRes, scoresRes, profilesRes] = await Promise.all([
    teamIds.length
      ? supabase.from('team_members').select('*').in('team_id', teamIds)
      : Promise.resolve({ data: [], error: null }),
    playingGroupIds.length
      ? supabase
          .from('playing_group_members')
          .select('*')
          .in('playing_group_id', playingGroupIds)
          .order('sort_order')
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
    playingGroupMembersRes.error,
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
      leaderManaged: Boolean(p.leader_managed),
      inviteEnabled: p.invite_enabled !== false,
      claimEmailBound: Boolean(p.claim_email_bound),
      identityVersion: Number(p.identity_version ?? 0),
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
    leaderParticipantId: t.leader_participant_id ?? null,
    individualException: Boolean(t.individual_exception),
    teeTime: t.tee_time,
    startingHole: t.starting_hole,
    cart: t.cart,
    memberIds: membersByTeam.get(t.id) ?? [],
  }));

  const membersByPlayingGroup = new Map<string, string[]>();
  (playingGroupMembersRes.data ?? []).forEach((membership: any) => {
    const list = membersByPlayingGroup.get(membership.playing_group_id) ?? [];
    list.push(membership.participant_id);
    membersByPlayingGroup.set(membership.playing_group_id, list);
  });
  const playingGroups: PlayingGroup[] = (playingGroupsRes.data ?? []).map((group: any) => ({
    id: group.id,
    name: group.name,
    teeTime: group.tee_time,
    startingHole: group.starting_hole,
    cart: group.cart,
    memberIds: membersByPlayingGroup.get(group.id) ?? [],
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
      startFormat: (row.start_format ?? 'staggered') as StartFormat,
      teeTimes: row.tee_times ?? [],
      courseMapUrl: row.course_map_url ?? null,
      teeColor: row.tee_color || 'White',
      gameStyle: row.game_style as GameStyle,
      teeYardageSets: (() => {
        const legacy = (holesRes.data ?? []).map((h: any) => Number(h.yards));
        if (!teeSchemaAvailable || !(teeSetsRes.data ?? []).length) {
          return [{ name: row.tee_color || 'White', yardages: legacy }];
        }
        const byTee = new Map<string, Map<number, number>>();
        (teeYardagesRes.data ?? []).forEach((yardage: any) => {
          const values = byTee.get(yardage.tee_name) ?? new Map<number, number>();
          values.set(Number(yardage.hole), Number(yardage.yards));
          byTee.set(yardage.tee_name, values);
        });
        return (teeSetsRes.data ?? []).map((tee: any): TeeYardageSet => ({
          name: tee.name,
          yardages: Array.from({ length: 18 }, (_, index) =>
            byTee.get(tee.name)?.get(index + 1) ?? legacy[index] ?? 0,
          ),
        }));
      })(),
      holes: (holesRes.data ?? []).map((h: any) => ({
        hole: h.hole,
        par: h.par,
        yards: h.yards,
      })),
    },
    participants,
    teams,
    playingGroups,
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

/** Club-only, contact-free directory of app accounts and pending invitees. */
export async function apiClubMemberDirectory(): Promise<ClubMember[]> {
  const { data, error } = await supabase.rpc('club_member_directory');
  if (error) throw error;

  return (data ?? []).map((member: any) => ({
    personKey: member.person_key,
    accountId: member.account_id ?? null,
    displayName: member.display_name,
    username: member.username ?? null,
    avatarUrl: member.avatar_url ?? null,
    isClubAdmin: Boolean(member.is_club_admin),
    status: member.status === 'app_user' ? 'app_user' : 'invited',
    nameConflict: Boolean(member.name_conflict),
    eventCount: Number(member.event_count),
    attendances: (member.attendances ?? []).map((attendance: any) => ({
      eventId: attendance.eventId,
      eventName: attendance.eventName,
      courseName: attendance.courseName,
      eventDate: attendance.eventDate,
      lifecycleStatus: attendance.lifecycleStatus as EventLifecycleStatus,
      participantId: attendance.participantId,
      claimed: Boolean(attendance.claimed),
      isEventAdmin: Boolean(attendance.isEventAdmin),
      inviteSentAt: attendance.inviteSentAt ?? null,
    })),
  }));
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
    startFormat?: StartFormat;
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
    start_format: patch.startFormat,
    tee_times: patch.teeTimes,
    course_map_url: patch.courseMapUrl,
    tee_color: patch.teeColor,
    lifecycle_status: patch.lifecycleStatus,
  });
  if (!payload) return;

  const { error } = await supabase.from('events').update(payload).eq('id', eventId);
  if (error) throw error;
}

/** Applies the complete schedule and all physical foursomes in one transaction. */
export async function apiApplyEventSchedule(input: {
  eventId: string;
  startFormat: StartFormat;
  startTime: string;
  teeTimes: string[];
  groups: PlayingGroup[];
}): Promise<string[]> {
  const { data, error } = await supabase.rpc('apply_event_schedule', {
    p_event_id: input.eventId,
    p_start_format: input.startFormat,
    p_start_time: input.startTime,
    p_tee_times: input.teeTimes,
    p_groups: input.groups.map((group, index) => ({
      id: group.id.startsWith('new-playing-group-') ? null : group.id,
      name: group.name,
      tee_time: group.teeTime,
      starting_hole: group.startingHole,
      cart: group.cart,
      sort_order: index,
      member_ids: group.memberIds,
    })),
  });
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

export async function apiUpdateScorecard(
  eventId: string,
  holes: Hole[],
  teeYardageSets: TeeYardageSet[],
) {
  const { error: rpcError } = await supabase.rpc('apply_event_scorecard', {
    p_event_id: eventId,
    p_holes: holes.map(({ hole, par }) => ({ hole, par })),
    p_tee_sets: teeYardageSets.map((tee) => ({
      name: tee.name,
      yardages: tee.yardages.map((yards, index) => ({ hole: index + 1, yards })),
    })),
  });
  if (!rpcError) return;

  // A local preview can run against a production project before this additive
  // migration is deployed. Preserve manual edits for its legacy single tee;
  // multi-tee saving deliberately waits for the atomic server RPC.
  if (!/apply_event_scorecard|schema cache|Could not find the function/i.test(rpcError.message)) {
    throw new Error(rpcError.message);
  }
  if (teeYardageSets.length !== 1) {
    throw new Error('Multi-tee scorecards need the latest database update.');
  }
  const rows = holes.map((hole) => ({ event_id: eventId, hole: hole.hole, par: hole.par, yards: hole.yards }));

  // Supabase does not return changed rows unless select() is chained. Asking
  // for the hole numbers lets us distinguish a real save from a policy/filter
  // no-op that otherwise looks successful to the client.
  const { data, error } = await supabase
    .from('holes')
    .upsert(rows, { onConflict: 'event_id,hole' })
    .select('hole');
  if (error) throw new Error(error.message);
  if (!data || data.length !== rows.length) {
    throw new Error('The scorecard update did not reach every hole.');
  }
}

export type ExtractedScorecard = {
  holes: Array<{ hole: number; par: number }>;
  teeSets: TeeYardageSet[];
  notes: string[];
};

/** Sends one admin-selected image to the server-side vision extractor. */
export async function apiExtractScorecard(input: {
  eventId: string;
  imageBase64: string;
  mimeType: string;
}): Promise<ExtractedScorecard> {
  const { data, error } = await supabase.functions.invoke<ExtractedScorecard>('extract-scorecard', {
    body: input,
  });
  if (error) {
    // functions.invoke intentionally uses a generic HTTP error. Preserve the
    // function's safe, user-facing reason (never the provider response/key) so
    // an admin can correct a blurry image or access issue without a console.
    let detail = '';
    const response = (error as { context?: unknown }).context;
    if (response && typeof (response as Response).json === 'function') {
      try {
        const payload = await (response as Response).json() as { error?: unknown };
        detail = typeof payload.error === 'string' ? payload.error : '';
      } catch {
        // Fall back to the SDK message when the gateway response has no JSON.
      }
    }
    throw new Error(detail || error.message || 'The scorecard scan could not be completed.');
  }
  if (!data || !Array.isArray(data.holes) || !Array.isArray(data.teeSets)) {
    throw new Error('The scorecard scan returned an incomplete result.');
  }
  return data;
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
  patch: {
    name?: string;
    individualException?: boolean;
    teeTime?: string | null;
    startingHole?: number | null;
    cart?: string | null;
  },
) {
  const payload = assigned({
    name: patch.name,
    individual_exception: patch.individualException,
    tee_time: patch.teeTime,
    starting_hole: patch.startingHole,
    cart: patch.cart,
  });
  if (!payload) return;

  const { error } = await supabase.from('teams').update(payload).eq('id', teamId);
  if (error) throw error;
}

/** Assigns the event-scoped identity manager without changing team membership. */
export async function apiSetTeamLeader(
  eventId: string,
  teamId: string,
  leaderParticipantId: string | null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_team_leader', {
    p_event_id: eventId,
    p_team_id: teamId,
    p_leader_participant_id: leaderParticipantId,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Member-only rename. The RPC proves event-scoped team membership server-side. */
export async function apiRenameOwnScoringTeam(
  eventId: string,
  teamId: string,
  name: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('rename_own_scoring_team', {
    p_event_id: eventId,
    p_team_id: teamId,
    p_name: name,
  });
  if (error) throw error;
  return data as string;
}

export async function apiAssignToTeam(
  eventId: string,
  participantId: string,
  teamId: string | null,
) {
  const { error } = await supabase.rpc('assign_scoring_team_member', {
    p_event_id: eventId,
    p_participant_id: participantId,
    p_team_id: teamId,
  });
  if (error) throw error;
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
    individualException: boolean;
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
      individual_exception: team.individualException,
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
    leaderManaged: Boolean(participant.leader_managed),
    inviteEnabled: participant.invite_enabled !== false,
    claimEmailBound: Boolean(participant.claim_email_bound),
    identityVersion: Number(participant.identity_version ?? 0),
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
    const email = row.email?.trim().toLowerCase() || null;
    return {
      event_id: eventId,
      full_name: row.fullName,
      handicap: row.handicap,
      is_admin: row.isAdmin,
      invite_code: inviteCode,
      auth_email: email ?? syntheticEmail(inviteCode),
      // No-email placeholders have no usable claim path. Adding an address is
      // still separate from the later, explicit send-invite action.
      invite_enabled: email !== null,
      claim_email_bound: email !== null,
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
    leaderManaged: Boolean(p.leader_managed),
    inviteEnabled: p.invite_enabled !== false,
    claimEmailBound: Boolean(p.claim_email_bound),
    identityVersion: Number(p.identity_version ?? 0),
  }));
}

/**
 * Leader-only placeholder identity update. The RPC proves leadership, same-team
 * membership, unclaimed state, and optimistic version before writing.
 */
export async function apiUpdateLeaderManagedTeammate(input: {
  eventId: string;
  participantId: string;
  expectedVersion: number;
  fullName: string;
  email: string | null;
}): Promise<
  Pick<
    Participant,
    | 'id'
    | 'fullName'
    | 'initials'
    | 'inviteCode'
    | 'authEmail'
    | 'claimed'
    | 'inviteSentAt'
    | 'leaderManaged'
    | 'inviteEnabled'
    | 'claimEmailBound'
    | 'identityVersion'
  >
> {
  const { data, error } = await supabase.rpc('update_leader_managed_teammate', {
    p_event_id: input.eventId,
    p_target_participant_id: input.participantId,
    p_expected_version: input.expectedVersion,
    p_full_name: input.fullName,
    p_email: input.email,
  });
  if (error) throw error;

  const participant = (data as any[] | null)?.[0];
  if (!participant) {
    throw new Error('The teammate was not updated. Refresh and try again.');
  }

  return {
    id: participant.id,
    fullName: participant.full_name,
    initials: initialsOf(participant.full_name),
    inviteCode: participant.invite_code,
    authEmail: participant.auth_email,
    claimed: Boolean(participant.claimed),
    inviteSentAt: participant.invite_sent_at ?? null,
    leaderManaged: Boolean(participant.leader_managed),
    inviteEnabled: Boolean(participant.invite_enabled),
    claimEmailBound: Boolean(participant.claim_email_bound),
    identityVersion: Number(participant.identity_version ?? 0),
  };
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
    inviteCode?: string;
    inviteSentAt?: string | null;
    inviteEnabled?: boolean;
    claimEmailBound?: boolean;
    identityVersion?: number;
  },
) {
  const payload = assigned({
    full_name: patch.fullName,
    handicap: patch.handicap,
    is_admin: patch.isAdmin,
    auth_email: patch.authEmail,
    invite_code: patch.inviteCode,
    invite_sent_at: patch.inviteSentAt,
    invite_enabled: patch.inviteEnabled,
    claim_email_bound: patch.claimEmailBound,
    identity_version: patch.identityVersion,
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
