import {
  ImageManipulator,
  SaveFormat,
} from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { isPermanentError, supabase } from '@/lib/supabase';
import { enqueue } from '@/lib/sync';
import { isBrowserDefinitelyOffline } from '@/lib/offline/network';
import {
  ChatMessage,
  ChatMessageMedia,
  ChatMessageMediaDraft,
  ChatMessageReaction,
  Conversation,
  ConversationKind,
  ConversationSummary,
} from '@/state/types';

/**
 * Chat reads and writes. Sends go through the offline queue (lib/sync.ts) so a
 * message typed with no signal lands when the phone reconnects; everything else
 * is a live query. Creating conversations and the inbox listing are Postgres
 * functions — see supabase/migrations/0007_messaging.sql.
 */

/** Small first paint; older messages arrive in the same-sized cursor pages. */
const MESSAGE_PAGE = 40;
const MAX_MESSAGE_MEDIA_BYTES = 15 * 1024 * 1024;
const MAX_SOURCE_PHOTO_BYTES = 40 * 1024 * 1024;
const MAX_PHOTO_EDGE = 2048;
const PHOTO_COMPRESSION = 0.78;

type SummaryRow = {
  id: string;
  event_id: string;
  event_name: string;
  kind: ConversationKind;
  name: string | null;
  created_by: string | null;
  my_participant_id: string;
  member_ids: string[] | null;
  direct_participant_id: string | null;
  direct_participant_name: string | null;
  direct_participant_avatar_url: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  last_message_media_mime_type?: string | null;
  last_activity_at?: string | null;
  last_activity_kind?: 'message' | 'reaction' | null;
  last_reaction_emoji?: string | null;
  last_reactor_id?: string | null;
  last_reactor_name?: string | null;
  last_reaction_message_body?: string | null;
  last_reaction_message_media_mime_type?: string | null;
  unread_count: number;
};

type MessageRow = {
  id: string;
  event_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  reply_to_id?: string | null;
  client_id: string;
  created_at: string;
  edited_at?: string | null;
  media_url?: string | null;
  media_mime_type?: string | null;
  media_width?: number | null;
  media_height?: number | null;
  message_reactions?: ReactionRow[] | null;
};

type ReactionRow = {
  message_id?: string;
  participant_id: string;
  emoji: string;
};

export type MessageCursor = {
  createdAt: string;
};

export type MessagePage = {
  messages: ChatMessage[];
  hasOlder: boolean;
};

/**
 * Version-4-shaped id for messages.client_id. Math.random is fine here: the
 * value only has to be unique enough that a retried send is recognised as a
 * duplicate, and it never carries any authority.
 */
export function newClientId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    // Variant bits: one of 8, 9, a, b.
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)];
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    eventId: row.event_id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    replyToId: row.reply_to_id ?? null,
    clientId: row.client_id,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    media:
      row.media_url && row.media_mime_type
        ? {
            url: row.media_url,
            mimeType: row.media_mime_type,
            width: row.media_width ?? null,
            height: row.media_height ?? null,
          }
        : null,
    reactions: (row.message_reactions ?? []).map((reaction) => ({
      participantId: reaction.participant_id,
      emoji: reaction.emoji,
    })),
  };
}

export async function fetchConversationSummaries(): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('club_conversation_summaries');
  if (error) throw error;

  return ((data ?? []) as SummaryRow[]).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    eventName: row.event_name,
    kind: row.kind,
    name: row.name,
    createdBy: row.created_by,
    myParticipantId: row.my_participant_id,
    memberIds: row.member_ids ?? [],
    directParticipantId: row.direct_participant_id,
    directParticipantName: row.direct_participant_name,
    directParticipantAvatarUrl: row.direct_participant_avatar_url,
    lastMessageBody: row.last_message_body,
    lastMessageAt: row.last_message_at,
    lastSenderId: row.last_sender_id,
    lastSenderName: row.last_sender_name,
    lastMessageMediaMimeType: row.last_message_media_mime_type ?? null,
    // These fields arrive with migration 0019. Falling back to the newest
    // message keeps the inbox usable while the app and database roll out.
    lastActivityAt: row.last_activity_at ?? row.last_message_at,
    lastActivityKind:
      row.last_activity_kind ??
      (row.last_message_at ? 'message' : null),
    lastReactionEmoji: row.last_reaction_emoji ?? null,
    lastReactorId: row.last_reactor_id ?? null,
    lastReactorName: row.last_reactor_name ?? null,
    lastReactionMessageBody: row.last_reaction_message_body ?? null,
    lastReactionMessageMediaMimeType:
      row.last_reaction_message_media_mime_type ?? null,
    unreadCount: row.unread_count ?? 0,
  }));
}

