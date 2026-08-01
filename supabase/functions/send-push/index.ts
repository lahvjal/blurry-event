/**
 * Web Push sender.
 *
 * Postgres triggers (see migration 0011_push.sql) post `{ type, id }` here when
 * something happens worth telling people about. This function resolves who
 * should hear about it, signs a payload per device with the VAPID keys, and
 * posts it to each browser's push service.
 *
 * Deployed with `verify_jwt = false`: the caller is Postgres, not a signed-in
 * user, so it authenticates with a shared secret header instead of a JWT.
 *
 * Secrets (set with `supabase secrets set`):
 *   VAPID_PUBLIC_KEY   the same key the client subscribes with
 *   VAPID_PRIVATE_KEY  signing key — server only, never in the app bundle
 *   VAPID_SUBJECT      a mailto: or https: contact url, required by the spec
 *   PUSH_HOOK_SECRET   must match app.push_hook_secret in the database
 */

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@blurry.golf';
const PUSH_HOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET') ?? '';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Service role: this runs on behalf of the system, reading conversation members
// and every device's subscription, neither of which any single user may see.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

type Payload = {
  title: string;
  body: string;
  /** Path the notification opens. Relative so it works on any deploy origin. */
  url: string;
  /** Collapse key — a second message in a thread replaces the first. */
  tag?: string;
  /**
   * Unread total for the home screen icon badge. Named to avoid colliding with
   * the Notification API's own `badge`, which is the small monochrome glyph.
   * Filled in per recipient at delivery time, not here — everyone receiving a
   * given notification has a different count.
   */
  badgeCount?: number;
};

/** A notification and the auth users who should receive it. */
type Fanout = { recipients: string[]; payload: Payload } | null;

const firstName = (full: string | null | undefined) =>
  (full ?? 'Someone').split(' ')[0];

const mediaName = (mimeType: string | null | undefined) =>
  mimeType === 'image/gif' ? 'GIF' : 'photo';

// ---------------------------------------------------------------------------
// Resolving each event type into recipients + copy
// ---------------------------------------------------------------------------

async function forMessage(id: string): Promise<Fanout> {
  const { data: message } = await admin
    .from('messages')
    .select('body, sender_id, conversation_id, media_mime_type')
    .eq('id', id)
    .maybeSingle();
  if (!message) return null;

  const { data: conversation } = await admin
    .from('conversations')
    .select('id, kind, name, event_id')
    .eq('id', message.conversation_id)
    .maybeSingle();
  if (!conversation) return null;

  const { data: sender } = await admin
    .from('participants')
    .select('full_name')
    .eq('id', message.sender_id)
    .maybeSingle();

  // Everyone in the thread except whoever just spoke.
  const { data: members } = await admin
    .from('conversation_members')
    .select('participant_id, participants!inner(claimed_by)')
    .eq('conversation_id', conversation.id)
    .eq('notifications_enabled', true)
    .neq('participant_id', message.sender_id);

  const recipients = (members ?? [])
    .map((row) => (row.participants as { claimed_by: string | null }).claimed_by)
    .filter((uid): uid is string => Boolean(uid));

  const direct = conversation.kind === 'direct';
  const messageBody =
    message.body.trim() ||
    `Sent a ${mediaName(message.media_mime_type)}`;

  let groupTitle = conversation.name?.trim();
  if (!direct && !groupTitle) {
    // The all-hands thread has no name of its own; it's titled after the event.
    const { data: event } = await admin
      .from('events')
      .select('name')
      .eq('id', conversation.event_id)
      .maybeSingle();
    groupTitle = event?.name ?? 'Event chat';
  }

  return {
    recipients,
    payload: {
      title: direct ? (sender?.full_name ?? 'New message') : groupTitle!,
      // In a group the sender needs naming; in a DM the title already does it.
      body: direct
        ? messageBody
        : `${firstName(sender?.full_name)}: ${messageBody}`,
      url: `/events/${conversation.event_id}/${direct ? 'direct-message' : 'group-conversation'}?id=${conversation.id}`,
      tag: `conversation-${conversation.id}`,
    },
  };
}

