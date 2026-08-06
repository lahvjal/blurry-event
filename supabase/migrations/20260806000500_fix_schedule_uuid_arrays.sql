-- plpgsql_check does not apply an implicit text-to-uuid[] assignment cast to a
-- local variable initializer. Recreate the two RPC bodies with explicit array
-- casts. Reading the stored body keeps this follow-up small and idempotent while
-- preserving the already-reviewed parameter names, behavior, grants, and owner.

do $$
declare
  schedule_body text;
  teams_body text;
begin
  select prosrc into schedule_body
  from pg_proc
  where oid = 'apply_event_schedule(uuid,event_start_format,text,text[],jsonb)'::regprocedure;

  if schedule_body is null then
    raise exception 'apply_event_schedule is missing';
  end if;
  schedule_body := replace(
    schedule_body,
    'group_ids uuid[] := ''{}'';',
    'group_ids uuid[] := ''{}''::uuid[];'
  );
  execute format(
    $definition$
      create or replace function apply_event_schedule(
        p_event_id uuid,
        p_start_format event_start_format,
        p_start_time text,
        p_tee_times text[],
        p_groups jsonb
      )
      returns uuid[]
      language plpgsql
      security definer
      set search_path = public
      as %L
    $definition$,
    schedule_body
  );

  select prosrc into teams_body
  from pg_proc
  where oid = 'apply_team_assignments(uuid,jsonb)'::regprocedure;

  if teams_body is null then
    raise exception 'apply_team_assignments is missing';
  end if;
  teams_body := replace(
    teams_body,
    'team_ids uuid[] := ''{}'';',
    'team_ids uuid[] := ''{}''::uuid[];'
  );
  execute format(
    $definition$
      create or replace function apply_team_assignments(
        p_event_id uuid,
        p_teams jsonb
      )
      returns uuid[]
      language plpgsql
      security definer
      set search_path = public
      as %L
    $definition$,
    teams_body
  );
end
$$;
