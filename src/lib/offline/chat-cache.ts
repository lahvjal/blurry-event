import { cacheStore } from '@/lib/offline/store';
import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
} from '@/state/types';

const SUMMARY_PREFIX = 'offlineChat.summaries.v1';
const CLUB_SUMMARY_PREFIX = 'offlineChat.clubSummaries.v2';
const DETAIL_PREFIX = 'offlineChat.detail.v1';
const MESSAGE_PREFIX = 'offlineChat.messages.v1';

type ScopedRecord<T> = {
  userId: string;
  eventId: string;
  savedAt: string;
  value: T;
};

type AccountRecord<T> = {
  userId: string;
  savedAt: string;
  value: T;
};

function scopedKey(prefix: string, userId: string, eventId: string, suffix = '') {
  return [prefix, encodeURIComponent(userId), encodeURIComponent(eventId), suffix]
    .filter(Boolean)
    .join(':');
}

function valid<T>(
  record: ScopedRecord<T> | null,
  userId: string,
  eventId: string,
): record is ScopedRecord<T> {
  return Boolean(
    record && record.userId === userId && record.eventId === eventId,
  );
}

export async function saveOfflineConversationSummaries(
  userId: string,
  eventId: string,
  value: ConversationSummary[],
): Promise<void> {
  await cacheStore.set(scopedKey(SUMMARY_PREFIX, userId, eventId), {
    userId,
    eventId,
    savedAt: new Date().toISOString(),
    value,
  } satisfies ScopedRecord<ConversationSummary[]>);
}

export async function loadOfflineConversationSummaries(
  userId: string,
  eventId: string,
): Promise<ConversationSummary[] | null> {
  const record = await cacheStore.get<ScopedRecord<ConversationSummary[]>>(
    scopedKey(SUMMARY_PREFIX, userId, eventId),
  );
  return valid(record, userId, eventId) && Array.isArray(record.value)
    ? record.value
    : null;
}

/** The default inbox is account-wide, so its authoritative cache cannot use the
 * focused event as part of its key. Event-scoped v1 rows remain readable below
 * as a compatibility fallback for installs upgrading while offline. */
export async function saveOfflineClubConversationSummaries(
  userId: string,
  value: ConversationSummary[],
): Promise<void> {
  await cacheStore.set(`${CLUB_SUMMARY_PREFIX}:${encodeURIComponent(userId)}`, {
    userId,
    savedAt: new Date().toISOString(),
    value,
  } satisfies AccountRecord<ConversationSummary[]>);
}

export async function loadOfflineClubConversationSummaries(
  userId: string,
): Promise<ConversationSummary[] | null> {
  const record = await cacheStore.get<AccountRecord<ConversationSummary[]>>(
    `${CLUB_SUMMARY_PREFIX}:${encodeURIComponent(userId)}`,
  );
  return record?.userId === userId && Array.isArray(record.value)
    ? record.value
    : null;
}

export async function saveOfflineConversation(
  userId: string,
  eventId: string,
  conversation: Conversation,
): Promise<void> {
  await cacheStore.set(
    scopedKey(DETAIL_PREFIX, userId, eventId, conversation.id),
    {
      userId,
      eventId,
      savedAt: new Date().toISOString(),
      value: conversation,
    } satisfies ScopedRecord<Conversation>,
  );
}

export async function loadOfflineConversation(
  userId: string,
  eventId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const record = await cacheStore.get<ScopedRecord<Conversation>>(
    scopedKey(DETAIL_PREFIX, userId, eventId, conversationId),
  );
  return valid(record, userId, eventId) && record.value.id === conversationId
    ? record.value
    : null;
}

export async function saveOfflineMessages(
  userId: string,
  eventId: string,
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  await cacheStore.set(
    scopedKey(MESSAGE_PREFIX, userId, eventId, conversationId),
    {
      userId,
      eventId,
      savedAt: new Date().toISOString(),
      value: messages,
    } satisfies ScopedRecord<ChatMessage[]>,
  );
}

export async function loadOfflineMessages(
  userId: string,
  eventId: string,
  conversationId: string,
): Promise<ChatMessage[] | null> {
  const record = await cacheStore.get<ScopedRecord<ChatMessage[]>>(
    scopedKey(MESSAGE_PREFIX, userId, eventId, conversationId),
  );
  if (!valid(record, userId, eventId) || !Array.isArray(record.value)) {
    return null;
  }
  return record.value.filter(
    (message) =>
      message.eventId === eventId && message.conversationId === conversationId,
  );
}