async function forReaction(
  messageId: string,
  participantId: string,
  emoji: string,
): Promise<Fanout> {
  const { data: message } = await admin
    .from('messages')
    .select('body, sender_id, conversation_id, media_mime_type')
    .eq('id', messageId)
    .maybeSingle();
  if (!message || message.sender_id === participantId) return null;

  const { data: conversation } = await admin
    .from('conversations')
    .select('id, kind, name, event_id')
    .eq('id', message.conversation_id)
    .maybeSingle();
  if (!conversation) return null;

  const { data: reactor } = await admin
    .from('participants')
    .select('full_name')
    .eq('id', participantId)
    .maybeSingle();

  // A reaction is personal activity for the message author, not a broadcast
  // to everyone else in a group conversation.
  const { data: recipient } = await admin
    .from('conversation_members')
    .select('participants!inner(claimed_by)')
    .eq('conversation_id', conversation.id)
    .eq('participant_id', message.sender_id)
    .eq('notifications_enabled', true)
    .maybeSingle();

  const userId = (
    recipient?.participants as { claimed_by: string | null } | undefined
  )?.claimed_by;
  if (!userId) return null;

  const direct = conversation.kind === 'direct';
  let groupTitle = conversation.name?.trim();
  if (!direct && !groupTitle) {
    const { data: event } = await admin
      .from('events')
      .select('name')
      .eq('id', conversation.event_id)
      .maybeSingle();
    groupTitle = event?.name ?? 'Event chat';
  }

  const trimmed = message.body.trim();
  const excerpt =
    trimmed.length > 72 ? `${trimmed.slice(0, 71)}…` : trimmed;
  const reactionTarget = excerpt
    ? `“${excerpt}”`
    : `a ${mediaName(message.media_mime_type)}`;
  const reactorName = reactor?.full_name ?? 'Someone';

  return {
    recipients: [userId],
    payload: {
      title: direct ? reactorName : groupTitle!,
      body: direct
        ? `${emoji} reacted to ${reactionTarget}`
        : `${firstName(reactorName)} reacted ${emoji} to ${reactionTarget}`,
      url: `/events/${conversation.event_id}/${direct ? 'direct-message' : 'group-conversation'}?id=${conversation.id}`,
      tag: `conversation-${conversation.id}`,
    },
  };
}

async function forAnnouncement(id: string): Promise<Fanout> {
  const { data: announcement } = await admin
    .from('announcements')
    .select('body, event_id, created_by')
    .eq('id', id)
    .maybeSingle();
  if (!announcement) return null;

  const { data: event } = await admin
    .from('events')
    .select('name')
    .eq('id', announcement.event_id)
    .maybeSingle();

  // The whole roster, minus the admin who wrote it.
  let query = admin
    .from('participants')
    .select('claimed_by')
    .eq('event_id', announcement.event_id)
    .not('claimed_by', 'is', null);
  if (announcement.created_by) query = query.neq('id', announcement.created_by);

  const { data: participants } = await query;

  return {
    recipients: (participants ?? [])
      .map((p) => p.claimed_by)
      .filter((uid): uid is string => Boolean(uid)),
    payload: {
      title: event?.name ?? 'Blurry Invitational',
      body: announcement.body,
      url: `/events/${announcement.event_id}/announcements`,
      tag: `announcement-${id}`,
    },
  };
}

