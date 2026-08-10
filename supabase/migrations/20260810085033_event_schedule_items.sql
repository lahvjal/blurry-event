alter table public.events
  add column if not exists schedule_items jsonb not null default '[]'::jsonb;

alter table public.events
  drop constraint if exists events_schedule_items_is_array;

alter table public.events
  add constraint events_schedule_items_is_array
  check (jsonb_typeof(schedule_items) = 'array');
