import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRefreshOnPull } from '@/components/pull-to-refresh';
import {
  editMessageBody,
  fetchConversation,
  fetchConversationSummaries,
  fetchMessages,
  markConversationRead,
  sendMessage,
  subscribeToMessageReactions,
  subscribeToMessages,
  toggleMessageReaction,
  unsendMessage,
} from '@/lib/chat';
import {
  loadOfflineConversation,
  loadOfflineAccountConversation,
  loadOfflineAccountMessages,
  loadOfflineConversationSummaries,
  loadOfflineClubConversationSummaries,
  loadOfflineMessages,
  saveOfflineConversation,
  saveOfflineAccountConversation,
  saveOfflineAccountMessages,
  saveOfflineConversationSummaries,
  saveOfflineClubConversationSummaries,
  saveOfflineMessages,
} from '@/lib/offline/chat-cache';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { loadMessageOverlays, subscribeToSync } from '@/lib/sync';
import { refreshUnread, setUnreadTotal } from '@/state/unread';
import { useEvent } from '@/state/event';
import {
  ChatMessage,
  ChatMessageMediaDraft,
  ChatMessageReaction,
  Conversation,
  ConversationSummary,
  Participant,
} from '@/state/types';

/**
 * Chat state for the screens. A thread keeps its own message list rather than
 * living in EventProvider: only one is on screen at a time, and each needs its
 * own realtime subscription.
 */

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Something went wrong.';
}

