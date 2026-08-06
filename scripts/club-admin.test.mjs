import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  announcementAuthorForEvent,
  canSubmitEventAnnouncement,
  clubMemberMatchesSearch,
} from '../src/lib/club-admin.ts';

const member = {
  personKey: 'account:1',
  accountId: '1',
  displayName: 'Avery Golfer',
  username: 'avery',
  avatarUrl: null,
  isClubAdmin: false,
  status: 'app_user',
  nameConflict: false,
  eventCount: 2,
  attendances: [
    {
      eventId: 'event-1',
      eventName: 'Summer Classic',
      courseName: 'Arrowhead',
      eventDate: '2026-08-06',
      lifecycleStatus: 'live',
      participantId: 'participant-1',
      claimed: true,
      isEventAdmin: false,
      inviteSentAt: null,
    },
  ],
};

test('member search covers identity and every attendance without contact fields', () => {
  assert.equal(clubMemberMatchesSearch(member, 'avery'), true);
  assert.equal(clubMemberMatchesSearch(member, 'summer'), true);
  assert.equal(clubMemberMatchesSearch(member, 'arrow'), true);
  assert.equal(clubMemberMatchesSearch(member, 'winter'), false);
  assert.equal(clubMemberMatchesSearch(member, '  '), true);
});

test('announcement attribution uses only the selected event registration', () => {
  const event = {
    id: 'event-1',
    name: 'Summer Classic',
    courseName: 'Arrowhead',
    eventDate: '2026-08-06',
    lifecycleStatus: 'live',
    registration: {
      participantId: 'participant-1',
      eventId: 'event-1',
      isAdmin: true,
    },
  };
  assert.equal(announcementAuthorForEvent(event), 'participant-1');
  assert.equal(announcementAuthorForEvent({ ...event, registration: null }), null);
});

test('announcement submission requires destination, body, connection, and idle state', () => {
  const ready = { body: 'Range opens at 7.', eventId: 'event-1', offline: false, posting: false };
  assert.equal(canSubmitEventAnnouncement(ready), true);
  assert.equal(canSubmitEventAnnouncement({ ...ready, body: '  ' }), false);
  assert.equal(canSubmitEventAnnouncement({ ...ready, eventId: '' }), false);
  assert.equal(canSubmitEventAnnouncement({ ...ready, offline: true }), false);
  assert.equal(canSubmitEventAnnouncement({ ...ready, posting: true }), false);
});

test('club and event administration stay on separate navigation levels', () => {
  const profile = readFileSync('src/app/profile.tsx', 'utf8');
  const clubAdmin = readFileSync('src/app/admin-events.tsx', 'utf8');
  const eventAdmin = readFileSync('src/app/admin.tsx', 'utf8');

  assert.match(profile, /accountAccess\?\.profile\?\.isClubAdmin/);
  assert.match(profile, /router\.push\('\/admin-events'\)/);
  assert.doesNotMatch(eventAdmin, /admin-events|MANAGE EVENTS/);
  assert.match(clubAdmin, /router\.push\(eventPath\(eventId, 'admin'\)/);
  assert.match(clubAdmin, /onManage=\{\(event\) => router\.push\(eventPath\(event\.id, 'admin'\)/);
});

test('club posting uses one selected event and the existing announcement path', () => {
  const clubAdmin = readFileSync('src/app/admin-events.tsx', 'utf8');

  assert.match(clubAdmin, /const \[selectedEventId, setSelectedEventId\] = React\.useState\(''\)/);
  assert.match(clubAdmin, /await apiPostAnnouncement\(/);
  assert.doesNotMatch(clubAdmin, /global announcement|club-wide announcement feed/i);
});

test('member directory is club-only and returns no contact or invite secrets', () => {
  const migration = readFileSync(
    'supabase/migrations/20260806000300_club_member_directory.sql',
    'utf8',
  );
  const returnShape = migration.match(/returns table \((.*?)\)\nlanguage/s)?.[1] ?? '';

  assert.match(migration, /if auth\.uid\(\) is null or not is_club_admin\(\)/);
  assert.match(migration, /revoke all on function club_member_directory\(\) from public, anon/);
  assert.doesNotMatch(returnShape, /email|invite_code/);
  assert.match(migration, /count\(distinct registration\.event_id\)/);
  assert.match(migration, /'%@invite\.blurrygolf\.app'/);
  assert.match(migration, /'%@invite\.local'/);
});
