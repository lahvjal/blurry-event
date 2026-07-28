-- Web Push: per-device subscriptions, and the triggers that fan a new row out
-- to everyone who should hear about it.
--
-- The database only *dispatches*. It posts the id of the row that changed to an
-- edge function, which resolves recipients and does the actual sending. Two
-- reasons for the split: signing a Web Push payload needs the VAPID private
-- key, which has no business in Postgres, and delivery to a dead endpoint must
-- never be able to fail an insert.
--
-- Requires two settings, applied once per environment (see docs/push.md):
--   alter database postgres set app.push_hook_url    = 'https://<ref>.supabase.co/functions/v1/send-push';
--   alter database postgres set app.push_hook_secret = '<random string>';
-- Until those exist, notify_push() returns quietly and the app behaves exactly
-- as it did before push was added.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

-- One row per browser+device that has granted permission. `endpoint` is the
-- push service's own url for that device and is globally unique, which makes it
-- the natural conflict target: reinstalling the PWA issues a fresh endpoint,
-- while a plain re-subscribe returns the same one and should update in place.
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  -- The two halves of the client's encryption key, as issued by the browser.
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

-- A device is only ever visible to the account that registered it. The edge
-- function reads across all of them with the service role, which bypasses RLS.
create policy "read own push subscriptions" on push_subscriptions
  for select using (user_id = auth.uid());

create policy "insert own push subscriptions" on push_subscriptions
  for insert with check (user_id = auth.uid());

create policy "update own push subscriptions" on push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "delete own push subscriptions" on push_subscriptions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Dispatch
-- ---------------------------------------------------------------------------

-- Fire-and-forget POST to the edge function. pg_net queues the request and
-- returns immediately, so sending a message never waits on push delivery.
create or replace function notify_push(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  hook_url    text := current_setting('app.push_hook_url', true);
  hook_secret text := current_setting('app.push_hook_secret', true);
begin
  -- Push is optional infrastructure. An unconfigured database is not an error.
  if hook_url is null or hook_url = '' then
    return;
  end if;

  perform net.http_post(
    url     := hook_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-push-secret', coalesce(hook_secret, '')
    ),
    body    := payload
  );
end;
$$;

revoke all on function notify_push(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Only the row id travels. The edge function looks the rest up with the service
-- role, so no message body is ever sitting in a pg_net request log.

create or replace function on_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_push(jsonb_build_object('type', 'message', 'id', new.id));
  return null;
end;
$$;

drop trigger if exists messages_push on messages;
create trigger messages_push
  after insert on messages
  for each row execute function on_message_push();

create or replace function on_announcement_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_push(jsonb_build_object('type', 'announcement', 'id', new.id));
  return null;
end;
$$;

drop trigger if exists announcements_push on announcements;
create trigger announcements_push
  after insert on announcements
  for each row execute function on_announcement_push();

-- Logistics only. Renaming a team at 6am shouldn't wake anyone; a tee time
-- moving is the whole reason someone would want this notification.
create or replace function on_team_logistics_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tee_time is distinct from old.tee_time
     or new.starting_hole is distinct from old.starting_hole then
    perform notify_push(jsonb_build_object('type', 'team_update', 'id', new.id));
  end if;
  return null;
end;
$$;

drop trigger if exists teams_push on teams;
create trigger teams_push
  after update on teams
  for each row execute function on_team_logistics_push();

create or replace function on_team_assignment_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_push(jsonb_build_object(
    'type',           'team_assignment',
    'team_id',        new.team_id,
    'participant_id', new.participant_id
  ));
  return null;
end;
$$;

drop trigger if exists team_members_push on team_members;
create trigger team_members_push
  after insert on team_members
  for each row execute function on_team_assignment_push();