export function useConversations() {
  const { accountAccess } = useEvent();
  const accountId = accountAccess?.accountId ?? null;
  const browserOffline = useBrowserDefinitelyOffline();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const registeredEvents = useMemo(
    () => accountAccess?.events.filter((item) => item.registration) ?? [],
    [accountAccess],
  );
  const registeredEventIds = useMemo(
    () => registeredEvents.map((item) => item.id),
    [registeredEvents],
  );
  const registeredEventKey = registeredEventIds.join(':');

  const loadCached = useCallback(async (): Promise<ConversationSummary[] | null> => {
    if (!accountId) return null;
    const club = await loadOfflineClubConversationSummaries(accountId);
    if (club) return club;

    // Upgrade path for installs that only have the old per-event inbox caches.
    // Actor names may be absent until the next online refresh, but every thread
    // remains visible and opens against its exact event snapshot.
    const legacy = await Promise.all(
      registeredEvents.map(async (item) => {
        const rows = await loadOfflineConversationSummaries(accountId, item.id);
        return (rows ?? []).map((row) => ({
          ...row,
          eventId: row.eventId ?? item.id,
          eventName: row.eventName ?? item.name,
          myParticipantId:
            row.myParticipantId ?? item.registration?.participantId ?? '',
          directParticipantId: row.directParticipantId ?? null,
          directParticipantName: row.directParticipantName ?? null,
          directParticipantAvatarUrl: row.directParticipantAvatarUrl ?? null,
          lastSenderName: row.lastSenderName ?? null,
          lastReactorName: row.lastReactorName ?? null,
        }));
      }),
    );
    const combined = legacy.flat().sort((a, b) =>
      (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
    );
    return combined.length > 0 ? combined : null;
  }, [accountId, registeredEventKey, registeredEvents]);

  const reload = useCallback(async () => {
    try {
      if (browserOffline) {
        const cached = await loadCached();
        if (!cached) {
          throw new Error('Messages were not included in offline setup.');
        }
        setConversations(cached);
        setUnreadTotal(
          accountId,
          cached.reduce((total, c) => total + c.unreadCount, 0),
        );
        setError(null);
        return;
      }
      const summaries = await fetchConversationSummaries();
      if (accountId) {
        await Promise.all([
          saveOfflineClubConversationSummaries(accountId, summaries),
          ...registeredEvents.map((item) =>
            saveOfflineConversationSummaries(
              accountId,
              item.id,
              summaries.filter((summary) => summary.eventId === item.id),
            ),
          ),
        ]);
      }
      setConversations(summaries);
      // Loading the inbox already computed the count, so hand it straight to
      // the shared store rather than making it go and ask again.
      setUnreadTotal(
        accountId,
        summaries.reduce((total, c) => total + c.unreadCount, 0),
      );
      setError(null);
    } catch (caught) {
      const cached = await loadCached().catch(() => null);
      if (cached) {
        setConversations(cached);
        setUnreadTotal(
          accountId,
          cached.reduce((total, c) => total + c.unreadCount, 0),
        );
        setError(null);
      } else {
        setError(errorText(caught));
      }
    } finally {
      setLoading(false);
    }
  }, [
    accountId,
    browserOffline,
    loadCached,
    registeredEventKey,
    registeredEvents,
  ]);

  // Refetch on focus so a thread started elsewhere — or one someone else added
  // you to — appears without a restart.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useRefreshOnPull(reload);

  // Any incoming message restacks the list and lights an unread badge.
  useEffect(() => {
    if (browserOffline) return;
    const stops = [
      subscribeToMessages(null, null, () => void reload()),
      subscribeToMessageReactions(null, () => void reload()),
    ];
    return () => stops.forEach((stop) => stop());
  }, [browserOffline, registeredEventIds, registeredEventKey, reload]);

  return { conversations, loading, error, reload };
}

/** The conversation behind a thread header or the group settings screen. */
export function useConversationDetail(conversationId: string | null) {
  const { event, accountAccess } = useEvent();
  const accountId = accountAccess?.accountId ?? null;
  const browserOffline = useBrowserDefinitelyOffline();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conversationId) {
      setConversation(null);
      setLoading(false);
      return;
    }
    try {
      if (browserOffline) {
        const cached = accountId
          ? (await loadOfflineAccountConversation(accountId, conversationId)) ??
            (await loadOfflineConversation(accountId, event.id, conversationId))
          : null;
        if (!cached) {
          throw new Error('This conversation was not included in offline setup.');
        }
        setConversation(cached);
        setError(null);
        return;
      }
      const next = await fetchConversation(conversationId);
      setConversation(next);
      if (accountId && next) {
        await Promise.all([
          saveOfflineAccountConversation(accountId, next),
          saveOfflineConversation(accountId, event.id, next),
        ]);
      }
      setError(null);
    } catch (caught) {
      const cached = accountId
        ? (await loadOfflineAccountConversation(accountId, conversationId).catch(
            () => null,
          )) ??
          (await loadOfflineConversation(
            accountId,
            event.id,
            conversationId,
          ).catch(() => null))
        : null;
      if (cached) {
        setConversation(cached);
        setError(null);
      } else {
        setError(errorText(caught));
      }
    } finally {
      setLoading(false);
    }
  }, [accountId, browserOffline, conversationId, event.id]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useRefreshOnPull(reload);

  return { conversation, loading, error, reload };
}