/** The conversation itself and who is in it, for a thread header or settings. */
export async function fetchConversation(
  eventId: string,
  id: string,
): Promise<Conversation | null> {
  let { data, error } = await supabase
    .from('conversations')
    .select(
      'id, kind, name, created_by, team_id, conversation_members(participant_id)',
    )
    .eq('event_id', eventId)
    .eq('id', id)
    .maybeSingle();

  // Keep ordinary chats readable while migration 0021 rolls out.
  if (
    error &&
    ['42703', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code ?? '')
  ) {
    ({ data, error } = await supabase
      .from('conversations')
      .select('id, kind, name, created_by, conversation_members(participant_id)')
      .eq('event_id', eventId)
      .eq('id', id)
      .maybeSingle());
  }

  if (error) throw error;
  if (!data) return null;

  const row = data as {
    id: string;
    kind: ConversationKind;
    name: string | null;
    created_by: string | null;
    team_id?: string | null;
    conversation_members: { participant_id: string }[] | null;
  };

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdBy: row.created_by,
    teamId: row.team_id ?? null,
    memberIds: (row.conversation_members ?? []).map((m) => m.participant_id),
  };
}

/** Newest page first from Postgres, returned oldest-first for the thread. */
export async function fetchMessages(
  eventId: string,
  conversationId: string,
  before?: MessageCursor,
): Promise<MessagePage> {
  // Newest-first with a limit uses the (conversation_id, created_at desc)
  // index and keeps the most recent page. A timestamp cursor avoids offset
  // drift when new messages arrive while someone is reading older history.
  const query = (selection: string) => {
    let request = supabase
      .from('messages')
      .select(selection)
      .eq('event_id', eventId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false });
    if (before) request = request.lt('created_at', before.createdAt);
    return request.limit(MESSAGE_PAGE + 1);
  };

  const selections = [
    'id, event_id, conversation_id, sender_id, body, reply_to_id, client_id, created_at, edited_at, media_url, media_mime_type, media_width, media_height, message_reactions(participant_id, emoji)',
    'id, event_id, conversation_id, sender_id, body, reply_to_id, client_id, created_at, edited_at, message_reactions(participant_id, emoji)',
    'id, event_id, conversation_id, sender_id, body, client_id, created_at, message_reactions(participant_id, emoji)',
    'id, event_id, conversation_id, sender_id, body, client_id, created_at',
  ];

  let data: unknown[] | null = null;
  let error: { code?: string; message?: string } | null = null;
  for (const selection of selections) {
    ({ data, error } = await query(selection));
    if (!error) break;
    if (
      error.code !== 'PGRST200' &&
      error.code !== 'PGRST204' &&
      error.code !== 'PGRST205' &&
      error.code !== '42703'
    ) {
      break;
    }
  }

  if (error) throw error;
  const rows = (data ?? []) as unknown as MessageRow[];
  return {
    messages: rows.slice(0, MESSAGE_PAGE).map(toMessage).reverse(),
    hasOlder: rows.length > MESSAGE_PAGE,
  };
}

/**
 * Sends a message and returns the bubble to render for it.
 *
 * Tries the write directly so a rejection (no longer in the group, say) can be
 * shown straight away rather than disappearing into the queue. Only a failure
 * to reach the server falls back to the queue, which is what makes sending from
 * a dead spot on the course work — the row is then confirmed over realtime, or
 * by the next load, and matched up by clientId.
 */
