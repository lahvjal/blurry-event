-- Move push dispatch config out of database-level settings and into a table.
--
-- 0011 read the hook url and secret from `current_setting('app.push_hook_url')`,
-- which is the pattern Supabase's own webhook docs use. It doesn't work here:
-- on a managed project the `postgres` role isn't a superuser, so
-- `alter database postgres set app.push_hook_url = ...` fails outright with
-- 42501 permission denied.
--
-- A table also avoids the rough edge that approach had even where it is
-- permitted — `alter database ... set` only applies to *new* connections, so a
-- change wouldn't reach PostgREST's long-lived pool until it cycled or the
-- project restarted. Reading a row takes effect on the very next trigger.

create table push_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- This table holds the shared secret, so it is readable by nothing that comes
-- in over the API. RLS with zero policies denies every row to anon and
-- authenticated; the revoke means they can't reach the table at all. Both are
-- deliberate — either alone would do, and neither costs anything.
alter table push_config enable row level security;
revoke all on table push_config from anon, authenticated;

-- notify_push runs SECURITY DEFINER as the owner, which bypasses RLS, so it can
-- still read what nobody else can.
create or replace function notify_push(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  hook_url    text;
  hook_secret text;
begin
  select value into hook_url    from push_config where key = 'push_hook_url';
  select value into hook_secret from push_config where key = 'push_hook_secret';

  -- Push stays optional infrastructure: an unconfigured database is not an
  -- error, it just doesn't send.
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

-- Readable check that doesn't expose the secret itself.
create or replace function push_config_status()
returns table (hook_url text, hook_secret_set boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select value from push_config where key = 'push_hook_url'), '(NOT SET)'),
    coalesce((select value from push_config where key = 'push_hook_secret'), '') <> '';
$$;

revoke all on function push_config_status() from public, anon, authenticated;
