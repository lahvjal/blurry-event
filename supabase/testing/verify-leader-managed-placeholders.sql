-- Read-only verification for the delegated teammate-management contract.
-- Run after 20260810031043_leader_managed_placeholders.sql. Every row must be true.

select *
from (values
  (
    'team leader column and participant lifecycle columns',
    (select count(*) = 5
     from information_schema.columns
     where table_schema = 'public'
       and (
         (table_name = 'teams' and column_name = 'leader_participant_id')
         or (
           table_name = 'participants'
           and column_name in (
             'leader_managed',
             'invite_enabled',
             'claim_email_bound',
             'identity_version'
           )
         )
       ))
  ),
  (
    'new no-email participants require explicit invite enablement',
    (select column_default = 'false'
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'participants'
       and column_name = 'invite_enabled')
  ),
  (
    'leader edit RPC is authenticated-only',
    has_function_privilege(
      'authenticated',
      'public.update_leader_managed_teammate(uuid,uuid,bigint,text,text)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.update_leader_managed_teammate(uuid,uuid,bigint,text,text)',
      'execute'
    )
  ),
  (
    'leader assignment RPC is authenticated-only',
    has_function_privilege(
      'authenticated',
      'public.set_team_leader(uuid,uuid,uuid)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.set_team_leader(uuid,uuid,uuid)',
      'execute'
    )
  ),
  (
    'private cores are security definer',
    (select count(*) = 3
     from pg_proc procedure
     join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private'
       and procedure.proname in (
         'managed_teammate_team',
         'set_team_leader',
         'update_leader_managed_teammate'
       )
       and procedure.prosecdef)
  ),
  (
    'audit table is not exposed to authenticated clients',
    not has_table_privilege(
      'authenticated',
      'private.team_management_audit',
      'select'
    )
    and not has_table_privilege(
      'authenticated',
      'private.team_management_audit',
      'insert'
    )
  ),
  (
    'team leader membership trigger is deferred',
    exists (
      select 1
      from pg_trigger trigger
      join pg_class relation on relation.oid = trigger.tgrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = 'teams'
        and trigger.tgname = 'teams_validate_leader_membership'
        and trigger.tgdeferrable
        and trigger.tginitdeferred
    )
  ),
  (
    'shared score authorization functions still exist',
    exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'can_write_round'
    )
    and exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'submit_offline_score'
    )
  )
) as checks(check_name, passed)
order by passed, check_name;