export function useConversation(
  conversationId: string | null,
  originEventId?: string | null,
) {
  const { event, me, accountAccess } = useEvent();
  const accountId = accountAccess?.accountId ?? null;
  const browserOffline = useBrowserDefinitelyOffline();
  const chatEventId = originEventId ?? event.id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingOlderRef = useRef(false);

  const reload = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      if (browserOffline) {
        const [cached, overlays] = await Promise.all([
          accountId
            ? loadOfflineAccountMessages(accountId, conversationId).then(
                async (accountCached) =>
                  accountCached ??
                  loadOfflineMessages(accountId, chatEventId, conversationId),
              )
            : Promise.resolve(null),
          accountId
            ? loadMessageOverlays({
                userId: accountId,
                eventId: chatEventId,
                conversationId,
              })
            : Promise.resolve([]),
        ]);
        if (!cached && overlays.length === 0) {
          throw new Error('This conversation was not included in offline setup.');
        }
        setMessages(overlays.reduce(mergeMessage, cached ?? []));
        setHasOlder(false);
        setError(null);
        return;
      }
      const page = await fetchMessages(conversationId);
      const overlays = accountId
        ? await loadMessageOverlays({
            userId: accountId,
            eventId: chatEventId,
            conversationId,
            authoritativeMessages: page.messages,
          })
        : [];
      const merged = overlays.reduce(mergeMessage, page.messages);
      setMessages(merged);
      setHasOlder(page.hasOlder);
      if (accountId) {
        await Promise.all([
          saveOfflineAccountMessages(accountId, conversationId, merged),
          saveOfflineMessages(accountId, chatEventId, conversationId, merged),
        ]);
      }
      setError(null);
    } catch (caught) {
      const cached = accountId
        ? (await loadOfflineAccountMessages(accountId, conversationId).catch(
            () => null,
          )) ??
          (await loadOfflineMessages(accountId, chatEventId, conversationId).catch(
            () => null,
          ))
        : null;
      const overlays = accountId
        ? await loadMessageOverlays({
            userId: accountId,
            eventId: chatEventId,
            conversationId,
          }).catch(() => [])
        : [];
      if (cached || overlays.length > 0) {
        setMessages(overlays.reduce(mergeMessage, cached ?? []));
        setHasOlder(false);
        setError(null);
      } else {
        setError(errorText(caught));
      }
    } finally {
      setLoading(false);
    }
  }, [accountId, browserOffline, chatEventId, conversationId]);

  useEffect(() => {
    if (!accountId || !conversationId || loading) return;
    void Promise.all([
      saveOfflineAccountMessages(accountId, conversationId, messages),
      saveOfflineMessages(accountId, chatEventId, conversationId, messages),
    ]);
  }, [accountId, chatEventId, conversationId, loading, messages]);

  // Queue state can change without a Realtime event (for example, a permanent
  // rejection or an acknowledgement whose response arrives before the message
  // page refreshes). Keep each optimistic bubble's queued/sent/failed label in
  // step with IndexedDB.
  useEffect(() => {
    if (!accountId || !conversationId) return;
    let disposed = false;
    let revision = 0;

    const refreshDelivery = async () => {
      const currentRevision = ++revision;
      const overlays = await loadMessageOverlays({
        userId: accountId,
        eventId: chatEventId,
        conversationId,
      }).catch(() => []);
      if (disposed || currentRevision !== revision || overlays.length === 0) return;
      setMessages((current) => overlays.reduce(mergeMessage, current));
    };

    const unsubscribe = subscribeToSync(() => void refreshDelivery());
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [accountId, chatEventId, conversationId]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setHasOlder(false);
    void reload();
  }, [reload]);
  useRefreshOnPull(reload);

  useEffect(() => {
    if (!conversationId || browserOffline) return;
    return subscribeToMessages(null, conversationId, (change) =>
      setMessages((prev) => {
        if (change.event === 'DELETE') {
          return prev.filter((message) => message.id !== change.messageId);
        }
        // An edit to an unloaded historical message should not pull that one
        // row into the recent window without its surrounding page.
        if (
          change.event === 'UPDATE' &&
          !prev.some((message) => message.id === change.messageId)
        ) {
          return prev;
        }
        return mergeMessage(prev, change.message);
      }),
    );
  }, [browserOffline, conversationId]);

  useEffect(() => {
    if (!conversationId || browserOffline) return;
    return subscribeToMessageReactions(null, (change) =>
      setMessages((prev) =>
        mergeReaction(prev, change.messageId, change.reaction, change.event),
      ),
    );
  }, [browserOffline, conversationId]);

  const reactionCount = messages.reduce(
    (total, message) => total + message.reactions.length,
    0,
  );

  // Clear the badge on open, and again as messages or reactions arrive while
  // the conversation is visible.
  useEffect(() => {
    if (
      browserOffline ||
      !conversationId ||
      messages.length === 0 ||
      (!accountId && !me.claimed)
    ) {
      return;
    }
    void markConversationRead(conversationId, me.id)
      // Reading here is often the whole reason the badges were showing.
      .then(() => refreshUnread())
      .catch(() => {
        // A stale badge isn't worth interrupting anyone over.
      });
  }, [
    conversationId,
    accountId,
    me.claimed,
    me.id,
    messages.length,
    reactionCount,
    chatEventId,
    browserOffline,
  ]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (
      !conversationId ||
      !oldest ||
      !hasOlder ||
      loadingOlderRef.current
    ) {
      return;
    }

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(conversationId, {
        createdAt: oldest.createdAt,
      });
      setMessages((current) => mergeMessagePages(page.messages, current));
      setHasOlder(page.hasOlder);
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, hasOlder, messages]);

  const send = useCallback(
    async (
      body: string,
      replyToId?: string | null,
      attachment?: ChatMessageMediaDraft | null,
    ): Promise<boolean> => {
      const text = body.trim();
      if (!conversationId || (!text && !attachment)) return false;
      try {
        const sent = await sendMessage({
          eventId: chatEventId,
          conversationId,
          senderId: accountId ?? me.id,
          body: text,
          replyToId: replyToId ?? null,
          attachment: attachment ?? null,
        });
        setMessages((prev) => mergeMessage(prev, sent));
        setError(null);
        return true;
      } catch (caught) {
        setError(errorText(caught));
        throw caught;
      }
    },
    [accountId, chatEventId, conversationId, me.id],
  );

  const edit = useCallback(
    async (messageId: string, body: string) => {
      const text = body.trim();
      const message = messages.find((candidate) => candidate.id === messageId);
      if (
        !message ||
        ![accountId, me.id].filter(Boolean).includes(message.senderId) ||
        message.pending ||
        message.id.startsWith('local-') ||
        !text
      ) {
        return;
      }

      const editedAt = new Date().toISOString();
      setMessages((prev) =>
        prev.map((candidate) =>
          candidate.id === messageId
            ? { ...candidate, body: text, editedAt }
            : candidate,
        ),
      );

      try {
        await editMessageBody(chatEventId, messageId, text);
        setError(null);
      } catch (caught) {
        setError(errorText(caught));
        void reload();
      }
    },
    [accountId, chatEventId, me.id, messages, reload],
  );

  const unsend = useCallback(
    async (messageId: string) => {
      const message = messages.find((candidate) => candidate.id === messageId);
      if (
        !message ||
        ![accountId, me.id].filter(Boolean).includes(message.senderId) ||
        message.pending ||
        message.id.startsWith('local-')
      ) {
        return;
      }

      setMessages((prev) =>
        prev.filter((candidate) => candidate.id !== messageId),
      );

      try {
        await unsendMessage(chatEventId, messageId);
        setError(null);
      } catch (caught) {
        setError(errorText(caught));
        void reload();
      }
    },
    [accountId, chatEventId, me.id, messages, reload],
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      const cleaned = emoji.trim();
      const message = messages.find((candidate) => candidate.id === messageId);
      if (
        !message ||
        message.pending ||
        message.id.startsWith('local-') ||
        !cleaned
      ) {
        return;
      }

      const reaction: ChatMessageReaction = {
        participantId: accountId ?? me.id,
        emoji: cleaned,
      };
      const remove = message.reactions.some(
        (item) =>
          item.participantId === reaction.participantId &&
          item.emoji === reaction.emoji,
      );

      setMessages((prev) =>
        mergeReaction(
          prev,
          messageId,
          reaction,
          remove ? 'DELETE' : 'INSERT',
        ),
      );

      try {
        await toggleMessageReaction({
          eventId: chatEventId,
          messageId,
          participantId: accountId ?? me.id,
          emoji: cleaned,
          remove,
        });
        setError(null);
      } catch (caught) {
        setError(errorText(caught));
        // The server remains authoritative if the optimistic change failed.
        void reload();
      }
    },
    [accountId, chatEventId, me.id, messages, reload],
  );

  return {
    messages,
    loading,
    loadingOlder,
    hasOlder,
    error,
    send,
    react,
    edit,
    unsend,
    loadOlder,
    reload,
  };
}

