-- Store the visual tee colour separately from the organizer's tee name.
-- Examples: a course may call its blue tees "Championship" or "Back".
alter table public.event_tees
  add column if not exists color text not null default 'White'
  check (char_length(btrim(color)) between 1 and 40);

update public.event_tees
set color = case lower(name)
  when 'black' then 'Black'
  when 'blue' then 'Blue'
  when 'gold' then 'Gold'
  when 'green' then 'Green'
  when 'red' then 'Red'
  else 'White'
end
where color = 'White';

-- Replace the atomic scorecard writer so the scan review saves tee name,
-- colour, pars, and all 18-hole yardage cards together.
create or replace function public.apply_event_scorecard(
  p_event_id uuid,
  p_holes jsonb,
  p_tee_sets jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_tee text;
  fallback_tee text;
begin
  if auth.uid() is null or not public.is_event_admin(p_event_id) then
    raise exception 'Only an event admin can update this scorecard' using errcode = '42501';
  end if;
  if jsonb_typeof(p_holes) <> 'array' or jsonb_array_length(p_holes) <> 18
    or jsonb_typeof(p_tee_sets) <> 'array' or jsonb_array_length(p_tee_sets) < 1 then
    raise exception 'A scorecard needs 18 holes and at least one tee set' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_holes) item
    where (item->>'hole')::integer not between 1 and 18
       or (item->>'par')::integer not between 3 and 6
  ) or (select count(distinct (item->>'hole')::integer) from jsonb_array_elements(p_holes) item) <> 18 then
    raise exception 'Each hole needs one par from 3 through 6' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_tee_sets) item
    where char_length(btrim(item->>'name')) not between 1 and 40
       or char_length(btrim(item->>'color')) not between 1 and 40
       or jsonb_typeof(item->'yardages') <> 'array'
       or jsonb_array_length(item->'yardages') <> 18
  ) or exists (
    select 1 from (
      select lower(btrim(item->>'name')) as name from jsonb_array_elements(p_tee_sets) item
    ) names group by name having count(*) <> 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_tee_sets) set_row,
         jsonb_array_elements(set_row->'yardages') yardage
    where (yardage->>'hole')::integer not between 1 and 18
       or (yardage->>'yards')::integer not between 50 and 900
  ) then
    raise exception 'Every tee needs a unique name, color, and 18 yardages' using errcode = '22023';
  end if;

  delete from public.event_tees
  where event_id = p_event_id
    and name not in (select btrim(item->>'name') from jsonb_array_elements(p_tee_sets) item);

  insert into public.event_tees (event_id, name, color, sort_order)
  select p_event_id, btrim(item->>'name'), btrim(item->>'color'), ordinality - 1
  from jsonb_array_elements(p_tee_sets) with ordinality as values_(item, ordinality)
  on conflict (event_id, name) do update set color = excluded.color, sort_order = excluded.sort_order;

  insert into public.holes (event_id, hole, par, yards)
  select p_event_id, (item->>'hole')::smallint, (item->>'par')::integer, 50
  from jsonb_array_elements(p_holes) item
  on conflict (event_id, hole) do update set par = excluded.par;

  delete from public.tee_yardages where event_id = p_event_id;
  insert into public.tee_yardages (event_id, tee_name, hole, yards)
  select p_event_id, btrim(set_row->>'name'), (yardage->>'hole')::smallint, (yardage->>'yards')::integer
  from jsonb_array_elements(p_tee_sets) set_row,
       jsonb_array_elements(set_row->'yardages') yardage;

  select coalesce(nullif(btrim(tee_color), ''), '') into active_tee
  from public.events where id = p_event_id for update;
  select btrim(item->>'name') into fallback_tee from jsonb_array_elements(p_tee_sets) item limit 1;
  if active_tee = '' or not exists (
    select 1 from public.event_tees where event_id = p_event_id and name = active_tee
  ) then
    active_tee := fallback_tee;
    update public.events set tee_color = active_tee where id = p_event_id;
  end if;
  update public.holes hole set yards = source.yards
  from public.tee_yardages source
  where source.event_id = p_event_id and source.tee_name = active_tee
    and source.hole = hole.hole and hole.event_id = p_event_id;
end;
$$;

revoke all on function public.apply_event_scorecard(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_event_scorecard(uuid, jsonb, jsonb) to authenticated;
