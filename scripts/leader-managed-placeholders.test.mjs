import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260810031043_leader_managed_placeholders.sql',
  'utf8',
);
const api = readFileSync('src/lib/api.ts', 'utf8');
const state = readFileSync('src/state/event.tsx', 'utf8');
const myTeam = readFileSync('src/app/my-team.tsx', 'utf8');
const adminTeams = readFileSync('src/app/admin-teams.tsx', 'utf8');
const adminRoster = readFileSync('src/app/admin-roster.tsx', 'utf8');
const sender = readFileSync('supabase/functions/send-invite/index.ts', 'utf8');
const accessMigration = readFileSync(
  'supabase/migrations/20260801000100_multi_event_access.sql',
  'utf8',
);
const schedulingMigration = readFileSync(
  'supabase/migrations/20260806000400_playing_group_scheduling.sql',
  'utf8',
);

test('team leadership is explicit, admin-assigned, and membership constrained', () => {
  assert.match(migration, /add column if not exists leader_participant_id uuid/);
  assert.match(migration, /foreign key \(leader_participant_id\)[\s\S]*references public\.participants\(id\)/);
  assert.match(migration, /teams_validate_leader_membership/);
  assert.match(migration, /membership\.team_id = new\.id/);
  assert.match(migration, /leader\.event_id = new\.event_id/);
  assert.match(migration, /not public\.is_event_admin\(p_event_id\)/);
  assert.match(migration, /Choose a leader from this scoring team/);
  assert.match(adminTeams, /setTeamLeader\(team\.id, member\.id\)/);
  assert.match(adminTeams, /Score entry remains shared by every claimed teammate/);
});

test('leader identity edits are limited to delegated unclaimed teammates on the same team', () => {
  const helper = migration.match(
    /create or replace function private\.managed_teammate_team[\s\S]*?\$\$;/,
  )?.[0] ?? '';
  const editRpc = migration.match(
    /create or replace function private\.update_leader_managed_teammate[\s\S]*?\$\$;/,
  )?.[0] ?? '';

  assert.match(helper, /target_membership\.participant_id = p_target_participant_id/);
  assert.match(helper, /leader\.claimed_by = p_actor_account_id/);
  assert.match(helper, /target\.claimed_by is null/);
  assert.match(helper, /target\.leader_managed/);
  assert.match(
    accessMigration,
    /create policy "account updates own registration"[\s\S]*using \(claimed_by = auth\.uid\(\)\)/,
  );
  assert.match(editRpc, /for update/);
  assert.match(editRpc, /target\.identity_version is distinct from p_expected_version/);
  assert.match(editRpc, /Only the assigned team leader can edit an unclaimed teammate on their team/);
  assert.match(editRpc, /set full_name = cleaned_name,[\s\S]*auth_email = next_email/);
  const participantUpdate = editRpc.match(
    /update public\.participants participant[\s\S]*?returning participant\.\* into target/,
  )?.[0] ?? '';
  assert.doesNotMatch(
    participantUpdate,
    /\b(?:claimed_by|is_admin|handicap|event_id|username)\s*=/i,
  );
  assert.doesNotMatch(editRpc, /lifecycle_status|published|draft/);
});