export async function sendMessage(params: {
  eventId: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToId?: string | null;
  attachment?: ChatMessageMediaDraft | null;
}): Promise<ChatMessage> {
  const clientId = newClientId();
  const definitelyOffline = isBrowserDefinitelyOffline();
  if (definitelyOffline && params.attachment) {
    throw new Error(
      'Photos need a connection. Remove the attachment to queue this text message, or try again after reconnecting.',
    );
  }
  const media = params.attachment
    ? await uploadMessageMedia(params.conversationId, params.attachment)
    : null;
  const optimistic: ChatMessage = {
    id: `local-${clientId}`,
    eventId: params.eventId,
    conversationId: params.conversationId,
    senderId: params.senderId,
    body: params.body,
    replyToId: params.replyToId ?? null,
    clientId,
    createdAt: new Date().toISOString(),
    editedAt: null,
    media,
    reactions: [],
    pending: true,
    deliveryState: 'queued',
  };

  // Avoid waiting for a request the browser already knows cannot succeed. The
  // durable queue is the success boundary while offline.
  if (definitelyOffline) {
    await enqueue({
      kind: 'message',
      eventId: params.eventId,
      conversationId: params.conversationId,
      senderId: params.senderId,
      body: params.body,
      replyToId: params.replyToId ?? null,
      media,
      clientId,
    });
    return optimistic;
  }

  const { error } = await supabase.from('messages').insert({
    event_id: params.eventId,
    conversation_id: params.conversationId,
    sender_id: params.senderId,
    body: params.body,
    client_id: clientId,
    ...(params.replyToId ? { reply_to_id: params.replyToId } : {}),
    ...(media
      ? {
          media_url: media.url,
          media_mime_type: media.mimeType,
          media_width: media.width,
          media_height: media.height,
        }
      : {}),
  });

  // A duplicate client_id means this exact message already landed.
  if (!error || error.code === '23505') {
    return { ...optimistic, pending: false, deliveryState: 'sent' };
  }

  if (isPermanentError(error)) throw error;

  await enqueue({
    kind: 'message',
    eventId: params.eventId,
    conversationId: params.conversationId,
    senderId: params.senderId,
    body: params.body,
    replyToId: params.replyToId ?? null,
    media,
    clientId,
  });

  return optimistic;
}

function mediaMimeType(draft: ChatMessageMediaDraft): string {
  if (draft.mimeType?.startsWith('image/')) return draft.mimeType.toLowerCase();
  const extension = draft.fileName?.split('.').pop()?.toLowerCase();
  if (extension === 'gif') return 'image/gif';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'avif') return 'image/avif';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'image/jpeg';
}

type PreparedMessageMedia = {
  bytes: ArrayBuffer;
  mimeType: string;
  extension: string;
  width: number | null;
  height: number | null;
};

async function readMediaBytes(draft: ChatMessageMediaDraft): Promise<ArrayBuffer> {
  if (draft.webFile) return draft.webFile.arrayBuffer();

  return readMediaUri(draft.uri);
}

async function readMediaUri(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read that image.');
  return response.arrayBuffer();
}

function scaledPhotoSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const largestEdge = Math.max(safeWidth, safeHeight);
  if (largestEdge <= MAX_PHOTO_EDGE) {
    return { width: safeWidth, height: safeHeight };
  }
  const scale = MAX_PHOTO_EDGE / largestEdge;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function loadWebPhoto(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = document.createElement('img');
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          'That camera photo could not be decoded. Try taking it again.',
        ),
      );
    image.src = uri;
  });
}

function encodeWebPhoto(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('That camera photo could not be converted.'));
      },
      'image/jpeg',
      PHOTO_COMPRESSION,
    );
  });
}

/**
 * Camera captures in an iOS PWA arrive as a web File plus a temporary blob URL.
 * Drawing that File directly into the final-sized canvas avoids depending on a
 * stale picker URL and avoids Expo's full-resolution intermediate PNG canvas,
 * which can exhaust Safari's memory for modern iPhone photos.
 */
