-- Lets an admin edit the event itself: start time, available tee time slots,
-- and a course map photo. Holes (par/yards) already exist and are admin-writable.

alter table events
  add column if not exists start_time     text not null default '8:00 AM',
  -- Slots teams get assigned to, in play order. An array keeps ordering without
  -- a join table; the list is short and only ever rewritten wholesale.
  add column if not exists tee_times      text[] not null default '{}',
  add column if not exists course_map_url text;

-- Seed slots for the existing event from the tee times already on its teams,
-- so the picker isn't empty on first open.
update events e
   set tee_times = coalesce(
     (
       select array_agg(distinct t.tee_time order by t.tee_time)
       from teams t
       where t.event_id = e.id and t.tee_time is not null
     ),
     '{}'
   )
 where e.tee_times = '{}';

-- ---------------------------------------------------------------------------
-- Storage: course map + player avatars
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('event-media', 'event-media', true)
on conflict (id) do nothing;

-- Anyone signed in can view; only admins can write the course map. Avatars live
-- under avatars/<user id>/ so a player can manage their own without touching
-- anyone else's.
drop policy if exists "event media readable" on storage.objects;
create policy "event media readable" on storage.objects
  for select using (bucket_id = 'event-media');

drop policy if exists "admins write course map" on storage.objects;
create policy "admins write course map" on storage.objects
  for all using (
    bucket_id = 'event-media'
    and (storage.foldername(name))[1] = 'course'
    and is_admin()
  )
  with check (
    bucket_id = 'event-media'
    and (storage.foldername(name))[1] = 'course'
    and is_admin()
  );

drop policy if exists "players write own avatar" on storage.objects;
create policy "players write own avatar" on storage.objects
  for all using (
    bucket_id = 'event-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'event-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
