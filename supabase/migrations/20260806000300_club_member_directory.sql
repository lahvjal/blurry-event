-- Club-wide member directory for the Club Admin workspace.
--
-- Claimed event registrations share a profiles/auth account. Unclaimed rows
-- with a real email share the same future identity because handle_new_user()
-- claims every matching registration at signup. Code-only invites deliberately
-- remain separate: matching those by name would merge unrelated people.

create or replace function club_member_directory()
returns table (
  person_key      text,
  account_id      uuid,
  display_name    text,
  username        text,
  avatar_url      text,
  is_club_admin   boolean,
  status          text,
  name_conflict   boolean,
  event_count     integer,
  attendances     jsonb
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not is_club_admin() then
    raise exception 'Only a club admin can view the club member directory'
      using errcode = '42501';
  end if;

  return query
  with resolved_registrations as (
    select
      registration.id as participant_id,
      registration.event_id,
      registration.full_name,
      registration.claimed_by,
      registration.is_admin as event_is_admin,
      registration.invite_sent_at,
      registration.created_at as participant_created_at,
      event.name as event_name,
      event.course_name,
      event.event_date,
      event.lifecycle_status,
      event.created_at as event_created_at,
      coalesce(registration.claimed_by, matched_account.id) as resolved_account_id,
      case
        when registration.claimed_by is null
          and lower(btrim(registration.auth_email)) not like '%@invite.blurrygolf.app'
          and lower(btrim(registration.auth_email)) not like '%@invite.local'
        then lower(btrim(registration.auth_email))
        else null
      end as real_email_key
    from participants registration
    join events event on event.id = registration.event_id
    left join auth.users matched_account
      on registration.claimed_by is null
     and lower(btrim(registration.auth_email)) not like '%@invite.blurrygolf.app'
     and lower(btrim(registration.auth_email)) not like '%@invite.local'
     and lower(matched_account.email) = lower(btrim(registration.auth_email))
  ),
  keyed_registrations as (
    select
      resolved.*,
      case
        when resolved.resolved_account_id is not null
          then 'account:' || resolved.resolved_account_id::text
        when resolved.real_email_key is not null
          then 'invite-email:' || resolved.real_email_key
        else 'participant:' || resolved.participant_id::text
      end as identity_key
    from resolved_registrations resolved
  ),
  identities as (
    select
      keyed.identity_key,
      min(keyed.resolved_account_id::text)::uuid as resolved_account_id
    from keyed_registrations keyed
    group by keyed.identity_key

    union

    -- Include app accounts with no event registration, including a club admin
    -- who manages events without playing in one.
    select 'account:' || profile.id::text, profile.id
    from profiles profile
  )
  select
    case
      when identity.resolved_account_id is not null then identity.identity_key
      else 'invite:' || min(registration.participant_id::text)
    end as person_key,
    identity.resolved_account_id as account_id,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      (
        array_agg(
          registration.full_name
          order by registration.event_date desc,
                   registration.participant_created_at desc,
                   registration.participant_id
        ) filter (where registration.participant_id is not null)
      )[1],
      'Member'
    ) as display_name,
    profile.username,
    profile.avatar_url,
    coalesce(profile.is_club_admin, false) as is_club_admin,
    case
      when identity.resolved_account_id is not null then 'app_user'
      else 'invited'
    end as status,
    count(distinct lower(btrim(registration.full_name))) filter (
      where registration.participant_id is not null
    ) > 1 as name_conflict,
    count(distinct registration.event_id)::integer as event_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'eventId', registration.event_id,
          'eventName', registration.event_name,
          'courseName', registration.course_name,
          'eventDate', registration.event_date,
          'lifecycleStatus', registration.lifecycle_status,
          'participantId', registration.participant_id,
          'claimed', registration.claimed_by is not null,
          'isEventAdmin', registration.event_is_admin,
          'inviteSentAt', registration.invite_sent_at
        )
        order by registration.event_date desc,
                 registration.event_created_at desc,
                 registration.participant_id
      ) filter (where registration.participant_id is not null),
      '[]'::jsonb
    ) as attendances
  from identities identity
  left join keyed_registrations registration
    on registration.identity_key = identity.identity_key
  left join profiles profile on profile.id = identity.resolved_account_id
  group by
    identity.identity_key,
    identity.resolved_account_id,
    profile.display_name,
    profile.username,
    profile.avatar_url,
    profile.is_club_admin
  order by
    lower(coalesce(nullif(btrim(profile.display_name), ''), '')),
    lower(
      coalesce(
        (
          array_agg(
            registration.full_name
            order by registration.event_date desc,
                     registration.participant_created_at desc,
                     registration.participant_id
          ) filter (where registration.participant_id is not null)
        )[1],
        ''
      )
    ),
    identity.identity_key;
end;
$$;

revoke all on function club_member_directory() from public, anon;
grant execute on function club_member_directory() to authenticated;

comment on function club_member_directory() is
  'Least-privilege club member and invite directory with event attendance. Club admins only.';