async function prepareWebPhoto(
  draft: ChatMessageMediaDraft,
): Promise<PreparedMessageMedia> {
  const createdUri = draft.webFile
    ? URL.createObjectURL(draft.webFile)
    : null;
  try {
    const image = await loadWebPhoto(createdUri ?? draft.uri);
    const sourceWidth = image.naturalWidth || draft.width;
    const sourceHeight = image.naturalHeight || draft.height;
    if (!sourceWidth || !sourceHeight) {
      throw new Error('That camera photo has no readable dimensions.');
    }

    const size = scaledPhotoSize(sourceWidth, sourceHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('That camera photo could not be prepared.');
    context.drawImage(image, 0, 0, size.width, size.height);

    const blob = await encodeWebPhoto(canvas);
    if (blob.size > MAX_MESSAGE_MEDIA_BYTES) {
      throw new Error('That photo is still larger than 15 MB after compression.');
    }

    return {
      bytes: await blob.arrayBuffer(),
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: size.width,
      height: size.height,
    };
  } finally {
    if (createdUri) URL.revokeObjectURL(createdUri);
  }
}

/**
 * Resizes photos before encoding them as JPEG. JPEG is used because iOS PWAs
 * do not consistently expose WebP encoding through canvas.toBlob, while Expo's
 * JPEG path is supported across native iOS, Android, and web. GIFs are
 * deliberately
 * kept intact: image re-encoders flatten them to one frame, so their safety
 * control is the upload cap rather than destructive recompression.
 */
async function prepareMessageMedia(
  draft: ChatMessageMediaDraft,
): Promise<PreparedMessageMedia> {
  const mimeType = mediaMimeType(draft);

  if (mimeType === 'image/gif') {
    const sourceBytes = await readMediaBytes(draft);
    if (sourceBytes.byteLength > MAX_MESSAGE_MEDIA_BYTES) {
      throw new Error('Choose a GIF smaller than 15 MB.');
    }
    return {
      bytes: sourceBytes,
      mimeType,
      extension: 'gif',
      width: draft.width || null,
      height: draft.height || null,
    };
  }

  const knownSourceSize = draft.webFile?.size ?? draft.fileSize;
  if (knownSourceSize && knownSourceSize > MAX_SOURCE_PHOTO_BYTES) {
    throw new Error('Choose a photo smaller than 40 MB.');
  }

  if (Platform.OS === 'web') return prepareWebPhoto(draft);

  const sourceBytes = await readMediaBytes(draft);
  if (sourceBytes.byteLength > MAX_SOURCE_PHOTO_BYTES) {
    throw new Error('Choose a photo smaller than 40 MB.');
  }

  const context = ImageManipulator.manipulate(draft.uri);
  const largestEdge = Math.max(draft.width, draft.height);
  if (largestEdge > MAX_PHOTO_EDGE) {
    if (draft.width >= draft.height) {
      context.resize({ width: MAX_PHOTO_EDGE, height: null });
    } else {
      context.resize({ width: null, height: MAX_PHOTO_EDGE });
    }
  }

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    compress: PHOTO_COMPRESSION,
    format: SaveFormat.JPEG,
  });
  const compressedBytes = await readMediaUri(result.uri);
  if (compressedBytes.byteLength > MAX_MESSAGE_MEDIA_BYTES) {
    throw new Error('That photo is still larger than 15 MB after compression.');
  }

  return {
    bytes: compressedBytes,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    width: result.width || null,
    height: result.height || null,
  };
}

/** Compresses and uploads one selected photo/GIF before inserting its message. */
async function uploadMessageMedia(
  conversationId: string,
  draft: ChatMessageMediaDraft,
): Promise<ChatMessageMedia> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Sign in again to share an image.');

  const prepared = await prepareMessageMedia(draft);
  const path =
    `${userId}/${conversationId}/${newClientId()}.${prepared.extension}`;
  const { error } = await supabase.storage
    .from('message-media')
    .upload(path, prepared.bytes, {
      cacheControl: '31536000',
      contentType: prepared.mimeType,
      upsert: false,
    });
  if (error) throw error;

  const { data } = supabase.storage.from('message-media').getPublicUrl(path);
  return {
    url: data.publicUrl,
    mimeType: prepared.mimeType,
    width: prepared.width,
    height: prepared.height,
  };
}

/** Changes one of the caller's own messages. The database trigger records the
 * edit time and rejects attempts to change message ownership or threading. */
export async function editMessageBody(
  eventId: string,
  messageId: string,
  body: string,
): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .update({ body })
    .eq('event_id', eventId)
    .eq('id', messageId);
  if (error) throw error;
}

/** Removes one of the caller's own messages for everyone in the thread. */
export async function unsendMessage(
  eventId: string,
  messageId: string,
): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('event_id', eventId)
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * Adds or removes one participant's emoji on a message. The caller updates the
 * bubble optimistically; realtime then mirrors the same change to everyone
 * else with the thread open.
 */
