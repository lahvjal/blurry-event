import type { ConversationSummary } from '@/state/types';

/** Inbox copy is self-contained because a row may originate in an event whose
 * roster is not currently loaded. */
export function conversationSummaryTitle(
  conversation: ConversationSummary,
): string {
  if (conversation.kind === 'direct') {
    return conversation.directParticipantName?.trim() || 'Direct message';
  }
  return conversation.name?.trim() || conversation.eventName;
}

export function conversationSummaryPreview(
  conversation: ConversationSummary,
): string {
  if (
    conversation.lastActivityKind === 'reaction' &&
    conversation.lastReactionEmoji
  ) {
    const reactor = conversation.lastReactorName?.split(' ')[0] || 'Someone';
    const message = conversation.lastReactionMessageBody?.trim();
    const media =
      conversation.lastReactionMessageMediaMimeType === 'image/gif'
        ? 'GIF'
        : conversation.lastReactionMessageMediaMimeType
          ? 'photo'
          : null;
    return `${reactor} reacted ${conversation.lastReactionEmoji}${
      message ? ` to “${message}”` : media ? ` to a ${media}` : ''
    }`;
  }

  const message =
    conversation.lastMessageBody?.trim() ||
    (conversation.lastMessageMediaMimeType === 'image/gif'
      ? 'GIF'
      : conversation.lastMessageMediaMimeType
        ? 'Photo'
        : null);
  if (!message) return 'No messages yet.';
  if (conversation.kind === 'direct') return message;

  if (!conversation.lastSenderId) return message;
  const sender =
    conversation.lastSenderId === conversation.myParticipantId
      ? 'You'
      : conversation.lastSenderName?.split(' ')[0] || 'Someone';
  return `${sender}: ${message}`;
}