/**
 * Replaces the matching message rather than appending, so the stored row that
 * arrives over realtime takes the place of its optimistic bubble.
 */
function mergeMessage(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const at = list.findIndex((m) => m.clientId === incoming.clientId);
  if (at !== -1) {
    const next = [...list];
    next[at] = {
      ...incoming,
      reactions:
        incoming.reactions.length > 0
          ? incoming.reactions
          : list[at].reactions,
    };
    return next;
  }
  return [...list, incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function mergeMessagePages(
  older: ChatMessage[],
  current: ChatMessage[],
): ChatMessage[] {
  const known = new Set(current.map((message) => message.clientId));
  return [
    ...older.filter((message) => !known.has(message.clientId)),
    ...current,
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function mergeReaction(
  list: ChatMessage[],
  messageId: string,
  reaction: ChatMessageReaction,
  event: 'INSERT' | 'DELETE',
): ChatMessage[] {
  return list.map((message) => {
    if (message.id !== messageId) return message;

    const matches = (item: ChatMessageReaction) =>
      item.participantId === reaction.participantId &&
      item.emoji === reaction.emoji;
    const exists = message.reactions.some(matches);

    if (event === 'INSERT') {
      if (exists) return message;
      return { ...message, reactions: [...message.reactions, reaction] };
    }
    if (!exists) return message;
    return {
      ...message,
      reactions: message.reactions.filter((item) => !matches(item)),
    };
  });
}

// --- Display helpers --------------------------------------------------------

/** A run of consecutive messages from one sender, as a thread renders them. */
export type MessageRun = {
  key: string;
  senderId: string;
  /** Set when this run opens a new day and needs a separator above it. */
  dayLabel: string | null;
  messages: ChatMessage[];
};

export function groupThread(messages: ChatMessage[]): MessageRun[] {
  const runs: MessageRun[] = [];
  let lastDay = '';

  messages.forEach((message) => {
    const day = new Date(message.createdAt).toDateString();
    const startsDay = day !== lastDay;
    const current = runs[runs.length - 1];

    if (!startsDay && current && current.senderId === message.senderId) {
      current.messages.push(message);
      return;
    }

    runs.push({
      key: message.clientId,
      senderId: message.senderId,
      dayLabel: startsDay ? formatDayLabel(message.createdAt) : null,
      messages: [message],
    });
    lastDay = day;
  });

  return runs;
}

/** Calendar days between then and now, ignoring time of day. */
function daysAgo(iso: string): number {
  const then = new Date(iso);
  const now = new Date();
  const thenMidnight = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((todayMidnight.getTime() - thenMidnight.getTime()) / 86_400_000);
}

/** Separator inside a thread: TODAY, YESTERDAY, then the date. */
export function formatDayLabel(iso: string): string {
  const days = daysAgo(iso);
  if (days <= 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  return new Date(iso)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase();
}

/** Inbox right-hand column: clock time today, then YEST, a weekday, or a date. */
export function formatInboxTime(iso: string | null): string {
  if (!iso) return '';
  const days = daysAgo(iso);
  if (days <= 0) {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  if (days === 1) return 'YEST';
  if (days < 7) {
    return new Date(iso)
      .toLocaleDateString(undefined, { weekday: 'short' })
      .toUpperCase();
  }
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
  });
}

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * What to call a conversation. Groups carry a name; a direct thread is titled
 * after the other person, so it reads correctly from both sides.
 */
export function conversationTitle(
  conversation: Conversation,
  myId: string,
  participantById: (id: string) => Participant | undefined,
  eventGroupFallback: string,
): string {
  if (conversation.kind === 'direct') {
    const other = conversation.memberIds.find((id) => id !== myId);
    return (other && participantById(other)?.fullName) || 'Direct message';
  }
  return conversation.name?.trim() || eventGroupFallback;
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
