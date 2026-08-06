import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conversationSummaryPreview,
  conversationSummaryTitle,
} from '../src/lib/conversation-summary.ts';

const summary = (overrides = {}) => ({
  id: 'conversation-a',
  eventId: 'event-a',
  eventName: 'Summer Classic',
  kind: 'group',
  name: 'Clubhouse',
  createdBy: 'participant-a',
  myParticipantId: 'participant-a',
  memberIds: ['participant-a', 'participant-b'],
  directParticipantId: null,
  directParticipantName: null,
  directParticipantAvatarUrl: null,
  lastMessageBody: 'Meet on the first tee',
  lastMessageAt: '2026-08-06T12:00:00.000Z',
  lastSenderId: 'participant-b',
  lastSenderName: 'Jordan Reed',
  lastMessageMediaMimeType: null,
  lastActivityAt: '2026-08-06T12:00:00.000Z',
  lastActivityKind: 'message',
  lastReactionEmoji: null,
  lastReactorId: null,
  lastReactorName: null,
  lastReactionMessageBody: null,
  lastReactionMessageMediaMimeType: null,
  unreadCount: 1,
  ...overrides,
});

test('a cross-event direct row titles itself without the focused roster', () => {
  const conversation = summary({
    eventId: 'event-b',
    eventName: 'Fall Cup',
    kind: 'direct',
    name: null,
    myParticipantId: 'fall-me',
    memberIds: ['fall-me', 'fall-jordan'],
    directParticipantId: 'fall-jordan',
    directParticipantName: 'Jordan Reed',
  });

  assert.equal(conversationSummaryTitle(conversation), 'Jordan Reed');
  assert.equal(conversationSummaryPreview(conversation), 'Meet on the first tee');
});

test('group previews compare against the origin-event participant identity', () => {
  assert.equal(
    conversationSummaryPreview(
      summary({ lastSenderId: 'participant-a', lastSenderName: 'Vel Monroe' }),
    ),
    'You: Meet on the first tee',
  );
  assert.equal(conversationSummaryPreview(summary()), 'Jordan: Meet on the first tee');
});

test('event chat uses its origin as a title and reaction actor metadata', () => {
  const conversation = summary({
    kind: 'event_group',
    name: null,
    lastActivityKind: 'reaction',
    lastReactionEmoji: '👍',
    lastReactorId: 'participant-b',
    lastReactorName: 'Jordan Reed',
    lastReactionMessageBody: 'Meet on the first tee',
  });

  assert.equal(conversationSummaryTitle(conversation), 'Summer Classic');
  assert.equal(
    conversationSummaryPreview(conversation),
    'Jordan reacted 👍 to “Meet on the first tee”',
  );
});
