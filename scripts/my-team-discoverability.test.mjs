import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const eventHome = readFileSync('src/app/event.tsx', 'utf8');
const myTeamPage = readFileSync('src/app/my-team.tsx', 'utf8');

test('registered players always receive an event-scoped My Team destination', () => {
  assert.match(
    eventHome,
    /accessibleEvent\.registration\?\.participantId === me\.id/,
  );
  assert.match(eventHome, /<SectionLabel>my team<\/SectionLabel>/);
  assert.match(eventHome, /eventPath\(event\.id, 'my-team'\)/);
  assert.match(
    eventHome,
    /\{isRegisteredPlayer \? \([\s\S]*?<SectionLabel>my team<\/SectionLabel>[\s\S]*?\) : null\}\s*\{roundStarted \? \(/,
  );
});

test('the persistent destination explains assigned and pending scoring identities', () => {
  assert.match(eventHome, /ONE-PLAYER SCORING TEAM/);
  assert.match(eventHome, /PLAYING GROUP · INDIVIDUAL SCORECARD/);
  assert.match(
    eventHome,
    /No scoring team or playing group has been assigned yet\./,
  );
  assert.match(
    eventHome,
    /No playing group has been assigned yet\. Your scorecard remains individual\./,
  );
});

test('the My Team empty state distinguishes scramble and solo registrations', () => {
  assert.match(myTeamPage, /No team or playing group yet/);
  assert.match(myTeamPage, /assign your scoring team and four-player start slot/);
  assert.match(myTeamPage, /Your scorecard will remain individual/);
});
