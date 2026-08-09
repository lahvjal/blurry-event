import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  TEAM_NAME_MAX_LENGTH,
  normalizeTeamName,
  teamNameError,
} from '../src/lib/team-name.ts';

const migration = readFileSync(
  'supabase/migrations/20260809000100_member_team_rename.sql',
  'utf8',
);
const api = readFileSync('src/lib/api.ts', 'utf8');
const state = readFileSync('src/state/event.tsx', 'utf8');
const screen = readFileSync('src/app/my-team.tsx', 'utf8');

test('team names are trimmed and reject empty or oversized values', () => {
  assert.equal(normalizeTeamName('  The A Team  '), 'The A Team');
  assert.equal(teamNameError('   '), 'Enter a team name.');
  assert.equal(teamNameError('A'.repeat(TEAM_NAME_MAX_LENGTH)), null);
  assert.match(teamNameError('A'.repeat(TEAM_NAME_MAX_LENGTH + 1)) ?? '', /fewer/);
});

test('RPC authorizes only the caller membership in the exact event team', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /registration\.claimed_by = auth\.uid\(\)/);
  assert.match(migration, /membership\.team_id = scoring_team\.id/);
  assert.match(migration, /scoring_team\.id = p_team_id/);
  assert.match(migration, /scoring_team\.event_id = p_event_id/);
  assert.match(migration, /You are not a member of this event team/);
  assert.match(migration, /update teams\s+set name = cleaned_name/s);
  assert.doesNotMatch(migration, /create policy|alter policy|set (?:event_id|tee_time|starting_hole|cart|individual_exception)/i);
});

test('RPC validates server input and is granted only to authenticated accounts', () => {
  assert.match(migration, /btrim\(p_name\)/);
  assert.match(migration, /cleaned_name is null or cleaned_name = ''/);
  assert.match(migration, /char_length\(cleaned_name\) > 50/);
  assert.match(
    migration,
    /revoke all on function rename_own_scoring_team\(uuid, uuid, text\) from public, anon/,
  );
  assert.match(
    migration,
    /grant execute on function rename_own_scoring_team\(uuid, uuid, text\) to authenticated/,
  );
});

test('member rename uses the narrow RPC rather than the admin update API', () => {
  assert.match(api, /supabase\.rpc\('rename_own_scoring_team'/);
  assert.match(state, /apiRenameOwnScoringTeam\(event\.id, myTeam\.id, savedName\)/);
  assert.doesNotMatch(screen, /apiUpdateTeam|updateTeam\(/);
});

test('My Team exposes an offline-safe control only for scoring teams', () => {
  assert.match(screen, /\{myTeam \? \(\s*<View style=\{styles\.renameCard\}>/);
  assert.match(screen, /accessibilityLabel="Rename Team"/);
  assert.match(screen, /disabled=\{offline\}/);
  assert.match(screen, /Reconnect to rename your team\./);
  assert.match(screen, /<TextInput/);
});
