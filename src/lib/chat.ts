import { isPermanentError, supabase } from '@/lib/supabase';
import { enqueue } from '@/lib/sync';
import {
  ChatMessage,
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

/** How many messages a thread loads. Older ones aren't paged in yet. */
const MESSAGE_PAGE = 200;

type SummaryRow = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  created_by: string | null;
  member_ids: string[] | null;
  last_message_body: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread_count: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  client_id: string;
  created_at: string;
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
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    clientId: row.client_id,
    createdAt: row.created_at,
  };
}

export async function fetchConversationSummaries(): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('conversation_summaries');
  if (error) throw error;

  return ((data ?? []) as SummaryRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdBy: row.created_by,
    memberIds: row.member_ids ?? [],
    lastMessageBody: row.last_message_body,
    lastMessageAt: row.last_message_at,
    lastSenderId: row.last_sender_id,
    unreadCount: row.unread_count ?? 0,
  }));
}

/** The conversation itself and who is in it, for a thread header or settings. */
export async function fetchConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, kind, name, created_by, conversation_members(participant_id)')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as {
    id: string;
    kind: ConversationKind;
    name: string | null;
    created_by: string | null;
    conversation_members: { participant_id: string }[] | null;
  };

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdBy: row.created_by,
    memberIds: (row.conversation_members ?? []).map((m) => m.participant_id),
  };
}

/** Oldest first, so the thread renders top to bottom. */
export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  // Newest-first with a limit uses the (conversation_id, created_at desc)
  // index and keeps the most recent page; flip it for display.
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, client_id, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE);

  if (error) throw error;
  return ((data ?? []) as MessageRow[]).map(toMessage).reverse();
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
  conversationId: string;
  senderId: string;
  body: string;
}): Promise<ChatMessage> {
  const clientId = newClientId();
  const optimistic: ChatMessage = {
    id: `local-${clientId}`,
    conversationId: params.conversationId,
    senderId: params.senderId,
    body: params.body,
    clientId,
    createdAt: new Date().toISOString(),
    pending: true,
  };

  const { error } = await supabase.from('messages').insert({
    conversation_id: params.conversationId,
    sender_id: params.senderId,
    body: params.body,
    client_id: clientId,
  });

  // A duplicate client_id means this exact message already landed.
  if (!error || error.code === '23505') {
    return { ...optimistic, pending: false };
  }

  if (isPermanentError(error)) throw error;

  await enqueue({
    kind: 'message',
    conversationId: params.conversationId,
    senderId: params.senderId,
    body: params.body,
    clientId,
  });

  return optimistic;
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
  otherParticipantId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_direct_conversation', {
    other_participant: otherParticipantId,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Returns the id of the 1:1 thread with someone, creating it if it's new. */
export async function openDirectConversation(
  otherParticipantId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('open_direct_conversation', {
    other_participant: otherParticipantId,
  });
  if (error) throw error;
  return data as string;
}

export async function createGroupConversation(
  name: string,
  memberIds: string[],
): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_conversation', {
    group_name: name,
    member_ids: memberIds,
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

/** Channel topics have to be unique per client, and screens overlap in a stack. */
let channelSequence = 0;

/**
 * Live inserts for one conversation, or for every conversation the caller can
 * read when conversationId is null (the inbox uses that to restack itself).
 * RLS applies to the stream, so this only ever delivers readable rows.
 */
export function subscribeToMessages(
  conversationId: string | null,
  onInsert: (message: ChatMessage) => void,
): () => void {
  channelSequence += 1;
  const channel = supabase
    .channel(`messages:${conversationId ?? 'inbox'}:${channelSequence}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        ...(conversationId
          ? { filter: `conversation_id=eq.${conversationId}` }
          : {}),
      },
      (payload) => onInsert(toMessage(payload.new as MessageRow)),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
