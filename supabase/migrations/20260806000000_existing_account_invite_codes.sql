-- Repair production schema drift where participants.invite_code lost the
-- default declared by the original schema. Existing-account registrations
-- also generate their code explicitly so this write does not depend on the
-- column default being present.

alter table participants
  alter column invite_code set default
    'BI-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));

create or replace function add_existing_account_to_event(
  p_event_id uuid,
  p_account_id uuid
)
returns table (
  id             uuid,
  full_name      text,
  handicap       numeric,
  avatar_url     text,
  is_admin       boolean,
  invite_code    text,
  auth_email     text,
  claimed_by     uuid,
  invite_sent_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  account_email text;
  account_name text;
  account_avatar text;
  source_registration participants;
  matching_registration participants;
  created_registration participants;
begin
  if auth.uid() is null or not is_event_admin(p_event_id) then
    raise exception 'Only an event admin can add an existing account'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from participants registration
    where registration.event_id = p_event_id
      and registration.claimed_by = p_account_id
  ) then
    raise exception 'That account is already on this event roster'
      using errcode = '23505';
  end if;

  select registration.*
  into source_registration
  from participants registration
  where registration.claimed_by = p_account_id
  order by registration.created_at desc, registration.id
  limit 1;

  if source_registration.id is null then
    raise exception 'That account is not linked to a Blurry player'
      using errcode = '23503';
  end if;

  select
    coalesce(nullif(lower(btrim(account.email)), ''), lower(source_registration.auth_email)),
    coalesce(nullif(btrim(profile.display_name), ''), source_registration.full_name),
    profile.avatar_url
  into account_email, account_name, account_avatar
  from profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = p_account_id;

  if account_email is null or account_name is null then
    raise exception 'That account is missing its player profile'
      using errcode = '23503';
  end if;

  -- A manual/CSV roster row may already carry this account's sign-in email.
  -- Link that row in place so its admin flag, invite code, and roster edits are
  -- preserved instead of creating a duplicate participant.
  select registration.*
  into matching_registration
  from participants registration
  where registration.event_id = p_event_id
    and lower(registration.auth_email) = account_email
  limit 1;

  if matching_registration.id is not null then
    if matching_registration.claimed_by is not null then
      raise exception 'That sign-in belongs to another player on this event'
        using errcode = '23505';
    end if;

    update participants registration
    set claimed_by = p_account_id
    where registration.id = matching_registration.id
    returning registration.* into created_registration;
  else
    insert into participants (
      event_id,
      full_name,
      auth_email,
      invite_code,
      handicap,
      is_admin,
      claimed_by
    ) values (
      p_event_id,
      account_name,
      account_email,
      'BI-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)),
      source_registration.handicap,
      false,
      p_account_id
    )
    returning participants.* into created_registration;
  end if;

  return query
    select
      created_registration.id,
      created_registration.full_name,
      created_registration.handicap,
      account_avatar,
      created_registration.is_admin,
      created_registration.invite_code,
      created_registration.auth_email,
      created_registration.claimed_by,
      created_registration.invite_sent_at;
end;
$$;

revoke all on function add_existing_account_to_event(uuid, uuid) from public, anon;
grant execute on function add_existing_account_to_event(uuid, uuid) to authenticated;

comment on function add_existing_account_to_event(uuid, uuid) is
  'Adds an existing account as a claimed participant in an event. Event admins only.';
