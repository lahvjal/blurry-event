-- Read-only verification for the offline score contract.
-- Run after 20260801000500_offline_score_sync.sql. Every row must be true.

select *
from (values
  (
    'score revision columns',
    (select count(*) = 2
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'scores'
       and column_name in ('client_version', 'last_mutation_id'))
  ),
  (
    'globally idempotent mutation index',
    exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and tablename = 'scores'
        and indexname = 'scores_last_mutation_id_uniq'
        and indexdef like '%UNIQUE%'
    )
  ),
  (
    'atomic score RPC signature',
    exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'submit_offline_score'
        and pg_get_function_identity_arguments(procedure.oid) =
          'p_event_id uuid, p_team_id uuid, p_participant_id uuid, p_hole integer, p_strokes integer, p_entered_by uuid, p_client_updated_at timestamp with time zone, p_client_version bigint, p_mutation_id uuid'
        and procedure.prosecdef
    )
  ),
  (
    'anonymous callers blocked',
    not has_function_privilege(
      'anon',
      'public.submit_offline_score(uuid,uuid,uuid,integer,integer,uuid,timestamptz,bigint,uuid)',
      'execute'
    )
  ),
  (
    'authenticated callers allowed',
    has_function_privilege(
      'authenticated',
      'public.submit_offline_score(uuid,uuid,uuid,integer,integer,uuid,timestamptz,bigint,uuid)',
      'execute'
    )
  )
) as checks(check_name, passed)
order by passed, check_name;
