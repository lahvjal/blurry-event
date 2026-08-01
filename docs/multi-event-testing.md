# Multi-event PWA test setup

The repository does not create a second real event automatically. Migrations
`0022_multi_event_access.sql` and `0023_multi_event_rpcs.sql` must first be
applied to a local, preview, or staging Supabase project. Redeploy
`supabase/functions/send-push` after the migrations so notification links use
the event-scoped routes.

The migration deliberately does not promote existing event admins to club
admins. Existing Invitational admins keep their event-level rights. A trusted
database/service-role operator must explicitly set `profiles.is_club_admin`
for the small number of people who should administer every club event; the PWA
cannot self-promote an account because a database trigger rejects that update.

## Create the disposable fixture

1. In the non-production Supabase Auth dashboard, create two email/password
   users. Use accounts that are not club admins and that have no existing event
   registrations.
2. Run the guarded fixture with the test database connection string:

   ```sh
   psql "$TEST_DATABASE_URL" \
     -v confirm_non_production=true \
     -v user_a_email='multi-a@example.test' \
     -v user_b_email='multi-b@example.test' \
     -f supabase/testing/seed-multi-event.sql
   ```

   Account A is registered for the existing Invitational and the deterministic
   `[TEST] Multi Event Preview`. Account B is registered only for the test
   event. Re-running the fixture is safe. The script refuses to run unless the
   non-production confirmation flag is supplied.
3. Run the read-only RLS checks. Every result must be `true`:

   ```sh
   psql "$TEST_DATABASE_URL" \
     -v user_a_email='multi-a@example.test' \
     -v user_b_email='multi-b@example.test' \
     -f supabase/testing/verify-multi-event-isolation.sql
   ```

## PWA acceptance pass

Build or run the web app against that non-production project.

1. Sign in as Account A. `/events` must show both cards. Open each card and
   confirm the URL is `/events/<event-id>/event`, the title/course/roster change,
   and messages, notifications, leaderboard, teams, and admin pages stay in the
   chosen event.
2. Paste a scoped URL into a fresh tab and reload it. The same event must load.
   Browser back/forward and edge-swipe navigation must not switch the focused
   event.
3. Open a legacy URL such as `/event` while Account A is signed in. Because the
   account has multiple events, it must go to `/events` instead of guessing.
4. Sign in as Account B. `/events` must immediately redirect to its sole test
   event. A pasted Invitational scoped URL must return to `/events` and must not
   display Invitational data.
5. For offline isolation, open both events once as Account A. In browser dev
   tools, switch to Offline and reload each scoped URL; only that exact cached
   event should appear. Queue a score while offline, switch events, and confirm
   the pending count does not follow. Reconnect and confirm it syncs only when
   its original account/event is focused.
6. Sign out while offline and sign in as Account B. Account A's snapshots and
   queued writes must not appear or replay. Legacy unscoped queue rows, if any,
   remain inert by design.
7. With push configured, send a test announcement and chat message. Tapping each
   notification must open `/events/<event-id>/...` for its source event.

Current single-event users need no fixture: after the migrations, `/events` and
legacy `/event` links both replace to the same Invitational event screen, with
no selector shown.