async function forTeamUpdate(id: string): Promise<Fanout> {
  const { data: team } = await admin
    .from('teams')
    .select('name, tee_time, starting_hole, event_id')
    .eq('id', id)
    .maybeSingle();
  if (!team) return null;

  const { data: members } = await admin
    .from('team_members')
    .select('participants!inner(claimed_by)')
    .eq('team_id', id);

  const detail = [
    team.tee_time ? `Tee time ${team.tee_time}` : null,
    team.starting_hole ? `hole ${team.starting_hole}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    recipients: (members ?? [])
      .map((row) => (row.participants as { claimed_by: string | null }).claimed_by)
      .filter((uid): uid is string => Boolean(uid)),
    payload: {
      title: team.name,
      body: detail ? `Updated — ${detail}` : 'Your tee time was updated.',
      url: `/events/${team.event_id}/my-team`,
      tag: `team-${id}`,
    },
  };
}

async function forTeamAssignment(
  teamId: string,
  participantId: string,
): Promise<Fanout> {
  const { data: team } = await admin
    .from('teams')
    .select('name, tee_time, event_id')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) return null;

  const { data: participant } = await admin
    .from('participants')
    .select('claimed_by')
    .eq('id', participantId)
    .maybeSingle();
  if (!participant?.claimed_by) return null;

  return {
    recipients: [participant.claimed_by],
    payload: {
      title: "You're on a team",
      body: team.tee_time
        ? `${team.name} — tee time ${team.tee_time}`
        : team.name,
      url: `/events/${team.event_id}/my-team`,
      tag: `team-assignment-${teamId}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function deliver(recipients: string[], payload: Payload) {
  if (recipients.length === 0) return { sent: 0, pruned: 0 };

  const { data: subscriptions } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_id')
    .in('user_id', recipients);

  if (!subscriptions?.length) return { sent: 0, pruned: 0 };

  // Every recipient's badge is their own number, so the payload can't be shared
  // across devices the way the title and body can. One round trip covers all of
  // them; anyone with nothing unread simply doesn't come back and defaults to 0.
  const { data: totals } = await admin.rpc('unread_totals', {
    user_ids: recipients,
  });
  const badgeByUser = new Map<string, number>(
    (totals ?? []).map((row: { user_id: string; unread: number }) => [
      row.user_id,
      Number(row.unread),
    ]),
  );

  const dead: string[] = [];

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          ...payload,
          badgeCount: badgeByUser.get(sub.user_id) ?? 0,
        }),
        { TTL: 60 * 60 * 12 },
      ).catch((error: { statusCode?: number }) => {
        // 404/410 mean the browser threw this subscription away — the app was
        // uninstalled, or permission was revoked. Anything else (a timeout, a
        // 5xx from the push service) may well work next time, so it's left be.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          dead.push(sub.id);
          return;
        }
        throw error;
      }),
    ),
  );

  if (dead.length) {
    await admin.from('push_subscriptions').delete().in('id', dead);
  }

  return {
    sent: results.filter((r) => r.status === 'fulfilled').length - dead.length,
    pruned: dead.length,
  };
}

// ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Constant work regardless of outcome isn't worth it here — the secret is
  // high-entropy and the endpoint is unauthenticated only in the JWT sense.
  if (!PUSH_HOOK_SECRET || request.headers.get('x-push-secret') !== PUSH_HOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response('VAPID keys not configured', { status: 500 });
  }

  let event: {
    type?: string;
    id?: string;
    message_id?: string;
    emoji?: string;
    team_id?: string;
    participant_id?: string;
  };
  try {
    event = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  let fanout: Fanout = null;
  try {
    switch (event.type) {
      case 'message':
        fanout = event.id ? await forMessage(event.id) : null;
        break;
      case 'reaction':
        fanout =
          event.message_id && event.participant_id && event.emoji
            ? await forReaction(
                event.message_id,
                event.participant_id,
                event.emoji,
              )
            : null;
        break;
      case 'announcement':
        fanout = event.id ? await forAnnouncement(event.id) : null;
        break;
      case 'team_update':
        fanout = event.id ? await forTeamUpdate(event.id) : null;
        break;
      case 'team_assignment':
        fanout =
          event.team_id && event.participant_id
            ? await forTeamAssignment(event.team_id, event.participant_id)
            : null;
        break;
      default:
        return new Response('Unknown event type', { status: 400 });
    }
  } catch (error) {
    console.error('resolve failed', event.type, error);
    return new Response('Resolve failed', { status: 500 });
  }

  if (!fanout) {
    return Response.json({ sent: 0, pruned: 0, skipped: 'nothing to send' });
  }

  try {
    const result = await deliver(fanout.recipients, fanout.payload);
    return Response.json(result);
  } catch (error) {
    console.error('deliver failed', error);
    return new Response('Deliver failed', { status: 500 });
  }
});
