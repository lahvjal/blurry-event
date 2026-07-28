import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import {
  fetchConversation,
  fetchConversationSummaries,
  fetchMessages,
  markConversationRead,
  sendMessage,
  subscribeToMessages,
} from '@/lib/chat';
import { refreshUnread, setUnreadTotal } from '@/state/unread';
import { supabase } from '@/lib/supabase';
import { useEvent } from '@/state/event';
import {
  ChatMessage,
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

/** Chat needs a real signed-in participant; the seeded preview has neither. */
async function signedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}


export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      if (!(await signedIn())) {
        setConversations([]);
        setError(null);
        return;
      }
      const summaries = await fetchConversationSummaries();
      setConversations(summaries);
      // Loading the inbox already computed the count, so hand it straight to
      // the shared store rather than making it go and ask again.
      setUnreadTotal(summaries.reduce((total, c) => total + c.unreadCount, 0));
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch on focus so a thread started elsewhere — or one someone else added
  // you to — appears without a restart.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Any incoming message restacks the list and lights an unread badge.
  useEffect(() => subscribeToMessages(null, () => void reload()), [reload]);

  return { conversations, loading, error, reload };
}

/** The conversation behind a thread header or the group settings screen. */
export function useConversationDetail(conversationId: string | null) {
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
      setConversation(await fetchConversation(conversationId));
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { conversation, loading, error, reload };
}

export function useConversation(conversationId: string | null) {
  const { me } = useEvent();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      setMessages(await fetchMessages(conversationId));
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeToMessages(conversationId, (incoming) =>
      setMessages((prev) => mergeMessage(prev, incoming)),
    );
  }, [conversationId]);

  // Clear the badge on open, and again as messages arrive while it's open.
  useEffect(() => {
    if (!conversationId || messages.length === 0 || !me.claimed) return;
    void markConversationRead(conversationId, me.id)
      // Reading here is often the whole reason the badges were showing.
      .then(refreshUnread)
      .catch(() => {
        // A stale badge isn't worth interrupting anyone over.
      });
  }, [conversationId, me.claimed, me.id, messages.length]);

  const send = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!conversationId || !text) return;
      try {
        const sent = await sendMessage({
          conversationId,
          senderId: me.id,
          body: text,
        });
        setMessages((prev) => mergeMessage(prev, sent));
        setError(null);
      } catch (caught) {
        setError(errorText(caught));
      }
    },
    [conversationId, me.id],
  );

  return { messages, loading, error, send, reload };
}

/**
 * Replaces the matching message rather than appending, so the stored row that
 * arrives over realtime takes the place of its optimistic bubble.
 */
function mergeMessage(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const at = list.findIndex((m) => m.clientId === incoming.clientId);
  if (at !== -1) {
    const next = [...list];
    next[at] = incoming;
    return next;
  }
  return [...list, incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
