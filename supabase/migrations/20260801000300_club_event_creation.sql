-- Atomic club event creation for the PWA admin workspace.
--
-- A direct events INSERT would leave a partially configured event without its
-- 18 scorecard rows or all-hands conversation. Keep that invariant inside one
-- database transaction and require club-level access explicitly.

create or replace function create_club_event(
  p_name text,
  p_course_name text,
  p_event_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_event uuid;
  clean_name text := btrim(coalesce(p_name, ''));
  clean_course text := btrim(coalesce(p_course_name, ''));
begin
  if auth.uid() is null or not is_club_admin() then
    raise exception 'Only a club admin can create events' using errcode = '42501';
  end if;

  if clean_name = '' then
    raise exception 'Event name is required' using errcode = '22023';
  end if;
  if clean_course = '' then
    raise exception 'Course name is required' using errcode = '22023';
  end if;
  if p_event_date is null then
    raise exception 'Event date is required' using errcode = '22023';
  end if;
  if length(clean_name) > 120 or length(clean_course) > 160 then
    raise exception 'Event or course name is too long' using errcode = '22023';
  end if;

  insert into events (
    name,
    course_name,
    event_date,
    lifecycle_status
  )
  values (
    clean_name,
    clean_course,
    p_event_date,
    'draft'
  )
  returning id into created_event;

  -- Draft placeholders keep every existing scorecard/admin screen functional.
  -- The event remains private to club admins until participants are added, and
  -- par/yardage can be replaced from Event Admin before publication.
  insert into holes (event_id, hole, par, yards)
  select created_event, hole_number, 4, 400
  from generate_series(1, 18) as hole_number;

  insert into conversations (event_id, kind, name, created_by)
  values (created_event, 'event_group', clean_name, null);

  return created_event;
end;
$$;

revoke all on function create_club_event(text, text, date) from public, anon;
grant execute on function create_club_event(text, text, date) to authenticated;

comment on function create_club_event(text, text, date) is
  'Creates one Draft event with 18 editable holes and its managed event conversation. Club admins only.';