export async function toggleMessageReaction(params: {
  eventId: string;
  messageId: string;
  participantId: string;
  emoji: string;
  remove: boolean;
}): Promise<void> {
  if (params.remove) {
    const { error } = await supabase
      .from('message_reactions')
      .delete()
      .eq('event_id', params.eventId)
      .eq('message_id', params.messageId)
      .eq('participant_id', params.participantId)
      .eq('emoji', params.emoji);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('message_reactions').insert({
    event_id: params.eventId,
    message_id: params.messageId,
    participant_id: params.participantId,
    emoji: params.emoji,
  });

  // The composite key makes a repeated tap/retry harmless.
  if (error && error.code !== '23505') throw error;
}

/** Clears the unread badge. Failures are the caller's to ignore. */
export async function markConversationRead(
  conversationId: string,
  participantId: string,
): Promise<void> {
  const { error } = await supabase
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('participant_id', participantId);
  if (error) throw error;
}

/** Whether this member wants push alerts for one conversation. */
export async function fetchConversationNotifications(
  conversationId: string,
  participantId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('conversation_members')
    .select('notifications_enabled')
    .eq('conversation_id', conversationId)
    .eq('participant_id', participantId)
    .maybeSingle();

  if (error) throw error;
  return data?.notifications_enabled ?? true;
}

/**
 * Mutes or unmutes one thread for the signed-in participant. RLS only allows a
 * member to update their own row, so the preference cannot be changed for
 * anyone else.
 */
export async function setConversationNotifications(
  conversationId: string,
  participantId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('conversation_members')
    .update({ notifications_enabled: enabled })
    .eq('conversation_id', conversationId)
    .eq('participant_id', participantId);

  if (error) throw error;
}

/** The existing 1:1 thread with someone, or null if you've never spoken. */
export async function findDirectConversation(
  eventId: string,
  otherParticipantId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_direct_conversation', {
    p_event_id: eventId,
    other_participant: otherParticipantId,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Returns the id of the 1:1 thread with someone, creating it if it's new. */
export async function openDirectConversation(
  eventId: string,
  otherParticipantId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('open_direct_conversation', {
    p_event_id: eventId,
    other_participant: otherParticipantId,
  });
  if (error) throw error;
  return data as string;
}

export async function createGroupConversation(
  eventId: string,
  name: string,
  memberIds: string[],
): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_conversation', {
    p_event_id: eventId,
    group_name: name,
    member_ids: memberIds,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Returns the official thread for a team, creating it on first use and
 * reconciling its members with the current team assignment.
 */
export async function openTeamConversation(teamId: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_team_conversation', {
    target_team: teamId,
  });
  if (error) throw error;
  return data as string;
}

export async function addConversationMembers(
  conversationId: string,
  memberIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc('add_conversation_members', {
    convo: conversationId,
    member_ids: memberIds,
  });
  if (error) throw error;
}

export async function leaveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_conversation', {
    convo: conversationId,
  });
  if (error) throw error;
}

/** Channel topics stay unique across stacked screens and development hot reloads. */
function realtimeChannelToken(): string {
  return newClientId();
}

/**
 * Live inserts for one conversation, or for every conversation the caller can
 * read when conversationId is null (the inbox uses that to restack itself).
 * RLS applies to the stream, so this only ever delivers readable rows.
 */
export type MessageChange =
  | {
      event: 'INSERT' | 'UPDATE';
      message: ChatMessage;
      messageId: string;
    }
  | {
      event: 'DELETE';
      message: null;
      messageId: string;
    };

export function subscribeToMessages(
  eventId: string,
  conversationId: string | null,
  onChange: (change: MessageChange) => void,
): () => void {
  const channel = supabase
    .channel(
      `messages:${eventId}:${conversationId ?? 'inbox'}:${realtimeChannelToken()}`,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `event_id=eq.${eventId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as Partial<MessageRow>;
          if (
            !oldRow.id ||
            (conversationId && oldRow.conversation_id !== conversationId)
          ) return;
          onChange({
            event: 'DELETE',
            message: null,
            messageId: oldRow.id,
          });
          return;
        }
        if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') {
          return;
        }
        const message = toMessage(payload.new as MessageRow);
        if (conversationId && message.conversationId !== conversationId) return;
        onChange({
          event: payload.eventType,
          message,
          messageId: message.id,
        });
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export type MessageReactionChange = {
  event: 'INSERT' | 'DELETE';
  messageId: string;
  reaction: ChatMessageReaction;
};

/** Live reaction changes for any readable message; the open thread ignores
 * rows whose message id is not currently on screen. */
export function subscribeToMessageReactions(
  eventId: string,
  onChange: (change: MessageReactionChange) => void,
): () => void {
  const channel = supabase
    .channel(`message-reactions:${eventId}:${realtimeChannelToken()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'message_reactions',
        filter: `event_id=eq.${eventId}`,
      },
      (payload) => {
        if (payload.eventType !== 'INSERT' && payload.eventType !== 'DELETE') {
          return;
        }
        const row = (
          payload.eventType === 'DELETE' ? payload.old : payload.new
        ) as ReactionRow;
        if (!row.message_id || !row.participant_id || !row.emoji) return;
        onChange({
          event: payload.eventType,
          messageId: row.message_id,
          reaction: {
            participantId: row.participant_id,
            emoji: row.emoji,
          },
        });
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