test('email changes rotate and bind invites but never send automatically', () => {
  assert.match(migration, /next_code := 'BI-' \|\| upper/);
  assert.match(migration, /invite_sent_at = case when email_changed then null/);
  assert.match(migration, /when normalized_email is null then false[\s\S]*else true/);
  assert.match(migration, /claim_email_bound = case/);
  assert.match(migration, /actor_email is distinct from lower\(target\.auth_email\)/);
  assert.match(migration, /participant\.invite_enabled/);
  assert.match(migration, /alter column invite_enabled set default false/);
  assert.match(api, /invite_enabled: email !== null/);
  assert.match(api, /claim_email_bound: email !== null/);
  assert.match(state, /const lifecycleNeedsBinding/);
  assert.match(state, /inviteSentAt: null/);
  assert.match(state, /claimEmailBound: nextRealEmail !== null/);
  assert.match(adminRoster, /p\.inviteEnabled && !isSyntheticEmail\(p\.authEmail\)/);
  assert.match(adminRoster, /Adding an email prepares — but does not send — an invitation/);

  const saveAction = myTeam.match(
    /const saveTeammate = async \(\) => \{[\s\S]*?\n  \};/,
  )?.[0] ?? '';
  const sendAction = myTeam.match(
    /const sendManagedInvite = async \(participantId: string\) => \{[\s\S]*?\n  \};/,
  )?.[0] ?? '';
  assert.match(saveAction, /await updateManagedTeammate/);
  assert.doesNotMatch(saveAction, /sendInviteEmails/);
  assert.match(sendAction, /sendInviteEmails\(\[participantId\]\)/);
  assert.match(myTeam, /Saving updates the roster only\. It never sends an invitation\./);
  assert.match(myTeam, /SEND INVITE/);
});

test('invite delivery authorizes either event admin or the exact assigned leader', () => {
  const payloadRpc = migration.match(
    /create function public\.invite_payloads[\s\S]*?\$\$;/,
  )?.[0] ?? '';
  assert.match(payloadRpc, /public\.is_event_admin\(participant\.event_id\)/);
  assert.match(payloadRpc, /private\.managed_teammate_team\(participant\.id, auth\.uid\(\)\)/);
  assert.match(payloadRpc, /participant\.claim_email_bound/);
  assert.match(payloadRpc, /participant\.invite_enabled/);
  const markRpc = migration.match(
    /create or replace function public\.mark_invites_sent[\s\S]*?\$\$;/,
  )?.[0] ?? '';
  assert.match(markRpc, /participant\.invite_enabled/);
  assert.match(markRpc, /private\.managed_teammate_team\(participant\.id, auth\.uid\(\)\)/);
  assert.match(sender, /event_id: string/);
  assert.match(sender, /const eventsById = new Map/);
  assert.match(sender, /eventsById\.get\(p\.event_id\)/);
  assert.match(sender, /caller\.rpc\('mark_invites_sent'/);
});

test('leader operations are online-only while cached team details and scoring stay available', () => {
  assert.match(myTeam, /disabled=\{offline\}/);
  assert.match(myTeam, /Roster edits and invitations require a connection/);
  assert.match(myTeam, /label=\{myTeam \? 'OPEN TEAM SCORECARD' : 'OPEN MY SCORECARD'\}/);
  assert.match(myTeam, /myTeam\?\.leaderParticipantId === me\.id/);
  assert.match(myTeam, /!member\.claimed && member\.leaderManaged/);
  assert.match(api, /supabase\.rpc\('update_leader_managed_teammate'/);
  assert.match(state, /apiSetTeamLeader\(event\.id, teamId, participantId\)/);
});

test('the feature migration does not narrow existing shared scramble score authority', () => {
  assert.doesNotMatch(migration, /create or replace function (?:public\.)?can_write_round/);
  assert.doesNotMatch(migration, /create or replace function (?:public\.)?submit_offline_score/);
  assert.match(
    accessMigration,
    /membership\.participant_id = event_participant_id\(round\.event_id\)/,
  );
  assert.match(
    schedulingMigration,
    /Only a teammate or event admin can score this round/,
  );
  assert.match(
    schedulingMigration,
    /membership\.participant_id = registration_id/,
  );
});

test('security-definer cores are private and public RPC wrappers stay narrow', () => {
  assert.match(migration, /create schema if not exists private/);
  assert.match(migration, /security definer\nset search_path = ''/);
  assert.match(migration, /security invoker\nset search_path = ''/);
  assert.match(
    migration,
    /revoke all on function public\.update_leader_managed_teammate[\s\S]*from public, anon/,
  );
  assert.match(
    migration,
    /grant execute on function public\.update_leader_managed_teammate[\s\S]*to authenticated/,
  );
  assert.match(migration, /private\.team_management_audit/);
  assert.doesNotMatch(migration, /grant .*team_management_audit.*authenticated/i);
});
