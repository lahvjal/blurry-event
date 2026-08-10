-- Course scorecards can list multiple tee sets. Keep those values separately
-- from holes.yards, which is retained as the legacy/current-field projection.
-- This is additive so old clients and old offline snapshots remain usable.

create table if not exists event_tees (
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  primary key (event_id, name)
);

create table if not exists tee_yardages (
  event_id uuid not null,
  tee_name text not null,
  hole smallint not null check (hole between 1 and 18),
  yards integer not null check (yards between 50 and 900),
  primary key (event_id, tee_name, hole),
  foreign key (event_id, tee_name)
    references public.event_tees(event_id, name) on delete cascade,
  foreign key (event_id, hole)
    references public.holes(event_id, hole) on delete cascade
);

create index if not exists tee_yardages_event_hole_idx
  on public.tee_yardages(event_id, hole);

alter table public.event_tees enable row level security;
alter table public.tee_yardages enable row level security;

grant select, insert, update, delete on public.event_tees to authenticated;
grant select, insert, update, delete on public.tee_yardages to authenticated;

create policy "account reads event tee sets" on public.event_tees
  for select to authenticated using (public.has_event_access(event_id));
create policy "event admins manage tee sets" on public.event_tees
  for all to authenticated
  using (public.is_event_admin(event_id))
  with check (public.is_event_admin(event_id));

create policy "account reads tee yardages" on public.tee_yardages
  for select to authenticated using (public.has_event_access(event_id));
create policy "event admins manage tee yardages" on public.tee_yardages
  for all to authenticated
  using (public.is_event_admin(event_id))
  with check (public.is_event_admin(event_id));

-- Every existing event starts with the one tee colour it already has, and the
-- old yards remain the value for that set. No event data is inferred or lost.
insert into public.event_tees (event_id, name, sort_order)
select id, coalesce(nullif(btrim(tee_color), ''), 'White'), 0
from public.events
on conflict (event_id, name) do nothing;

insert into public.tee_yardages (event_id, tee_name, hole, yards)
select
  hole.event_id,
  coalesce(nullif(btrim(event.tee_color), ''), 'White'),
  hole.hole,
  hole.yards
from public.holes hole
join public.events event on event.id = hole.event_id
on conflict (event_id, tee_name, hole) do nothing;

-- One all-or-nothing save keeps pars and every tee's yardage in sync. The
-- client submits the fully reviewed scorecard, never model output directly.
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
  expected_holes integer;
  expected_tees integer;
begin
  if auth.uid() is null or not public.is_event_admin(p_event_id) then
    raise exception 'Only an event admin can update this scorecard' using errcode = '42501';
  end if;

  if jsonb_typeof(p_holes) <> 'array' or jsonb_array_length(p_holes) <> 18 then
    raise exception 'A scorecard needs exactly 18 holes' using errcode = '22023';
  end if;
  if jsonb_typeof(p_tee_sets) <> 'array' or jsonb_array_length(p_tee_sets) < 1 then
    raise exception 'Add at least one tee set' using errcode = '22023';
  end if;

  select count(*) into expected_holes
  from (
    select (item->>'hole')::integer as hole, (item->>'par')::integer as par
    from jsonb_array_elements(p_holes) item
  ) parsed
  where parsed.hole between 1 and 18 and parsed.par between 3 and 6;
  if expected_holes <> 18 or exists (
    select 1 from (
      select (item->>'hole')::integer as hole
      from jsonb_array_elements(p_holes) item
    ) parsed group by hole having count(*) <> 1
  ) then
    raise exception 'Each hole needs one par from 3 through 6' using errcode = '22023';
  end if;

  select count(*) into expected_tees
  from (
    select btrim(item->>'name') as name
    from jsonb_array_elements(p_tee_sets) item
  ) parsed
  where char_length(name) between 1 and 40;
  if expected_tees <> jsonb_array_length(p_tee_sets) or exists (
    select 1 from (
      select lower(btrim(item->>'name')) as name
      from jsonb_array_elements(p_tee_sets) item
    ) parsed group by name having count(*) <> 1
  ) then
    raise exception 'Every tee set needs a unique name' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_tee_sets) set_row,
         jsonb_array_elements(set_row->'yardages') yardage
    where jsonb_typeof(set_row->'yardages') <> 'array'
       or jsonb_array_length(set_row->'yardages') <> 18
       or (yardage->>'yards')::integer not between 50 and 900
       or (yardage->>'hole')::integer not between 1 and 18
  ) then
    raise exception 'Every tee set needs 18 yardages from 50 through 900' using errcode = '22023';
  end if;

  delete from public.event_tees
  where event_id = p_event_id
    and name not in (
      select btrim(item->>'name') from jsonb_array_elements(p_tee_sets) item
    );

  insert into public.event_tees (event_id, name, sort_order)
  select p_event_id, btrim(item->>'name'), item_ordinality - 1
  from jsonb_array_elements(p_tee_sets) with ordinality as values_(item, item_ordinality)
  on conflict (event_id, name) do update set sort_order = excluded.sort_order;

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
  select btrim(item->>'name') into fallback_tee
  from jsonb_array_elements(p_tee_sets) item limit 1;
  if active_tee = '' or not exists (
    select 1 from public.event_tees where event_id = p_event_id and name = active_tee
  ) then
    active_tee := fallback_tee;
    update public.events set tee_color = active_tee where id = p_event_id;
  end if;

  update public.holes hole
  set yards = source.yards
  from public.tee_yardages source
  where source.event_id = p_event_id
    and source.tee_name = active_tee
    and source.hole = hole.hole
    and hole.event_id = p_event_id;
end;
$$;

revoke all on function public.apply_event_scorecard(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_event_scorecard(uuid, jsonb, jsonb) to authenticated;
